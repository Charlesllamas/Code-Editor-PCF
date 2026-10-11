import { IInputs, IOutputs } from "./generated/ManifestTypes";
import monaco, { resolveLanguage } from "./monacoSetup";
import { displayName } from "./languages";
import { hasValidator, isError, Problem, validateJson, validateXml } from "./validate";
import { resolveHeight, resolveWidth, STATUS_BAR_HEIGHT } from "./sizing";
import { MonacoTheme, pageTheme, ThemeVote } from "./theme";
import { resolveSchemaSource } from "./schema";
import { fromText, loadWebResourceSchema, SchemaStatus, schemaStatusText, schemaWithholdsVerdict } from "./schemaLoader";
import { schemaRegistry } from "./schemaRegistry";
import { lineVisible, visibleArea } from "./clip";
import { fetchValidate } from "./fetchValidate";
import { Said, render, said } from "./messages";
import { fetchRegistry } from "./fetchRegistry";
import { Metadata, Need, metadataFor } from "./metadata";
import { clipRects, createOverflowNode, viewportRect, watchOuterScroll } from "./overflow";
import { EchoGuard } from "./echo";
import { Baseline } from "./baseline";
import { Verdict } from "./verdict";
import { MarkdownView, Mode, initialMode, readMarkdownView, settleMode, stripButtons } from "./strip";
import { renderPreview } from "./preview";

/** Owner key for the markers this control sets; Monaco keeps one list per owner. */
const MARKER_OWNER = "pcf-code-editor";

/** Typing pauses this long before the document is re-validated. */
const VALIDATE_DELAY_MS = 300;

/*
 * The page's one Monaco theme (theme.ts): every live control's vote, in the
 * order it arrived, and how to show that control the theme in force — so the
 * strip under each editor matches the editor, whichever control decided it.
 */
const themeVotes = new Map<object, { vote: ThemeVote; show: (theme: MonacoTheme) => void }>();
let themeInForce: MonacoTheme | undefined;

function repaintPageTheme(): void {
    const theme = pageTheme(Array.from(themeVotes.values(), (v) => v.vote));
    if (theme !== themeInForce) {
        themeInForce = theme;
        monaco.editor.setTheme(theme);
    }
    themeVotes.forEach((v) => v.show(theme));
}

export class CodeEditor implements ComponentFramework.StandardControl<IInputs, IOutputs> {

    private _container: HTMLDivElement;
    private _root: HTMLDivElement;
    private _editorHost: HTMLDivElement;
    private _status: HTMLDivElement;
    private _languageLabel: HTMLSpanElement;
    private _problemButton: HTMLButtonElement;
    private _okLabel: HTMLSpanElement;
    private _formatButton: HTMLButtonElement;
    private _schemaLabel: HTMLSpanElement;
    /** 1.6.0: where Changes draws the diff, and where the preview renders. */
    private _diffHost: HTMLDivElement;
    private _previewHost: HTMLDivElement;
    private _changesButton: HTMLButtonElement;
    private _backButton: HTMLButtonElement;
    private _previewButton: HTMLButtonElement;
    private _editButton: HTMLButtonElement;

    private _notifyOutputChanged: () => void;
    private _editor: monaco.editor.IStandaloneCodeEditor;
    /**
     * What getOutputs hands back as the column. Null until the user types
     * when the column was null: 1.3.0 notifies when the verdict changes, not
     * only on a keystroke, and handing an untouched null column back as ""
     * is a change the form would count.
     */
    private _code: string | null = null;
    private _language: string;
    private _validate = true;
    /** Where the completion list and the hover render: a node under <body> (overflow.ts). */
    private _overflowNode: HTMLElement | undefined;
    private _stopWatchingScroll: (() => void) | undefined;
    /** The model URI this control filed a schema under, if it did. */
    private _registeredUri: string | undefined;
    /** The model URI this control filed a FetchXML entry under, if it did. */
    private _fetchUri: string | undefined;
    /**
     * The page's reader of this environment's table definitions, or null
     * where no request can be made: no organisation URL — canvas, the demo.
     */
    private _metadata: Metadata | null = null;
    /** A FetchXML check is waiting on metadata; one wait at a time. */
    private _awaitingMetadata = false;
    /** Whether the last check found the document not well-formed. */
    private _syntaxFault = false;
    private _fitContent = false;
    private _readOnly = false;
    private _suppressChange = false;
    /** Tells the form's own change from an echo of this control's write. */
    private _echo = new EchoGuard();
    private _validateTimer: number | undefined;
    private _problems: Problem[] = [];
    private _getString: (key: string) => string;

    /** The raw schema input last acted on; undefined until the first read. */
    private _schemaRaw: string | null | undefined = undefined;
    private _schema: SchemaStatus = { kind: "none" };
    /** Bumped per schema read and on destroy: a load that lost the race is dropped. */
    private _schemaToken = 0;
    /** The isValid and problemCount outputs, and whether the host has read them (verdict.ts). */
    private _verdict = new Verdict();

