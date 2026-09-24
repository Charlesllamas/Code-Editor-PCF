import { IInputs, IOutputs } from "./generated/ManifestTypes";
import monaco, { resolveLanguage } from "./monacoSetup";
import { displayName } from "./languages";
import { hasValidator, Problem, validateJson, validateXml } from "./validate";
import { resolveHeight, resolveWidth, STATUS_BAR_HEIGHT } from "./sizing";
import { MonacoTheme, resolveTheme } from "./theme";
import { resolveSchemaSource } from "./schema";
import { fromText, loadWebResourceSchema, SchemaStatus, schemaStatusText, schemaWithholdsVerdict } from "./schemaLoader";

/** Owner key for the markers this control sets; Monaco keeps one list per owner. */
const MARKER_OWNER = "pcf-code-editor";

/** Typing pauses this long before the document is re-validated. */
const VALIDATE_DELAY_MS = 300;

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
    private _theme: MonacoTheme | undefined;
    private _validate = true;
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

        this._editor = monaco.editor.create(this._editorHost, {
            value: this._code ?? "",
            language: this._language,
            readOnly: this._readOnly,
            // The wrapper div owns the size; Monaco is told explicitly via layout().
            automaticLayout: false,
            scrollBeyondLastLine: false,
            minimap: { enabled: false }
        });

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
    }

    /**
     * Called when any value in the property bag has changed.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): void {
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
        const model = this._editor?.getModel();
        if (model) {
            monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
        }
        this._editor?.dispose();
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

    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const theme = resolveTheme(context.parameters.theme?.raw, context.fluentDesignLanguage?.isDarkTheme);
        if (theme === this._theme) {
            return;
        }
        this._theme = theme;
        // Global to the page -- see theme.ts.
        monaco.editor.setTheme(theme);
        this._root.dataset.theme = theme;
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
            severity: monaco.MarkerSeverity.Error,
            message: p.message,
            startLineNumber: p.line,
            startColumn: p.column,
            endLineNumber: p.line,
            endColumn: p.column + p.length
        })));

        this.renderStatus();

        // The verdict is an output a canvas app can act on (a Save button's
        // DisplayMode), so it is handed over when it changes — on a keystroke,
        // a schema landing, or a switch — not only when the text does.
        // Validation off is the neutral verdict: valid, 0. A schema asked for
        // and not in force withholds "valid" (schemaWithholdsVerdict).
        const verdict = {
            isValid: this._problems.length === 0 && !this.schemaWithheld(),
            problemCount: this._problems.length
        };
        if (verdict.isValid !== this._verdict.isValid || verdict.problemCount !== this._verdict.problemCount) {
            this._verdict = verdict;
            this._notifyOutputChanged();
        }
    }

    /** The schema applies to JSON with validation on; elsewhere it withholds nothing. */
    private schemaWithheld(): boolean {
        return this._validate && this._language === "json" && schemaWithholdsVerdict(this._schema);
    }

    private findProblems(text: string): Problem[] {
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
            case "xml":
                return validateXml(text, xmlParserError);
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
            const first = this._problems[0];
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
        const first = this._problems[0];

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

        this._root.classList.toggle("CodeEditor--invalid", validating && !!first);

        // The schema applies to JSON; under another language it says nothing.
        const schema = validating && this._language === "json" ? schemaStatusText(this._schema) : null;
        this._schemaLabel.hidden = schema === null;
        this._schemaLabel.textContent = schema ? this.text(schema.key, ...schema.args) : "";
        // The strip truncates; the whole sentence is one hover away.
        this._schemaLabel.title = this._schemaLabel.textContent;
        this._schemaLabel.classList.toggle("CodeEditor-schema--failed", !!schema?.failed);

        // XML is formatted only when it is well-formed, so the button hides
        // while validation is showing a fault; with validation off it shows,
        // and a broken document is left as it is (formatXml declines).
        const canFormat = !this._readOnly
            && (this._language === "json" || (this._language === "xml" && !(validating && first)));
        this._formatButton.hidden = !canFormat;
        if (canFormat) {
            this._formatButton.textContent = this.text("Status_Format");
            this._formatButton.title = this.text("Status_FormatHint");
        }
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
