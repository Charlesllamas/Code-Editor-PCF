/**
 * The control's four modes, and which buttons the strip under the editor
 * offers in each.
 *
 * - **edit**: the editor, as every version before 1.6.0 had it.
 * - **changes**: the document against the baseline (baseline.ts) in Monaco's
 *   diff editor, whose modified side is the editor's own model — so typing
 *   there is typing in the column.
 * - **preview**: Markdown rendered (previewPolicy.ts), read-only.
 * - **tree**: 1.7.0 — JSON as a read-only tree (jsonTree.ts), whose rows
 *   lead back into the editor at the node's text.
 *
 * Pure, so the suite loads it from source; `index.ts` turns the answers into
 * DOM.
 */

import { isXmlFamily } from "./languages";

export type Mode = "edit" | "changes" | "preview" | "tree";

/** The `markdownView` property's values; anything else is the default. */
export type MarkdownView = "edit" | "preview";

/** The `jsonView` property's values (1.7.0); anything else is the default. */
export type JsonView = "edit" | "tree";

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
    /** The tree has a node in focus — a document with no fault and something in it. */
    treeFocus?: boolean;
    /** This browser has a way to write the clipboard (SPEC.md, the 1.6.9 probe, P3). */
    canCopy?: boolean;
}

export interface StripButtons {
    format: boolean;
    changes: boolean;
    preview: boolean;
    edit: boolean;
    backToEditing: boolean;
    tree: boolean;
    copyPath: boolean;
}

/** What a maker typed in `markdownView`, or the default. A canvas formula can supply anything. */
export function readMarkdownView(raw: unknown): MarkdownView {
    return String(raw ?? "").trim().toLowerCase() === "preview" ? "preview" : "edit";
}

/** What a maker typed in `jsonView`, or the default. */
export function readJsonView(raw: unknown): JsonView {
    return String(raw ?? "").trim().toLowerCase() === "tree" ? "tree" : "edit";
}

/**
 * The mode a control mounts in, or returns to when `markdownView` or
 * `jsonView` changes: each speaks for its own language and is ignored by
 * every other.
 */
export function initialMode(view: MarkdownView, language: string, jsonView: JsonView = "edit"): Mode {
    if (view === "preview" && language === "markdown") {
        return "preview";
    }
    return jsonView === "tree" && language === "json" ? "tree" : "edit";
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

    if (mode === "tree" && language !== "json") {
        return "edit";
    }

    if (mode === "changes" && readOnly) {
        return "edit";
    }

    return mode;
}

export function stripButtons(state: StripState): StripButtons {
    const none: StripButtons = { format: false, changes: false, preview: false, edit: false, backToEditing: false, tree: false, copyPath: false };

    switch (state.mode) {
        case "changes":
            return { ...none, backToEditing: true };
        case "preview":
            return { ...none, edit: true };
        case "tree":
            // A read-only field can browse its tree too; Copy path needs a
            // node to copy and a browser that writes the clipboard.
            return { ...none, edit: true, copyPath: !!state.treeFocus && state.canCopy !== false };
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
                backToEditing: false,
                tree: state.language === "json",
                copyPath: false
            };
    }
}