    /** The latest context: layout and openUrl read it between passes. */
    private _context: ComponentFramework.Context<IInputs>;
    /** Which of the three views is showing (strip.ts). */
    private _mode: Mode = "edit";
    /** `markdownView` as last read; a change re-decides the mode. */
    private _markdownView: MarkdownView | undefined = undefined;
    /** What Changes compares with: the value as last saved (baseline.ts). */
    private _baseline: Baseline;
    private _diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;
    private _diffOriginal: monaco.editor.ITextModel | undefined;
    private _preview: { dispose(): void } | undefined;
    /** The environment's origin, for the preview's same-origin images; null without one. */
    private _origin: string | null = null;

    /**
     * Used to initialize the control instance.
     */
    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
        this._container = container;
        this._context = context;
        this._notifyOutputChanged = notifyOutputChanged;
        this._getString = (key) => context.resources.getString(key);

        // Ask the platform to report container size changes through updateView.
        context.mode.trackContainerResize(true);

        this._container.style.boxSizing = "border-box";
        this._container.style.overflow = "hidden";
        // Monaco never resets text-align on its view lines, so an alignment
        // inherited from the host shifts every rendered glyph sideways -- the
        // PCF test harness centres its wrapper, which pushed the code 318px in.
        this._container.style.textAlign = "left";

        this.buildDom();
        this.readInputs(context);
        this.applyTheme(context);

        // The editor host must have its size before the editor is created. An
        // editor born into a zero-height div registers no visible lines, and
        // then never repaints when background tokenization finishes -- the
        // symptom is a fully functional editor that renders without any syntax
        // colouring at all.
        this.sizeContainer(context, null);

        this._code = context.parameters.code.raw ?? null;
        this._language = resolveLanguage(context.parameters.language.raw);
        // What the record holds as the control mounts: reopening a record is a
        // new mount (SPEC.md, the 1.5.9 probe, P2), so this is the saved value.
        this._baseline = new Baseline(this._code);

        // Decided once per mount: the organisation URL does not change between
        // passes, and every editor on the page shares the reader (metadata.ts).
        const url = clientUrl(context);
        this._origin = originOf(url);
        const languageId = context.userSettings?.languageId;
        this._metadata = url ? metadataFor(url, typeof languageId === "number" ? languageId : null, (u, init) => fetch(u, init)) : null;

        // The list and every hover render under <body>, where no form
        // container can cut them or move their origin (overflow.ts).
        this._overflowNode = createOverflowNode(this._container.ownerDocument);

        this._editor = monaco.editor.create(this._editorHost, {
            value: this._code ?? "",
            language: this._language,
            readOnly: this._readOnly,
            // The wrapper div owns the size; Monaco is told explicitly via layout().
            automaticLayout: false,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            // Read at creation only (SPEC.md P1): updateOptions ignores both.
            overflowWidgetsDomNode: this._overflowNode,
            fixedOverflowWidgets: true,
            // Completion from the schema, and nothing else: word-based
            // suggestions would offer every language its own words and ask
            // for the editor worker (SPEC.md P4).
            wordBasedSuggestions: "off",
            quickSuggestions: { strings: true, other: true, comments: false },
            acceptSuggestionOnEnter: "smart",
            suggest: { showWords: false }
        });

        this._stopWatchingScroll = watchOuterScroll(this._editorHost, () => this.followOuterScroll(), () => this.closeWidgets());

        this._editor.onDidChangeModelContent(() => {
            if (this._suppressChange) {
                return;
            }
            this._code = this._editor.getValue();
            this._echo.wrote(this._code);
            this._baseline.wrote(Date.now());
            this._notifyOutputChanged();
            this.scheduleValidate();
        });

        // With fitContent on, the document decides the height; a typed line
        // grows the box and a deleted one shrinks it. Off, the event is
        // ignored and the box stays where the maker or the host put it.
        this._editor.onDidContentSizeChange(() => {
            if (this._fitContent) {
                this.layout(context);
            }
        });

