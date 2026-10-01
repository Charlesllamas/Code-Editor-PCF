import { IInputs, IOutputs } from "./generated/ManifestTypes";
import monaco, { resolveLanguage } from "./monacoSetup";
import { displayName, isXmlFamily } from "./languages";
import { hasValidator, isError, Problem, validateJson, validateXml } from "./validate";
import { resolveHeight, resolveWidth, STATUS_BAR_HEIGHT } from "./sizing";
import { MonacoTheme, pageTheme, ThemeVote } from "./theme";
import { resolveSchemaSource } from "./schema";
import { fromText, loadWebResourceSchema, SchemaStatus, schemaStatusText, schemaWithholdsVerdict } from "./schemaLoader";
import { schemaRegistry } from "./schemaRegistry";
import { lineVisible, visibleArea } from "./clip";
import { fetchValidate } from "./fetchValidate";
import { fetchRegistry } from "./fetchRegistry";
import { Metadata, Need, metadataFor } from "./metadata";
import { clipRects, createOverflowNode, viewportRect, watchOuterScroll } from "./overflow";
// THROWAWAY: the 1.4.9 probe (SPEC.md P1–P7). Remove with probe.ts before 1.5.0.
import * as probe from "./probe";

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
    private _validateTimer: number | undefined;
    private _problems: Problem[] = [];
    private _getString: (key: string) => string;

    /** The raw schema input last acted on; undefined until the first read. */
    private _schemaRaw: string | null | undefined = undefined;
    private _schema: SchemaStatus = { kind: "none" };
    /** Bumped per schema read and on destroy: a load that lost the race is dropped. */
    private _schemaToken = 0;
    /** The verdict last handed to the host through getOutputs. */
    private _verdict = { isValid: true, problemCount: 0 };

    /**
     * Used to initialize the control instance.
     */
    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
        this._container = container;
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

        // Decided once per mount: the organisation URL does not change between
        // passes, and every editor on the page shares the reader (metadata.ts).
        const url = clientUrl(context);
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

        this.layout(context);
        this.readSchema(context);
        this.runValidate();
        probe.see(context); // THROWAWAY (probe)
    }

    /**
     * Called when any value in the property bag has changed.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): void {
        probe.see(context); // THROWAWAY (probe)
        const previouslyValidating = this._validate;
        this.readInputs(context);
        this._editor.updateOptions({ readOnly: this._readOnly });
        this.applyTheme(context);

        // Issue #3 / alias handling: swap the model's language in place.
        const language = resolveLanguage(context.parameters.language.raw);
        const languageChanged = language !== this._language;
        if (languageChanged) {
            const current = this._editor.getModel();
            if (current) {
                monaco.editor.setModelLanguage(current, language);
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
        const model = this._editor.getModel();
        const incoming = context.parameters.code.raw ?? "";
        let valueChanged = false;
        if (model && incoming !== model.getValue() && !this._editor.hasTextFocus()) {
            this._suppressChange = true;
            model.setValue(incoming);
            this._suppressChange = false;
            this._code = context.parameters.code.raw ?? null;
            valueChanged = true;
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
        return {
            // Null, never undefined, for a column nobody has typed in: see _code.
            code: this._code ?? (null as unknown as string),
            isValid: this._verdict.isValid,
            problemCount: this._verdict.problemCount
        };
    }

    /**
     * Called when the control is to be removed from the DOM tree.
     */
    public destroy(): void {
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
        this._editor?.trigger(MARKER_OWNER, "hideSuggestWidget", {});
        this._editor?.trigger(MARKER_OWNER, "editor.action.hideHover", {});
    }

    /**
     * A scroll outside the editor: move an open list or hover with the
     * caret, or close it once the caret's line has left what the user can
     * see (clip.ts). Nothing open, nothing to do — the form fires several of
     * these per wheel notch (SPEC.md P1b).
     */
    private followOuterScroll(): void {
        const node = this._overflowNode;
        if (!node || !this._editor || !node.querySelector(".suggest-widget.visible, .monaco-hover:not(.hidden)")) {
            return;
        }
        const position = this._editor.getPosition();
        const caret = position ? this._editor.getScrolledVisiblePosition(position) : null;
        const dom = this._editor.getDomNode();
        if (!caret || !dom) {
            this.closeWidgets();
            return;
        }
        const top = dom.getBoundingClientRect().top + caret.top;
        const area = visibleArea(viewportRect(window), clipRects(this._editorHost));
        if (lineVisible(area, { top, bottom: top + caret.height })) {
            // Monaco reads the editor's page position again as it lays out.
            this._editor.render(true);
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
        this._editorHost.style.height = `${Math.max(0, size.height - STATUS_BAR_HEIGHT)}px`;
        return size;
    }

    private layout(context: ComponentFramework.Context<IInputs>): void {
        const contentHeight = this._fitContent && this._editor ? this._editor.getContentHeight() : null;
        const size = this.sizeContainer(context, contentHeight);
        this._editor.layout({ width: size.width, height: Math.max(0, size.height - STATUS_BAR_HEIGHT) });
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
            message: p.message,
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
        // a schema landing, or a switch — not only when the text does.
        // Validation off is the neutral verdict: valid, 0. A schema asked for
        // and not in force withholds "valid" (schemaWithholdsVerdict). A
        // warning does not count: it is about the environment, not the
        // document (fetchValidate.ts).
        const errors = this._problems.filter(isError).length;
        const verdict = {
            isValid: errors === 0 && !this.schemaWithheld(),
            problemCount: errors
        };
        if (verdict.isValid !== this._verdict.isValid || verdict.problemCount !== this._verdict.problemCount) {
            this._verdict = verdict;
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
            if (!first) {
                return;
            }
            this._editor.revealPositionInCenterIfOutsideViewport({ lineNumber: first.line, column: first.column });
            this._editor.setPosition({ lineNumber: first.line, column: first.column });
            this._editor.focus();
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

        this._status.append(this._languageLabel, this._problemButton, this._okLabel, this._schemaLabel, this._formatButton);
        this._root.append(this._editorHost, this._status);
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
            message.textContent = `Ln ${first.line}, Col ${first.column}: ${first.message}`;
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
        this._schemaLabel.textContent = schema ? this.text(schema.key, ...schema.args) : "";
        // The strip truncates; the whole sentence is one hover away.
        this._schemaLabel.title = this._schemaLabel.textContent;
        this._schemaLabel.classList.toggle("CodeEditor-schema--failed", !!schema?.failed);

        // XML is formatted only when it is well-formed, so the button hides
        // while validation is showing a fault; with validation off it shows,
        // and a broken document is left as it is (formatXml declines).
        const canFormat = !this._readOnly
            && (this._language === "json" || (isXmlFamily(this._language) && !(validating && this._syntaxFault)));
        this._formatButton.hidden = !canFormat;
        if (canFormat) {
            this._formatButton.textContent = this.text("Status_Format");
            this._formatButton.title = this.text("Status_FormatHint");
        }
    }

    /** The problem the strip names: the first error, else the first warning. */
    private shownProblem(): Problem | undefined {
        return this._problems.find(isError) ?? this._problems[0];
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
