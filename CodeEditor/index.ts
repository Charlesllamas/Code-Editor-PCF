import { IInputs, IOutputs } from "./generated/ManifestTypes";
import monaco, { rangeOf, resolveLanguage } from "./monacoSetup";
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
import { JsonView, MarkdownView, Mode, initialMode, readJsonView, readMarkdownView, settleMode, stripButtons } from "./strip";
import { renderPreview } from "./preview";
import { Row, Segment, Tree, TreeNode, buildTree, expandTo, formatPath, nearestNode, nodeAtOffset, pathKey, previewOf, selectionOf, visibleRows } from "./jsonTree";
import { isTypeAhead, treeKey, typeAhead } from "./treeKeys";
import { Buffer, nextBuffer } from "./lib/tree-keys/typeAhead";
import { pageOf, scrollFor, windowOf } from "./treeWindow";
import { canCopy, copyText } from "./copy";
import { firstOf, schemasAt } from "./schemaNav";

/** 1.7.0: every tree row is this tall, so the window of rows drawn is arithmetic (treeWindow.ts). */
const TREE_ROW_HEIGHT = 22;

/** Each control's tree rows need ids no other editor on the form uses: aria-activedescendant names one. */
let treeIds = 0;

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
    /**
     * 1.7.0: the tree's box; inside it the scroller that holds focus and
     * names the focused row with aria-activedescendant, the rows' full-height
     * track, and the message shown instead when there is no tree.
     */
    private _treeHost: HTMLDivElement;
    private _treeView: HTMLDivElement;
    private _treeRowsBox: HTMLDivElement;
    private _treeMessage: HTMLDivElement;
    private _treeButton: HTMLButtonElement;
    private _copyPathButton: HTMLButtonElement;
    /** The focused node's path in the strip; hidden from the status region, which would read every move. */
    private _pathLabel: HTMLSpanElement;
    /** "Copied", for a moment — inside the status region, so it is announced. */
    private _announce: HTMLSpanElement;

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
    /** `jsonView` as last read (1.7.0); a change re-decides the mode. */
    private _jsonView: JsonView | undefined = undefined;
    /** The document as a tree, built when the tree opens and when the value changes under it. */
    private _tree: Tree | undefined;
    private _treeRows: Row[] = [];
    private _treeFocus = 0;
    /** Open nodes by path (jsonTree.ts `pathKey`): survives a rebuild, and a trip to the editor and back. */
    private _treeExpanded = new Set<string>();
    private readonly _treeId = `CodeEditor-tree-${++treeIds}`;
    /** The tree's visible height, as sizeContainer set it — clientHeight is 0 on a tab not yet shown. */
    private _treeViewHeight = 0;
    /** Type-ahead's search so far (lib/tree-keys: it grows while the keys come within 500 ms). */
    private _typed: Buffer | null = null;
    private _announceTimer: number | undefined;
    private _canCopy = true;

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
        this._canCopy = canCopy(this._container.ownerDocument);
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
        this.readViews(context);
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
        if (!this.readViews(context)) {
            this.setMode(this._mode);
        }
        if (valueChanged && this._mode === "preview") {
            this.showPreview();
        }
        // A form script or a demo preset changed the document under the open
        // tree: rebuilt, with what was open and the focus kept by path.
        if (valueChanged && this._mode === "tree") {
            this.showTree("focus");
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
        this.closeTree();
        if (this._announceTimer !== undefined) {
            window.clearTimeout(this._announceTimer);
            this._announceTimer = undefined;
        }
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
        switch (this._mode) {
            case "changes":
                return this._diffHost;
            case "preview":
                return this._previewHost;
            case "tree":
                return this._treeHost;
            default:
                return this._editorHost;
        }
    }

    /** Typing in either editor holds a value the form's echo must not overwrite (echo.ts). */
    private editorHasFocus(): boolean {
        return this._editor.hasTextFocus() || (this._diffEditor?.getModifiedEditor().hasTextFocus() ?? false);
    }

    /**
     * Act on `markdownView` or `jsonView` when either changed: they decide
     * the mode a Markdown or a JSON editor mounts in, and the hub's demo
     * switches them on a mounted control. Returns whether either changed.
     */
    private readViews(context: ComponentFramework.Context<IInputs>): boolean {
        const view = readMarkdownView(context.parameters.markdownView?.raw);
        const jsonView = readJsonView(context.parameters.jsonView?.raw);
        if (view === this._markdownView && jsonView === this._jsonView) {
            return false;
        }
        this._markdownView = view;
        this._jsonView = jsonView;
        this.setMode(initialMode(view, this._language, jsonView));
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
        if (next !== "tree") {
            this.closeTree();
        }
        this._mode = next;
        this._editorHost.hidden = next !== "edit";
        this._diffHost.hidden = next !== "changes";
        this._previewHost.hidden = next !== "preview";
        this._treeHost.hidden = next !== "tree";
        // Sized before the diff editor is born into it, for the reason the
        // editor's host is (init): a zero-height editor never paints colour.
        this.layout(this._context);
        if (next === "changes") {
            this.openChanges();
            this.layout(this._context);
        } else if (next === "preview") {
            this.showPreview();
        } else if (next === "tree") {
            this.showTree("cursor");
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

    /* ------------------------------------------------- 1.7.0: the tree */

    /**
     * Build the tree from the document and show it. `from` says which node
     * takes the focus: the one under the editor's caret when the tree opens,
     * or the one that had it when the value changed underneath — or its
     * nearest ancestor left, if the change took it away.
     */
    private showTree(from: "cursor" | "focus"): void {
        const before = this._treeRows[this._treeFocus]?.node.path;
        const text = this._editor.getValue();
        this._tree = buildTree(text);
        if (this._tree.kind !== "ok") {
            this._treeRows = [];
            this._treeFocus = 0;
            this.renderTree();
            return;
        }
        const root = this._tree.root;
        let focus: TreeNode;
        if (from === "focus" && before) {
            focus = nearestNode(root, before);
        } else {
            const model = this._editor.getModel();
            const position = this._editor.getPosition();
            focus = model && position ? nodeAtOffset(root, model.getOffsetAt(position)) : root;
        }
        // The root opens the first time; after that, what the user opened stays open.
        if (this._treeExpanded.size === 0) {
            this._treeExpanded.add(pathKey([]));
        }
        this._treeExpanded = expandTo(this._treeExpanded, focus);
        this._treeRows = visibleRows(root, this._treeExpanded);
        this._treeFocus = Math.max(0, this._treeRows.findIndex((r) => r.node === focus));
        this.renderTree();
        this.scrollTreeTo(this._treeFocus);
    }

    private closeTree(): void {
        this._tree = undefined;
        this._treeRows = [];
        this._treeRowsBox?.replaceChildren();
        this._treeView?.removeAttribute("aria-activedescendant");
    }

    /** The tree, or the message that stands in for it: a fault, or nothing yet. */
    private renderTree(): void {
        const tree = this._tree;
        const ok = tree?.kind === "ok";
        this._treeView.hidden = !ok;
        this._treeMessage.hidden = ok;
        if (tree && tree.kind === "faults") {
            const first = tree.first;
            const text = document.createElement("p");
            text.textContent = this.text("Tree_Faults", this.say(said("Status_Position", String(first.line), String(first.column), this.problemText(first))));
            const go = document.createElement("button");
            go.type = "button";
            go.className = "CodeEditor-tree-fault";
            go.textContent = this.text("Tree_GoToFault");
            go.addEventListener("click", () => {
                this.setMode("edit");
                this._editor.revealPositionInCenterIfOutsideViewport({ lineNumber: first.line, column: first.column });
                this._editor.setPosition({ lineNumber: first.line, column: first.column });
                this._editor.focus();
            });
            this._treeMessage.replaceChildren(text, go);
        } else if (!ok) {
            const text = document.createElement("p");
            text.textContent = this.text("Tree_Empty");
            this._treeMessage.replaceChildren(text);
        }
        this._treeRowsBox.style.height = `${this._treeRows.length * TREE_ROW_HEIGHT}px`;
        this.renderTreeRows();
        this.renderStatus();
    }

    /**
     * Draw the rows in view, and only those (treeWindow.ts): a 1 MB document
     * is forty thousand rows, and drawing them all took most of a second on
     * the form (SPEC.md, the 1.6.9 probe, P1).
     */
    private renderTreeRows(): void {
        if (this._mode !== "tree" || this._tree?.kind !== "ok") {
            return;
        }
        const height = this._treeViewHeight || this._treeView.clientHeight;
        const { first, end } = windowOf(this._treeView.scrollTop, height, TREE_ROW_HEIGHT, this._treeRows.length);
        const drawn: HTMLElement[] = [];
        for (let i = first; i < end; i++) {
            drawn.push(this.treeRow(this._treeRows[i], i));
        }
        this._treeRowsBox.replaceChildren(...drawn);
        const focused = this._treeRows[this._treeFocus];
        if (focused) {
            this._treeView.setAttribute("aria-activedescendant", this.treeRowId(this._treeFocus));
        } else {
            this._treeView.removeAttribute("aria-activedescendant");
        }
    }

    private treeRowId(index: number): string {
        return `${this._treeId}-${index}`;
    }

    /** One row: a twisty, the name, and the value or its count — named for a screen reader without the braces. */
    private treeRow(row: Row, index: number): HTMLElement {
        const node = row.node;
        const item = document.createElement("div");
        item.className = "CodeEditor-tree-row";
        item.id = this.treeRowId(index);
        item.setAttribute("role", "treeitem");
        item.setAttribute("aria-level", String(row.level));
        item.setAttribute("aria-setsize", String(row.setSize));
        item.setAttribute("aria-posinset", String(row.posInSet));
        item.setAttribute("aria-selected", index === this._treeFocus ? "true" : "false");
        if (row.expanded !== undefined) {
            item.setAttribute("aria-expanded", row.expanded ? "true" : "false");
        }
        item.style.top = `${index * TREE_ROW_HEIGHT}px`;
        item.style.setProperty("--CodeEditor-tree-level", String(row.level - 1));
        item.dataset.index = String(index);

        const twisty = document.createElement("span");
        twisty.className = "CodeEditor-tree-twisty";
        twisty.setAttribute("aria-hidden", "true");
        twisty.textContent = row.expanded === true ? "▾" : row.expanded === false ? "▸" : "";

        const name = node.key === null ? "$" : String(node.key);
        const key = document.createElement("span");
        key.className = typeof node.key === "number" ? "CodeEditor-tree-key CodeEditor-tree-index" : "CodeEditor-tree-key";
        key.textContent = name;

        const value = document.createElement("span");
        value.className = `CodeEditor-tree-value CodeEditor-tree--${node.type}`;
        value.textContent = previewOf(node);

        const spoken = node.type === "object"
            ? this.text("Tree_Keys", String(node.count))
            : node.type === "array" ? this.text("Tree_Items", String(node.count)) : value.textContent;
        item.setAttribute("aria-label", `${name}: ${spoken}`);
        const description = this.describeNode(node.path);
        // The whole string where the row cut it, and what the schema says about the place.
        item.title = [node.type === "string" ? JSON.stringify(node.value) : null, description].filter((s) => !!s).join("\n");
        item.append(twisty, key, value);
        return item;
    }

    /** What the schema in force says about a place: its description, else its title — plain text, never rendered. */
    private describeNode(path: Segment[]): string | null {
        const load = this._schema.kind === "loaded" ? this._schema.load : undefined;
        if (!this._validate || this._language !== "json" || load?.state !== "ready") {
            return null;
        }
        const schemas = schemasAt(load.schema, path);
        const text = firstOf(schemas, "description") ?? firstOf(schemas, "title");
        return typeof text === "string" && text.trim() !== "" ? text.trim() : null;
    }

    /** Move focus to row `index`, scrolled into view, and redraw. */
    private focusTreeRow(index: number): void {
        this._treeFocus = Math.max(0, Math.min(index, this._treeRows.length - 1));
        this.scrollTreeTo(this._treeFocus);
        this.renderTreeRows();
        this.renderStatus();
    }

    private scrollTreeTo(index: number): void {
        const height = this._treeViewHeight || this._treeView.clientHeight;
        const top = scrollFor(index, this._treeView.scrollTop, height, TREE_ROW_HEIGHT);
        if (top !== this._treeView.scrollTop) {
            this._treeView.scrollTop = top;
        }
    }

    /** Open or close nodes, keeping the focus where treeKeys.ts put it. */
    private setExpanded(expanded: Set<string>, focus: number): void {
        const tree = this._tree;
        if (tree?.kind !== "ok") {
            return;
        }
        this._treeExpanded = expanded;
        this._treeRows = visibleRows(tree.root, expanded);
        this._treeRowsBox.style.height = `${this._treeRows.length * TREE_ROW_HEIGHT}px`;
        this.focusTreeRow(focus);
    }

    /** A key on the tree (treeKeys.ts); one the tree does not take goes on to the form untouched. */
    private onTreeKey(e: KeyboardEvent): void {
        const press = { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
        if (this._treeRows.length === 0) {
            return;
        }
        if (isTypeAhead(press)) {
            const now = Date.now();
            this._typed = nextBuffer(this._typed, e.key, now);
            const index = typeAhead(this._treeRows, this._treeFocus, this._typed.text);
            if (index >= 0) {
                this.focusTreeRow(index);
            }
            e.preventDefault();
            return;
        }
        // Text the user selected in the tree is theirs to copy: Ctrl+C is the browser's then.
        const selection = this._container.ownerDocument.getSelection();
        if ((press.ctrl || press.meta) && selection && !selection.isCollapsed && this._treeView.contains(selection.anchorNode)) {
            return;
        }
        const height = this._treeViewHeight || this._treeView.clientHeight;
        const result = treeKey(this._treeRows, this._treeFocus, this._treeExpanded, press, pageOf(height, TREE_ROW_HEIGHT));
        if (!result.handled) {
            return;
        }
        e.preventDefault();
        if (result.expanded.size !== this._treeExpanded.size || [...result.expanded].some((k) => !this._treeExpanded.has(k))) {
            this.setExpanded(result.expanded, result.focus);
        } else {
            this.focusTreeRow(result.focus);
        }
        if (result.action === "reveal") {
            this.revealTreeRow(this._treeFocus);
        } else if (result.action === "copy") {
            this.copyTreePath();
        }
    }

    /** A click on a row focuses it; on the twisty it also opens or closes the node. */
    private onTreeClick(e: MouseEvent): void {
        const item = (e.target as HTMLElement | null)?.closest<HTMLElement>(".CodeEditor-tree-row");
        const index = item ? Number(item.dataset.index) : NaN;
        if (!Number.isInteger(index)) {
            return;
        }
        this._treeView.focus();
        const row = this._treeRows[index];
        if ((e.target as HTMLElement).classList.contains("CodeEditor-tree-twisty") && row?.expanded !== undefined) {
            const next = new Set(this._treeExpanded);
            const key = pathKey(row.node.path);
            if (row.expanded) {
                next.delete(key);
            } else {
                next.add(key);
            }
            this.setExpanded(next, index);
            return;
        }
        this.focusTreeRow(index);
    }

    /** Back to the editor with the node's text selected: from its name to the end of its value. */
    private revealTreeRow(index: number): void {
        const node = this._treeRows[index]?.node;
        const model = this._editor.getModel();
        if (!node || !model) {
            return;
        }
        const { start, end } = selectionOf(node);
        this.setMode("edit");
        const range = rangeOf(model, start, end);
        this._editor.setSelection(range);
        this._editor.revealRangeInCenterIfOutsideViewport(range);
        this._editor.focus();
    }

    /** The focused node's path onto the clipboard (copy.ts), and a word in the strip either way. */
    private copyTreePath(): void {
        const node = this._treeRows[this._treeFocus]?.node;
        if (!node) {
            return;
        }
        const path = formatPath(node.path);
        void copyText(path, this._container.ownerDocument).then((how) => {
            this.announce(how ? this.text("Tree_Copied", path) : this.text("Tree_CopyFailed"));
        });
    }

    /**
     * Say something in the strip for a few seconds. Blanked first, so the
     * same words twice are announced twice (`pcf-copy-field`'s finding).
     */
    private announce(message: string): void {
        if (this._announceTimer !== undefined) {
            window.clearTimeout(this._announceTimer);
        }
        this._announce.textContent = "";
        this._announce.hidden = false;
        window.setTimeout(() => {
            this._announce.textContent = message;
        }, 50);
        this._announceTimer = window.setTimeout(() => {
            this._announceTimer = undefined;
            this._announce.textContent = "";
            this._announce.hidden = true;
        }, 3000);
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
        this._treeHost.style.height = view;
        this._treeViewHeight = Math.max(0, size.height - STATUS_BAR_HEIGHT);
        return size;
    }

    private layout(context: ComponentFramework.Context<IInputs>): void {
        const contentHeight = this._fitContent && this._editor ? this._editor.getContentHeight() : null;
        const size = this.sizeContainer(context, contentHeight);
        const box = { width: size.width, height: Math.max(0, size.height - STATUS_BAR_HEIGHT) };
        this._editor.layout(box);
        this._diffEditor?.layout(box);
        // A taller box shows more rows: the window is drawn again for it.
        this.renderTreeRows();
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

        // 1.7.0: the tree takes the same box. The scroller is the one tab
        // stop and holds focus; the rows are never focused themselves, so a
        // row scrolled out of the window is never a lost focus — the scroller
        // names the focused row with aria-activedescendant instead.
        this._treeHost = document.createElement("div");
        this._treeHost.className = "CodeEditor-tree";
        this._treeHost.hidden = true;

        this._treeView = document.createElement("div");
        this._treeView.className = "CodeEditor-tree-view";
        this._treeView.setAttribute("role", "tree");
        this._treeView.tabIndex = 0;
        this._treeRowsBox = document.createElement("div");
        this._treeRowsBox.className = "CodeEditor-tree-rows";
        this._treeView.append(this._treeRowsBox);
        this._treeView.addEventListener("keydown", (e) => this.onTreeKey(e));
        this._treeView.addEventListener("click", (e) => this.onTreeClick(e));
        this._treeView.addEventListener("dblclick", (e) => {
            const item = (e.target as HTMLElement | null)?.closest<HTMLElement>(".CodeEditor-tree-row");
            if (item && !(e.target as HTMLElement).classList.contains("CodeEditor-tree-twisty")) {
                this.revealTreeRow(Number(item.dataset.index));
            }
        });
        this._treeView.addEventListener("scroll", () => this.renderTreeRows());

        this._treeMessage = document.createElement("div");
        this._treeMessage.className = "CodeEditor-tree-message";
        this._treeMessage.hidden = true;
        this._treeHost.append(this._treeView, this._treeMessage);

        this._pathLabel = document.createElement("span");
        this._pathLabel.className = "CodeEditor-path";
        this._pathLabel.hidden = true;
        // The tree already names each row as focus moves; the strip saying it
        // again inside a status region would be read on every arrow.
        this._pathLabel.setAttribute("aria-hidden", "true");

        this._announce = document.createElement("span");
        this._announce.className = "CodeEditor-announce";
        this._announce.hidden = true;

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
        this._treeButton = modeButton(() => this.switchTo("tree", () => this._treeView.focus()));
        // Copy path leaves focus on the tree, where the next node is a key away.
        this._copyPathButton = modeButton(() => {
            this.copyTreePath();
            this._treeView.focus();
        });

        // The buttons sit together at the strip's right end, Format last.
        const actions = document.createElement("span");
        actions.className = "CodeEditor-actions";
        actions.append(this._changesButton, this._backButton, this._previewButton, this._treeButton, this._copyPathButton, this._editButton, this._formatButton);

        this._status.append(this._languageLabel, this._problemButton, this._okLabel, this._schemaLabel, this._pathLabel, this._announce, actions);
        this._root.append(this._editorHost, this._diffHost, this._previewHost, this._treeHost, this._status);
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

        // 1.7.0: in the tree the strip says where the focus is — the path
        // Copy path would copy, and what the schema says about the place. A
        // fault is the tree's own message there, so the problem slot rests.
        const inTree = this._mode === "tree";
        const focused = inTree ? this._treeRows[this._treeFocus]?.node : undefined;
        if (inTree) {
            this._problemButton.hidden = true;
            this._okLabel.hidden = true;
            this._schemaLabel.hidden = true;
        }
        this._pathLabel.hidden = !focused;
        if (focused) {
            const path = formatPath(focused.path);
            const description = this.describeNode(focused.path);
            this._pathLabel.textContent = description ? `${path} — ${description}` : path;
            this._pathLabel.title = this._pathLabel.textContent;
        }

        // Which buttons this mode offers (strip.ts): Format as before,
        // 1.6.0's Changes, Preview and the two ways back, and 1.7.0's Tree
        // and Copy path.
        const buttons = stripButtons({
            mode: this._mode,
            language: this._language,
            readOnly: this._readOnly,
            validating,
            syntaxFault: this._syntaxFault,
            differs: this._baseline.differs(this._editor?.getValue() ?? this._code ?? ""),
            treeFocus: !!focused,
            canCopy: this._canCopy
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
        show(this._treeButton, buttons.tree, this.text("Status_Tree"), this.text("Status_TreeHint"));
        show(this._copyPathButton, buttons.copyPath, this.text("Status_CopyPath"), this.text("Status_CopyPathHint"));
        this._previewHost.setAttribute("aria-label", this.text("Status_Preview"));
        this._treeView.setAttribute("aria-label", this.text("Tree_Label"));
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