        this.readSchema(context);
        this.readMarkdownView(context);
        this.layout(context);
        this.runValidate();
    }

    /**
     * Called when any value in the property bag has changed.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this._context = context;
        const previouslyValidating = this._validate;
        this.readInputs(context);
        this._editor.updateOptions({ readOnly: this._readOnly });
        this._diffEditor?.updateOptions({ readOnly: this._readOnly });
        this.applyTheme(context);

        // Issue #3 / alias handling: swap the model's language in place.
        const language = resolveLanguage(context.parameters.language.raw);
        const languageChanged = language !== this._language;
        if (languageChanged) {
            const current = this._editor.getModel();
            if (current) {
                monaco.editor.setModelLanguage(current, language);
            }
            if (this._diffOriginal) {
                monaco.editor.setModelLanguage(this._diffOriginal, language);
            }
            this._language = language;
        }

        // The old control passed the value as defaultValue, which Monaco reads
        // once at mount, so a record changing underneath the editor left stale
        // text that the next save wrote back. Writing the bound value in is the
        // fix -- but never while the user is typing in it. The platform echoes
        // the value back asynchronously, so `incoming` is routinely a keystroke
        // behind, and writing that back resets the cursor to the top of the
        // document on every key press.
        //
        // Focus alone is not enough (echo.ts): an echo can land after the user
        // clicks away, and the hub's demo repeats the preset's value on every
        // pass. The guard is asked first so it hears every pass.
        const model = this._editor.getModel();
        const incoming = context.parameters.code.raw ?? "";
        let valueChanged = false;
        // The baseline reads the pass before the editor takes anything from
        // it: a save repeats what the editor already holds (baseline.ts).
        if (model && this._baseline.pass(incoming, model.getValue(), context.updatedProperties, Date.now())) {
            this._diffOriginal?.setValue(this._baseline.get());
        }
        const takes = model ? this._echo.takes(incoming, model.getValue()) : false;
        if (model && takes && !this.editorHasFocus()) {
            this._suppressChange = true;
            model.setValue(incoming);
            this._suppressChange = false;
            this._code = context.parameters.code.raw ?? null;
            valueChanged = true;
            // Without a form (no client URL: canvas, the demo) a value the
            // host hands in is the saved value; on a form it is a script's,
            // unsaved, and stays in the diff (baseline.ts).
            if (this._origin === null) {
                this._baseline.took(incoming);
                this._diffOriginal?.setValue(this._baseline.get());
            }
        }

        // Read on every pass: the hub's demo changes inputs on a mounted
        // control — a preset can switch the mode — and the mode has to stay
        // one the language and the field allow.
        if (!this.readMarkdownView(context)) {
            this.setMode(this._mode);
        }
        if (valueChanged && this._mode === "preview") {
            this.showPreview();
        }

        this.layout(context);

        // Read on every pass: the hub's demo changes inputs on a mounted
        // control, and a canvas formula can change the schema at any time.
        const schemaChanged = this.readSchema(context);

        if (languageChanged || valueChanged || schemaChanged || previouslyValidating !== this._validate) {
            this.runValidate();
        } else {
            this.renderStatus();
        }
    }

    /**
     * @returns an object based on nomenclature defined in manifest.
     */
    public getOutputs(): IOutputs {
        const verdict = this._verdict.reported();

        return {
            // Null, never undefined, for a column nobody has typed in: see _code.
            code: this._code ?? (null as unknown as string),
            isValid: verdict.isValid,
            problemCount: verdict.problemCount
        };
    }

    /**
     * Called when the control is to be removed from the DOM tree.
     */
    public destroy(): void {
        this.closeChanges();
        this.closePreview();
        this._schemaToken++;
        if (this._validateTimer !== undefined) {
            window.clearTimeout(this._validateTimer);
            this._validateTimer = undefined;
        }
        this._stopWatchingScroll?.();
        this._stopWatchingScroll = undefined;
        this.unregisterSchema();
        this.unregisterFetch();
        const model = this._editor?.getModel();
        if (model) {
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
        }
        this._editor?.dispose();
        // The node lives under <body>, outside the container the platform
        // removes, so it goes explicitly or every remount leaves one behind.
        this._overflowNode?.remove();
        this._overflowNode = undefined;
        // The page's theme is decided again without this control's vote.
        if (themeVotes.delete(this)) {
            repaintPageTheme();
        }
    }

    /* ------------------------------------------------------------ inputs */

    private readInputs(context: ComponentFramework.Context<IInputs>): void {
        this._readOnly = this.isReadOnly(context);
        // `raw` is typed as the union, but a canvas formula can supply anything.
        this._validate = String(context.parameters.validation?.raw ?? "on").trim().toLowerCase() !== "off";
        this._fitContent = context.parameters.fitContent?.raw === true;
    }

    // Issue #2: honour both the form-level lock and field level security.
    private isReadOnly(context: ComponentFramework.Context<IInputs>): boolean {
        const secured = context.parameters.code.security;
        return context.mode.isControlDisabled || (secured ? !secured.editable : false);
    }

    /**
     * Cast this control's vote for the page's theme (theme.ts), and repaint
     * when it changed. A changed vote moves to the back of the queue: it is
     * the latest word, which is what "the last to arrive wins" means.
     */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const vote: ThemeVote = { preference: context.parameters.theme?.raw, isDarkTheme: context.fluentDesignLanguage?.isDarkTheme };
        const before = themeVotes.get(this)?.vote;
        if (before && before.preference === vote.preference && before.isDarkTheme === vote.isDarkTheme) {
            return;
        }
        themeVotes.delete(this);
        themeVotes.set(this, {
            vote,
            show: (theme) => {
                this._root.dataset.theme = theme;
            }
        });
        repaintPageTheme();
    }

    /* ------------------------------------------------- list and hover */

    /** Close the completion list and the hover, if either is open. */
    private closeWidgets(): void {
        const editor = this.activeEditor();
        editor?.trigger(MARKER_OWNER, "hideSuggestWidget", {});
        editor?.trigger(MARKER_OWNER, "editor.action.hideHover", {});
    }

    /* ------------------------------------------- 1.6.0: changes, preview */

    /** The editor the user types in: the diff's modified side while Changes is open. */
    private activeEditor(): monaco.editor.ICodeEditor | undefined {
        return this._diffEditor ? this._diffEditor.getModifiedEditor() : this._editor;
    }

    /** The box the active view draws in. */
    private activeHost(): HTMLDivElement {
        return this._mode === "changes" ? this._diffHost : this._mode === "preview" ? this._previewHost : this._editorHost;
    }

    /** Typing in either editor holds a value the form's echo must not overwrite (echo.ts). */
    private editorHasFocus(): boolean {
        return this._editor.hasTextFocus() || (this._diffEditor?.getModifiedEditor().hasTextFocus() ?? false);
    }

    /**
     * Act on `markdownView` when it changed: it decides the mode a Markdown
     * editor mounts in, and the hub's demo switches it on a mounted control.
     * Returns whether it changed.
     */
    private readMarkdownView(context: ComponentFramework.Context<IInputs>): boolean {
        const view = readMarkdownView(context.parameters.markdownView?.raw);
        if (view === this._markdownView) {
            return false;
        }
        this._markdownView = view;
        this.setMode(initialMode(view, this._language));
        return true;
    }

    /**
     * Show one of the three views (strip.ts), closing what the others had
     * open. A mode the language or the field no longer allows settles to edit.
     */
    private setMode(wanted: Mode): void {
        const next = settleMode(wanted, this._language, this._readOnly);
        if (next === this._mode && (next !== "changes" || this._diffEditor)) {
            return;
        }
        if (next !== "changes") {
            this.closeChanges();
        }
        if (next !== "preview") {
            this.closePreview();
        }
        this._mode = next;
        this._editorHost.hidden = next !== "edit";
        this._diffHost.hidden = next !== "changes";
        this._previewHost.hidden = next !== "preview";
        // Sized before the diff editor is born into it, for the reason the
        // editor's host is (init): a zero-height editor never paints colour.
        this.layout(this._context);
        if (next === "changes") {
            this.openChanges();
            this.layout(this._context);
        } else if (next === "preview") {
            this.showPreview();
        }
        this.renderStatus();
    }

    /**
     * The diff editor over the baseline and the editor's own model: typing
     * on the right is typing in the column, with completion, hover and the
     * markers, because they belong to the model. The left is read-only.
     */
    private openChanges(): void {
        const model = this._editor.getModel();
        if (!model || this._diffEditor) {
            return;
        }
        this._diffOriginal = monaco.editor.createModel(this._baseline.get(), this._language);
        this._diffEditor = monaco.editor.createDiffEditor(this._diffHost, {
            automaticLayout: false,
            readOnly: this._readOnly,
            originalEditable: false,
            // Side by side where there is room; one column below 900px, which
            // is most form fields (Monaco's own breakpoint).
            renderSideBySide: true,
            useInlineViewWhenSpaceIsLimited: true,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            // The diff's own overview ruler is a grey band as wide as two
            // characters, heavy beside a form field; the colour on the lines
            // already says where the changes are.
            renderOverviewRuler: false,
            overflowWidgetsDomNode: this._overflowNode,
            fixedOverflowWidgets: true
        });
        // The suggestion settings are each side's own, not the diff's: the
        // modified side gets the editor's (init), for the reasons given there.
        this._diffEditor.getModifiedEditor().updateOptions({
            wordBasedSuggestions: "off",
            quickSuggestions: { strings: true, other: true, comments: false },
            acceptSuggestionOnEnter: "smart",
            suggest: { showWords: false }
        });
        this._diffEditor.setModel({ original: this._diffOriginal, modified: model });
    }

    /** Dispose the diff and its baseline model; the editor's own model is left alone. */
    private closeChanges(): void {
        if (this._diffEditor) {
            this._diffEditor.dispose();
            this._diffEditor = undefined;
            this._diffHost.replaceChildren();
        }
        this._diffOriginal?.dispose();
        this._diffOriginal = undefined;
    }

    /** Render the document into the preview, or say there is nothing to render. */
    private showPreview(): void {
        this._preview?.dispose();
        this._preview = undefined;
        const text = this._editor.getValue();
        if (text.trim() === "") {
            const empty = document.createElement("p");
            empty.className = "CodeEditor-preview-empty";
            empty.textContent = this.text("Preview_Empty");
            this._previewHost.replaceChildren(empty);
            return;
        }
        this._preview = renderPreview(text, this._previewHost, {
            origin: this._origin,
            open: (url) => this.openUrl(url),
            refusedTitle: (url) => this.text("Preview_ImageNotLoaded", url)
        });
    }

    private closePreview(): void {
        this._preview?.dispose();
        this._preview = undefined;
        this._previewHost?.replaceChildren();
    }

    /**
     * A link pressed in the preview: a new tab, through the platform (P4).
     * Presence is per method, and the bag's methods live on its prototype —
     * `Object.keys(context.navigation)` was empty on the form — so `typeof`.
     */
    private openUrl(url: string): void {
        const navigation = this._context?.navigation as unknown as { openUrl?: (u: string) => void } | undefined;
        if (typeof navigation?.openUrl === "function") {
            navigation.openUrl(url);
        }
    }

    /** A mode button pressed: switch, then move focus off the button that just hid. */
    private switchTo(mode: Mode, then: () => void): void {
        this.setMode(mode);
        then();
    }

    /**
     * A scroll outside the editor: move an open list or hover with the
     * caret, or close it once the caret's line has left what the user can
     * see (clip.ts). Nothing open, nothing to do — the form fires several of
     * these per wheel notch (SPEC.md P1b).
     */
    private followOuterScroll(): void {
        const node = this._overflowNode;
        const editor = this.activeEditor();
        if (!node || !editor || !node.querySelector(".suggest-widget.visible, .monaco-hover:not(.hidden)")) {
            return;
        }
        const position = editor.getPosition();
        const caret = position ? editor.getScrolledVisiblePosition(position) : null;
        const dom = editor.getDomNode();
        if (!caret || !dom) {
            this.closeWidgets();
            return;
        }
        const top = dom.getBoundingClientRect().top + caret.top;
        const area = visibleArea(viewportRect(window), clipRects(this.activeHost()));
        if (lineVisible(area, { top, bottom: top + caret.height })) {
            // Monaco reads the editor's page position again as it lays out.
            editor.render(true);
        } else {
            this.closeWidgets();
        }
    }

    /**
     * File the schema in force for completion and hover (schemaRegistry.ts),
     * or take it back. In force means what validation means by it: JSON,
     * validation on, and the schema loaded — so the list never offers what
     * the check would not hold the document to.
     */
    private registerSchema(): void {
        const model = this._editor?.getModel();
        const load = this._schema.kind === "loaded" ? this._schema.load : undefined;
        const ready = load?.state === "ready" ? load : undefined;
        if (!model || !ready || !this._validate || this._language !== "json") {
            this.unregisterSchema();
            return;
        }
        const uri = model.uri.toString();
        if (uri === this._registeredUri && schemaRegistry.get(uri)?.schema === ready.schema) {
            return; // a keystroke: nothing about the schema changed
        }
        this.unregisterSchema();
        schemaRegistry.set(uri, {
            schema: ready.schema,
            labels: {
                required: this.text("Completion_Required"),
                deprecated: this.text("Completion_Deprecated"),
                defaultValue: this.text("Completion_Default"),
                allowedValues: this.text("Hover_AllowedValues"),
                defaultHeading: this.text("Hover_Default")
            }
        });
        this._registeredUri = uri;
    }

    /**
     * File this editor for FetchXML completion and hover (fetchRegistry.ts),
     * or take it back. Unlike the JSON schema, nothing has to load and
     * validation need not be on: the grammar is always there, and the table
     * definitions are read when something first asks.
     */
    private registerFetch(): void {
        const model = this._editor?.getModel();
        if (!model || this._language !== "fetchxml") {
            this.unregisterFetch();
            return;
        }
        const uri = model.uri.toString();
        if (uri === this._fetchUri) {
            return;
        }
        this.unregisterFetch();
        fetchRegistry.set(uri, {
            metadata: this._metadata,
            labels: {
                required: this.text("Completion_Required"),
                deprecated: this.text("Completion_Deprecated"),
                relationship: this.text("Completion_Relationship"),
                manyToMany: this.text("Completion_ManyToMany"),
                allowedValues: this.text("Hover_AllowedValues"),
                takes: {
                    none: this.text("Hover_TakesNone"),
                    one: this.text("Hover_TakesOne"),
                    count: this.text("Hover_TakesCount"),
                    two: this.text("Hover_TakesTwo"),
                    many: this.text("Hover_TakesMany")
                },
                notReadable: this.text("Hover_NotReadable"),
                shadowOf: this.text("Hover_ShadowOf")
            }
        });
        this._fetchUri = uri;
    }

    private unregisterFetch(): void {
        if (this._fetchUri !== undefined) {
            fetchRegistry.delete(this._fetchUri);
            this._fetchUri = undefined;
        }
    }

    private unregisterSchema(): void {
        if (this._registeredUri !== undefined) {
            schemaRegistry.delete(this._registeredUri);
            this._registeredUri = undefined;
        }
    }

    /**
     * Act on the `schema` input when it changed. An inline schema compiles
     * now; a web resource loads in the background and validates again when
     * it lands — unless another read or destroy() came first. Returns whether
     * anything changed, so updateView knows to validate.
     */
    private readSchema(context: ComponentFramework.Context<IInputs>): boolean {
        const raw = context.parameters.schema?.raw ?? null;
        if (raw === this._schemaRaw) {
            return false;
        }
        this._schemaRaw = raw;
        const token = ++this._schemaToken;
        const source = resolveSchemaSource(raw);

        switch (source.kind) {
            case "none":
            case "unsupported":
                this._schema = { kind: source.kind };
                break;
            case "inline":
                this._schema = { kind: "loaded", name: null, load: fromText(source.text) };
                break;
            case "webResource":
                this._schema = { kind: "loading", name: source.name };
                void loadWebResourceSchema(source.name, clientUrl(context), (url, init) => fetch(url, init)).then((load) => {
                    if (token !== this._schemaToken) {
                        return;
                    }
                    this._schema = { kind: "loaded", name: source.name, load };
                    this.runValidate();
                });
                break;
        }
        return true;
    }

    /* -------------------------------------------------------------- size */

    // Issue #4: size from what the platform allocated instead of 90vh.
    private resolveSize(context: ComponentFramework.Context<IInputs>, contentHeight: number | null): { width: number; height: number } {
        return {
            width: resolveWidth(context.mode.allocatedWidth, this._container.clientWidth),
            height: resolveHeight({
                allocated: context.mode.allocatedHeight,
                preferred: context.parameters.height?.raw ?? null,
                fitContent: this._fitContent,
                contentHeight
            })
        };
    }

    private sizeContainer(context: ComponentFramework.Context<IInputs>, contentHeight: number | null): { width: number; height: number } {
        const size = this.resolveSize(context, contentHeight);
        this._container.style.width = `${size.width}px`;
        this._container.style.height = `${size.height}px`;
        // The three views share one box: whichever shows, the strip stays put.
        const view = `${Math.max(0, size.height - STATUS_BAR_HEIGHT)}px`;
        this._editorHost.style.height = view;
        this._diffHost.style.height = view;
        this._previewHost.style.height = view;
        return size;
    }

    private layout(context: ComponentFramework.Context<IInputs>): void {
        const contentHeight = this._fitContent && this._editor ? this._editor.getContentHeight() : null;
        const size = this.sizeContainer(context, contentHeight);
        const box = { width: size.width, height: Math.max(0, size.height - STATUS_BAR_HEIGHT) };
        this._editor.layout(box);
        this._diffEditor?.layout(box);
    }

    /* -------------------------------------------------------- validation */

    private scheduleValidate(): void {
        if (this._validateTimer !== undefined) {
            window.clearTimeout(this._validateTimer);
        }
        this._validateTimer = window.setTimeout(() => {
            this._validateTimer = undefined;
            this.runValidate();
        }, VALIDATE_DELAY_MS);
    }

    private runValidate(): void {
        const model = this._editor.getModel();
        if (!model) {
            return;
        }

        this._problems = this._validate ? this.findProblems(model.getValue()) : [];

        monaco.editor.setModelMarkers(model, MARKER_OWNER, this._problems.map((p) => ({
            severity: isError(p) ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            message: this.problemText(p),
            startLineNumber: p.line,
            startColumn: p.column,
            endLineNumber: p.line,
            endColumn: p.column + p.length
        })));

        // Everything that can put a schema in or out of force — a language, a
        // switch, a schema landing — comes through here.
        this.registerSchema();
        this.registerFetch();
        this.renderStatus();

        // The verdict is an output a canvas app can act on (a Save button's
        // DisplayMode), so it is handed over when it changes — on a keystroke,
        // a schema landing, or a switch — not only when the text does — and
        // until the host has read one at all (verdict.ts).
        // Validation off is the neutral verdict: valid, 0. A schema asked for
        // and not in force withholds "valid" (schemaWithholdsVerdict). A
        // warning does not count: it is about the environment, not the
        // document (fetchValidate.ts).
        const errors = this._problems.filter(isError).length;
        const report = this._verdict.settle({
            isValid: errors === 0 && !this.schemaWithheld(),
            problemCount: errors
        });
        if (report) {
            this._notifyOutputChanged();
        }
    }

    /**
     * Read what the FetchXML check lacked, then check again — one wait at a
     * time, and never after destroy(). A read that fails is a settled state,
     * so the next check asks for nothing and this ends.
     */
    private awaitMetadata(needs: Need[]): void {
        const metadata = this._metadata;
        if (!metadata || needs.length === 0 || this._awaitingMetadata) {
            return;
        }
        this._awaitingMetadata = true;
        const token = this._schemaToken;
        void metadata.ensure(needs).then(() => {
            this._awaitingMetadata = false;
            if (token === this._schemaToken && this._editor?.getModel()) {
                this.runValidate();
            }
        });
    }

    /** The schema applies to JSON with validation on; elsewhere it withholds nothing. */
    private schemaWithheld(): boolean {
        return this._validate && this._language === "json" && schemaWithholdsVerdict(this._schema);
    }

    private findProblems(text: string): Problem[] {
        this._syntaxFault = false;
        switch (this._language) {
            case "json": {
                // Syntax first: a schema check against half a document is noise.
                const syntax = validateJson(text);
                if (syntax.length > 0) {
                    return syntax;
                }
                const schema = this._schema;
                return schema.kind === "loaded" && schema.load.state === "ready" ? schema.load.validate(text) : [];
            }
            case "xml": {
                const syntax = validateXml(text, xmlParserError);
                this._syntaxFault = syntax.length > 0;
                return syntax;
            }
            case "fetchxml": {
                // Well-formed first; FetchXML's own checks read the tree.
                const syntax = validateXml(text, xmlParserError);
                if (syntax.length > 0) {
                    this._syntaxFault = true;
                    return syntax;
                }
                const checked = fetchValidate(text, this._metadata);
                this.awaitMetadata(checked.needs);
                return checked.problems;
            }
            default:
                return [];
        }
    }

    /* ------------------------------------------------------------ status */

    private buildDom(): void {
        this._root = document.createElement("div");
        this._root.className = "CodeEditor";

        this._editorHost = document.createElement("div");
        this._editorHost.className = "CodeEditor-editor";

        this._status = document.createElement("div");
        this._status.className = "CodeEditor-status";
        this._status.setAttribute("role", "status");

        this._languageLabel = document.createElement("span");
        this._languageLabel.className = "CodeEditor-language";

        this._problemButton = document.createElement("button");
        this._problemButton.type = "button";
        this._problemButton.className = "CodeEditor-problem";
        this._problemButton.hidden = true;
        this._problemButton.addEventListener("click", () => {
            const first = this.shownProblem();
            const editor = this.activeEditor();
            if (!first || !editor) {
                return;
            }
            editor.revealPositionInCenterIfOutsideViewport({ lineNumber: first.line, column: first.column });
            editor.setPosition({ lineNumber: first.line, column: first.column });
            editor.focus();
        });

        this._okLabel = document.createElement("span");
        this._okLabel.className = "CodeEditor-ok";
        this._okLabel.hidden = true;

        this._schemaLabel = document.createElement("span");
        this._schemaLabel.className = "CodeEditor-schema";
        this._schemaLabel.hidden = true;

        this._formatButton = document.createElement("button");
        this._formatButton.type = "button";
        this._formatButton.className = "CodeEditor-format";
        this._formatButton.hidden = true;
        this._formatButton.addEventListener("click", () => {
            // Monaco's own command, so the context menu and Shift+Alt+F do the
            // same thing. `run()` resolves once the edit is in the model, and
            // the content-change handler above notifies the platform.
            void this._editor.getAction("editor.action.formatDocument")?.run();
        });

        // 1.6.0: the diff and the preview take the editor's place in the same
        // box, so the strip never moves.
        this._diffHost = document.createElement("div");
        this._diffHost.className = "CodeEditor-diff";
        this._diffHost.hidden = true;

        this._previewHost = document.createElement("div");
        this._previewHost.className = "CodeEditor-preview";
        this._previewHost.hidden = true;
        // Scrollable by keyboard, and named, since it is a region of its own.
        this._previewHost.tabIndex = 0;
        this._previewHost.setAttribute("role", "region");

        const modeButton = (onPress: () => void): HTMLButtonElement => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "CodeEditor-mode";
            button.hidden = true;
            button.addEventListener("click", onPress);
            return button;
        };
        // A pressed button hides, so focus goes where the user is headed: to
        // the button that comes back, or into the editor on the way back.
        this._changesButton = modeButton(() => this.switchTo("changes", () => this._backButton.focus()));
        this._backButton = modeButton(() => this.switchTo("edit", () => this._editor.focus()));
        this._previewButton = modeButton(() => this.switchTo("preview", () => this._editButton.focus()));
        this._editButton = modeButton(() => this.switchTo("edit", () => this._editor.focus()));

        // The buttons sit together at the strip's right end, Format last.
        const actions = document.createElement("span");
        actions.className = "CodeEditor-actions";
        actions.append(this._changesButton, this._backButton, this._previewButton, this._editButton, this._formatButton);

        this._status.append(this._languageLabel, this._problemButton, this._okLabel, this._schemaLabel, actions);
        this._root.append(this._editorHost, this._diffHost, this._previewHost, this._status);
        this._container.appendChild(this._root);
    }

    private renderStatus(): void {
        this._languageLabel.textContent = displayName(this._language);

        const validating = this._validate && hasValidator(this._language);
        const first = this.shownProblem();

        if (validating && first) {
            const more = this._problems.length - 1;
            const message = document.createElement("span");
            message.className = "CodeEditor-problem-text";
            message.textContent = this.say(said("Status_Position", String(first.line), String(first.column), this.problemText(first)));
            const parts: HTMLElement[] = [message];
            if (more > 0) {
                const count = document.createElement("span");
                count.className = "CodeEditor-problem-more";
                count.textContent = `(${this.text("Status_More", String(more))})`;
                parts.push(count);
            }
            this._problemButton.replaceChildren(...parts);
            // The whole first message, where the strip had to cut it.
            this._problemButton.title = `${message.textContent} — ${this.text("Status_GoToProblem")}`;
            this._problemButton.hidden = false;
            this._okLabel.hidden = true;
        } else {
            // "No problems" is a claim about the whole check; while the
            // schema is loading or missing it would be a claim about half.
            const claim = validating && !this.schemaWithheld();
            this._problemButton.hidden = true;
            this._okLabel.textContent = claim ? this.text("Status_NoProblems") : "";
            this._okLabel.hidden = !claim;
        }

        this._root.classList.toggle("CodeEditor--invalid", validating && !!first && isError(first));
        this._problemButton.classList.toggle("CodeEditor-problem--warning", !!first && !isError(first));

        // The schema applies to JSON, the table definitions to FetchXML; under
        // another language the slot says nothing.
        const schema = validating && this._language === "json"
            ? schemaStatusText(this._schema)
            : this._language === "fetchxml" ? metadataStatusText(this._metadata) : null;
        this._schemaLabel.hidden = schema === null;
        this._schemaLabel.textContent = schema ? this.say({ key: schema.key, args: schema.args }) : "";
        // The strip truncates; the whole sentence is one hover away.
        this._schemaLabel.title = this._schemaLabel.textContent;
        this._schemaLabel.classList.toggle("CodeEditor-schema--failed", !!schema?.failed);

        // Which buttons this mode offers (strip.ts): Format as before, and
        // 1.6.0's Changes, Preview and the two ways back.
        const buttons = stripButtons({
            mode: this._mode,
            language: this._language,
            readOnly: this._readOnly,
            validating,
            syntaxFault: this._syntaxFault,
            differs: this._baseline.differs(this._editor?.getValue() ?? this._code ?? "")
        });
        const show = (button: HTMLButtonElement, on: boolean, label: string, hint: string | null): void => {
            button.hidden = !on;
            if (on) {
                button.textContent = label;
                button.title = hint ?? label;
            }
        };
        show(this._formatButton, buttons.format, this.text("Status_Format"), this.text("Status_FormatHint"));
        show(this._changesButton, buttons.changes, this.text("Status_Changes"), this.text("Status_ChangesHint"));
        show(this._backButton, buttons.backToEditing, this.text("Status_BackToEditing"), null);
        show(this._previewButton, buttons.preview, this.text("Status_Preview"), this.text("Status_PreviewHint"));
        show(this._editButton, buttons.edit, this.text("Status_Edit"), null);
        this._previewHost.setAttribute("aria-label", this.text("Status_Preview"));
    }

    /** The problem the strip names: the first error, else the first warning. */
    private shownProblem(): Problem | undefined {
        return this._problems.find(isError) ?? this._problems[0];
    }

    /**
     * A message in the user's language: its key from the .resx, its arguments
     * rendered the same way, and the English (messages.ts) where a key has no
     * translation — the platform answers a missing key with the key itself.
     */
    private say(s: Said): string {
        return render(s, (key) => {
            const value = this._getString(key);
            return value && value !== key ? value : null;
        });
    }

    /** What a problem says, in the user's language where it has a key. */
    private problemText(p: Problem): string {
        return p.key ? this.say({ key: p.key, args: p.args ?? [] }) : p.message;
    }

    private text(key: string, ...args: string[]): string {
        let value = this._getString(key);
        args.forEach((arg, i) => {
            value = value.replace(`{${i}}`, arg);
        });
        return value;
    }
}

