// The basic-language grammar modules ship without type declarations -- only
// their register.js has a .d.ts. They export a Monarch grammar and a language
// configuration.
declare module "monaco-editor/languages/definitions/*" {
    export const conf: import("monaco-editor/editor/editor.api").languages.LanguageConfiguration;
    export const language: import("monaco-editor/editor/editor.api").languages.IMonarchLanguage;
}

// The JSON tokenizer is the main-thread half of Monaco's JSON mode; the
// package types only the mode's entry point, which we do not import.
declare module "monaco-editor/languages/features/json/tokenization" {
    export function createTokenizationSupport(
        supportComments: boolean
    ): import("monaco-editor/editor/editor.api").languages.TokensProvider;
}

// The renderer Monaco's hovers use (1.6.0's preview, preview.ts): the parts
// read, as Monaco 0.56.0 has them. A deep import, pinned by the lock — a
// Monaco upgrade checks these against esm/vs/base/browser/markdownRenderer.js.
declare module "monaco-editor/base/browser/markdownRenderer" {
    export interface MarkdownString {
        value: string;
        isTrusted?: boolean;
        supportHtml?: boolean;
    }
    export interface RenderOptions {
        actionHandler?: (href: string, markdown: MarkdownString) => void;
        markedExtensions?: unknown[];
        sanitizerConfig?: {
            allowedTags?: { override?: readonly string[] };
        };
    }
    export function renderMarkdown(
        markdown: MarkdownString,
        options?: RenderOptions,
        target?: HTMLElement
    ): { element: HTMLElement; dispose(): void };
    export const allowedMarkdownHtmlTags: readonly string[];
}

// Side-effect imports of editor contributions and stylesheets; nothing is
// read from them, so an empty module type is all they need.
declare module "monaco-editor/editor/*";
declare module "monaco-editor/features/*";
declare module "monaco-editor/base/*";
