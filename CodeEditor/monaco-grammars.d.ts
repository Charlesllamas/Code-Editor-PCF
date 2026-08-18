// The basic-language grammar modules ship without type declarations -- only
// their register.js has a .d.ts. They export a Monarch grammar and a language
// configuration.
declare module "monaco-editor/languages/definitions/*" {
    export const conf: import("monaco-editor/editor/editor.api").languages.LanguageConfiguration;
    export const language: import("monaco-editor/editor/editor.api").languages.IMonarchLanguage;
}