/**
 * The browser's XML parser, reduced to "the text of the fault, or null".
 * `validate.ts` takes this as an argument so it can run where there is no
 * DOMParser; a host without one (none known) gets no XML markers rather than
 * an exception.
 */
function xmlParserError(text: string): string | null {
    if (typeof DOMParser === "undefined") {
        return null;
    }
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const error = doc.getElementsByTagName("parsererror")[0];
    return error ? (error.textContent ?? "") : null;
}

/**
 * What the strip says about the table definitions: only a failure, and only
 * where a read was tried — canvas and the demo make none and say nothing.
 */
function metadataStatusText(metadata: Metadata | null): { key: string; args: string[]; failed: boolean } | null {
    const failure = metadata?.failure();
    if (!failure) {
        return null;
    }
    switch (failure.state) {
        case "denied":
            return { key: "Status_MetadataDenied", args: [], failed: true };
        case "offline":
            return { key: "Status_MetadataOffline", args: [], failed: true };
        default:
            return { key: "Status_MetadataFailed", args: [String(failure.status)], failed: true };
    }
}

/**
 * The organisation URL, where the host offers one. `context.page` is not in
 * the typings for a field control, and was there on a model-driven form
 * (SPEC.md P1); without it the loader asks root-relative, which P1 measured
 * working as well.
 */
function clientUrl(context: ComponentFramework.Context<IInputs>): string | null {
    try {
        const page = (context as unknown as { page?: { getClientUrl?: () => string } }).page;
        return typeof page?.getClientUrl === "function" ? page.getClientUrl() : null;
    } catch {
        return null;
    }
}

/**
 * The environment's origin, from its client URL: the only origin whose images
 * the preview draws (previewPolicy.ts). Null without a URL — a canvas app, the
 * hub's demo — where only `data:` images are drawn.
 */
function originOf(url: string | null): string | null {
    if (!url) {
        return null;
    }
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}
