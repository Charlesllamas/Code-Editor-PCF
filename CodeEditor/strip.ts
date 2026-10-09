/**
 * The control's three modes, and which buttons the strip under the editor
 * offers in each.
 *
 * - **edit**: the editor, as every version before 1.6.0 had it.
 * - **changes**: the document against the baseline (baseline.ts) in Monaco's
 *   diff editor, whose modified side is the editor's own model — so typing
 *   there is typing in the column.
 * - **preview**: Markdown rendered (previewPolicy.ts), read-only.
 *
 * Pure, so the suite loads it from source; `index.ts` turns the answers into
 * DOM.
 */

import { isXmlFamily } from "./languages";

export type Mode = "edit" | "changes" | "preview";

/** The `markdownView` property's values; anything else is the default. */
export type MarkdownView = "edit" | "preview";

export interface StripState {
    mode: Mode;
    language: string;
    readOnly: boolean;
    /** Validation on, and the language has a validator. */
    validating: boolean;
    /** The last check found the document not well-formed (XML, FetchXML). */
    syntaxFault: boolean;
    /** The document differs from the baseline. */
    differs: boolean;
}

export interface StripButtons {
    format: boolean;
    changes: boolean;
    preview: boolean;
    edit: boolean;
    backToEditing: boolean;
}

/** What a maker typed in `markdownView`, or the default. A canvas formula can supply anything. */
export function readMarkdownView(raw: unknown): MarkdownView {
    return String(raw ?? "").trim().toLowerCase() === "preview" ? "preview" : "edit";
}

/** The mode a control mounts in, or returns to when `markdownView` changes. */
export function initialMode(view: MarkdownView, language: string): Mode {
    return view === "preview" && language === "markdown" ? "preview" : "edit";
}

/**
 * The mode the control can stay in after something changed underneath it:
 * the preview is Markdown's alone, and a field the user cannot edit has no
 * changes of theirs to show.
 */
export function settleMode(mode: Mode, language: string, readOnly: boolean): Mode {
    if (mode === "preview" && language !== "markdown") {
        return "edit";
    }

    if (mode === "changes" && readOnly) {
        return "edit";
    }

    return mode;
}

export function stripButtons(state: StripState): StripButtons {
    const none: StripButtons = { format: false, changes: false, preview: false, edit: false, backToEditing: false };

    switch (state.mode) {
        case "changes":
            return { ...none, backToEditing: true };
        case "preview":
            return { ...none, edit: true };
        default:
            return {
                // XML is formatted only when it is well-formed, so Format hides
                // while validation shows a fault; with validation off it shows,
                // and a broken document is left as it is (formatXml declines).
                format: !state.readOnly
                    && (state.language === "json" || (isXmlFamily(state.language) && !(state.validating && state.syntaxFault))),
                changes: !state.readOnly && state.differs,
                preview: state.language === "markdown",
                edit: false,
                backToEditing: false
            };
    }
}
