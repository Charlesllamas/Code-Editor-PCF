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

// Side-effect imports of editor contributions and stylesheets; nothing is
// read from them, so an empty module type is all they need.
declare module "monaco-editor/editor/*";
declare module "monaco-editor/features/*";
declare module "monaco-editor/base/*";
