import { IInputs, IOutputs } from "./generated/ManifestTypes";
import monaco, { resolveLanguage } from "./monacoSetup";

// Model-driven forms report allocatedHeight as -1 when the container is
// unconstrained. 90vh was the old hardcoded value behind issue #4.
const FALLBACK_HEIGHT = 500;

export class CodeEditor implements ComponentFramework.StandardControl<IInputs, IOutputs> {

    private _container: HTMLDivElement;
    private _notifyOutputChanged: () => void;
    private _editor: monaco.editor.IStandaloneCodeEditor;
    private _code: string | undefined;
    private _language: string;
    private _suppressChange = false;

    /**
     * Used to initialize the control instance.
     */
    public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
        this._container = container;
        this._notifyOutputChanged = notifyOutputChanged;

        // Ask the platform to report container size changes through updateView.
        context.mode.trackContainerResize(true);

        this._container.style.boxSizing = "border-box";
        this._container.style.overflow = "hidden";
        // Monaco never resets text-align on its view lines, so an alignment
        // inherited from the host shifts every rendered glyph sideways -- the
        // PCF test harness centres its wrapper, which pushed the code 318px in.
        this._container.style.textAlign = "left";

        // The container must have its size before the editor is created. An
        // editor born into a zero-height div registers no visible lines, and
        // then never repaints when background tokenization finishes -- the
        // symptom is a fully functional editor that renders without any syntax
        // colouring at all.
        this.sizeContainer(context);

        this._code = context.parameters.code.raw || "";
        this._language = resolveLanguage(context.parameters.language.raw);

        this._editor = monaco.editor.create(this._container, {
            value: this._code,
            language: this._language,
            readOnly: this.isReadOnly(context),
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
        });
    }

    /**
     * Called when any value in the property bag has changed.
     */
    public updateView(context: ComponentFramework.Context<IInputs>): void {
        const readOnly = this.isReadOnly(context);
        this._editor.updateOptions({ readOnly });

        // Issue #3 / alias handling: swap the model's language in place.
        const language = resolveLanguage(context.parameters.language.raw);
        if (language !== this._language) {
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
        const incoming = context.parameters.code.raw || "";
        if (model && incoming !== model.getValue() && !this._editor.hasTextFocus()) {
            this._suppressChange = true;
            model.setValue(incoming);
            this._suppressChange = false;
            this._code = incoming;
        }

        this.layout(context);
    }

    /**
     * @returns an object based on nomenclature defined in manifest.
     */
    public getOutputs(): IOutputs {
        return {
            code: this._code ?? ""
        };
    }

    /**
     * Called when the control is to be removed from the DOM tree.
     */
    public destroy(): void {
        this._editor?.dispose();
    }

    // Issue #2: honour both the form-level lock and field level security.
    private isReadOnly(context: ComponentFramework.Context<IInputs>): boolean {
        const secured = context.parameters.code.security;
        return context.mode.isControlDisabled || (secured ? !secured.editable : false);
    }

    // Issue #4: size from what the platform allocated instead of 90vh.
    private resolveSize(context: ComponentFramework.Context<IInputs>): { width: number; height: number } {
        const width = context.mode.allocatedWidth;
        const height = context.mode.allocatedHeight;
        return {
            width: width > 0 ? width : this._container.clientWidth,
            height: height > 0 ? height : FALLBACK_HEIGHT
        };
    }

    private sizeContainer(context: ComponentFramework.Context<IInputs>): { width: number; height: number } {
        const size = this.resolveSize(context);
        this._container.style.width = `${size.width}px`;
        this._container.style.height = `${size.height}px`;
        return size;
    }

    private layout(context: ComponentFramework.Context<IInputs>): void {
        const size = this.sizeContainer(context);
        this._editor.layout({ width: size.width, height: size.height });
    }
}
