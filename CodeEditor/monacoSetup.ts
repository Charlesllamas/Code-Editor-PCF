// Monaco is bundled here rather than fetched from jsDelivr at runtime.
// Every import below adds to bundle.js, which PCF serves as a single file --
// see docs/limitations.md on the 5 MB Dataverse web resource cap before
// widening this list.
import * as monaco from "monaco-editor/editor/editor.api";
import "./monacoFeatures";
import { format as formatJson, applyEdits } from "jsonc-parser";
import { resolveLanguage as resolve } from "./languages";
import { formatXml } from "./formatXml";

// Registering a language gives monaco its id, extensions and aliases, and wires
// a lazy tokens-provider factory. Under PCF's single-chunk build that factory
// never paints -- the grammars load but tokenization stays default-coloured --
// so each grammar is also applied eagerly below.

import { conf as sqlConf, language as sqlLang } from "monaco-editor/languages/definitions/sql/sql";
import { conf as yamlConf, language as yamlLang } from "monaco-editor/languages/definitions/yaml/yaml";
import { conf as pqConf, language as pqLang } from "monaco-editor/languages/definitions/powerquery/powerquery";
import { conf as daxConf, language as daxLang } from "monaco-editor/languages/definitions/msdax/msdax";
import { conf as xmlConf, language as xmlLang } from "monaco-editor/languages/definitions/xml/xml";
import { conf as mdConf, language as mdLang } from "monaco-editor/languages/definitions/markdown/markdown";
import { conf as ps1Conf, language as ps1Lang } from "monaco-editor/languages/definitions/powershell/powershell";
import { conf as csConf, language as csLang } from "monaco-editor/languages/definitions/csharp/csharp";
import { conf as pyConf, language as pyLang } from "monaco-editor/languages/definitions/python/python";
import { conf as cssConf, language as cssLang } from "monaco-editor/languages/definitions/css/css";
import { conf as htmlConf, language as htmlLang } from "monaco-editor/languages/definitions/html/html";
// javascript.js is a thin wrapper over the TypeScript grammar, so registering
// TypeScript as well costs a few hundred bytes rather than a second grammar.
import { conf as jsConf, language as jsLang } from "monaco-editor/languages/definitions/javascript/javascript";
import { conf as tsConf, language as tsLang } from "monaco-editor/languages/definitions/typescript/typescript";

// JSON, by its tokenizer alone.
//
// 1.1.0 imported `monaco-editor/language/json/monaco.contribution`, which
// registers this same tokenizer *and* nine language-service providers that
// each proxy to a web worker -- and under PCF's single-file build no worker
// can start, so every one of them was dead weight: roughly 1.9 MB of LSP
// adapters, and a rejected promise in the console the first time a JSON model
// was opened. The tokenizer is the only part that ever ran, and it is a
// main-thread module with one small dependency. The configuration below is
// what jsonMode.ts would have registered beside it.
import { createTokenizationSupport as jsonTokens } from "monaco-editor/languages/features/json/tokenization";

// No web workers, said up front.
//
// The editor still asks for one -- `editorWorkerService` backs word-based
// completion, link detection and diff -- and left to itself Monaco 0.56
// resolves that through `new URL('…?esm', import.meta.url)`, which under a
// single-file build points at a stub webpack emitted beside bundle.js and
// the platform never serves. The failure is asynchronous: four errors in the
// console, a fetch that 404s, and then the main-thread fallback anyway.
//
// A `getWorker` that throws is the synchronous route to the same fallback:
// `StandaloneWebWorkerService._createWorker` calls it before touching the
// URL, `EditorWorkerClient._getOrCreateWorker` catches, warns **once** and
// builds the in-process worker. Same editor, one honest warning.
(globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker(): Worker {
        throw new Error("Code Editor runs Monaco without web workers: a PCF control is served as one file.");
    }
};

interface GrammarEntry {
    id: string;
    extensions: string[];
    aliases: string[];
    conf: monaco.languages.LanguageConfiguration;
    language: monaco.languages.IMonarchLanguage;
}

const GRAMMARS: GrammarEntry[] = [
    { id: "sql", extensions: [".sql"], aliases: ["SQL"], conf: sqlConf, language: sqlLang },
    { id: "yaml", extensions: [".yaml",".yml"], aliases: ["YAML","yml"], conf: yamlConf, language: yamlLang },
    { id: "powerquery", extensions: [".pq",".m"], aliases: ["Power Query","M"], conf: pqConf, language: pqLang },
    { id: "msdax", extensions: [".dax",".msdax"], aliases: ["DAX","MSDAX"], conf: daxConf, language: daxLang },
    { id: "xml", extensions: [".xml"], aliases: ["XML"], conf: xmlConf, language: xmlLang },
    { id: "markdown", extensions: [".md"], aliases: ["Markdown"], conf: mdConf, language: mdLang },
    { id: "powershell", extensions: [".ps1"], aliases: ["PowerShell"], conf: ps1Conf, language: ps1Lang },
    { id: "csharp", extensions: [".cs"], aliases: ["C#"], conf: csConf, language: csLang },
    { id: "python", extensions: [".py"], aliases: ["Python"], conf: pyConf, language: pyLang },
    { id: "css", extensions: [".css"], aliases: ["CSS"], conf: cssConf, language: cssLang },
    { id: "html", extensions: [".html",".htm"], aliases: ["HTML"], conf: htmlConf, language: htmlLang },
    { id: "javascript", extensions: [".js"], aliases: ["JavaScript","js"], conf: jsConf, language: jsLang },
    { id: "typescript", extensions: [".ts"], aliases: ["TypeScript","ts"], conf: tsConf, language: tsLang }
];

for (const grammar of GRAMMARS) {
    monaco.languages.register({
        id: grammar.id,
        extensions: grammar.extensions,
        aliases: grammar.aliases
    });
    monaco.languages.setMonarchTokensProvider(grammar.id, grammar.language);
    monaco.languages.setLanguageConfiguration(grammar.id, grammar.conf);
}

monaco.languages.register({ id: "json", extensions: [".json", ".jsonc"], aliases: ["JSON", "json"], mimetypes: ["application/json"] });
// `true` keeps comments tokenized as comments, so a maker who turned
// validation off for a commented file still sees them greyed rather than red.
monaco.languages.setTokensProvider("json", jsonTokens(true));
monaco.languages.setLanguageConfiguration("json", {
    wordPattern: /(-?\d*\.\d\w*)|([^[{\]}:"\s,]+)/g,
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [["{", "}"], ["[", "]"]],
    autoClosingPairs: [
        { open: "{", close: "}", notIn: ["string"] },
        { open: "[", close: "]", notIn: ["string"] },
        { open: "\"", close: "\"", notIn: ["string"] }
    ],
    folding: {
        markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ }
    }
});

// Format Document for JSON, on the main thread. Registering a provider is
// what lights up Monaco's own command -- Shift+Alt+F and the context-menu
// entry -- so the strip's Format button runs the same action rather than a
// second implementation. jsonc-parser's formatter keeps comments and gives
// up on nothing, so a broken document formats as far as it parses.
monaco.languages.registerDocumentFormattingEditProvider("json", {
    provideDocumentFormattingEdits(model, options) {
        const text = model.getValue();
        const edits = formatJson(text, undefined, {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
            eol: model.getEOL()
        });
        // One edit for the whole document is cheaper for Monaco to apply than
        // jsonc-parser's per-gap list, and undo treats it as one step.
        const formatted = applyEdits(text, edits);
        if (formatted === text) {
            return [];
        }
        return [{ range: model.getFullModelRange(), text: formatted }];
    }
});

// Format Document for XML, through formatXml.ts: re-indentation of element-
// only content, anything holding text written back as it was. A document it
// cannot read comes back null and the command changes nothing.
monaco.languages.registerDocumentFormattingEditProvider("xml", {
    provideDocumentFormattingEdits(model, options) {
        const text = model.getValue();
        const formatted = formatXml(text, {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
            eol: model.getEOL()
        });
        if (formatted === null || formatted === text) {
            return [];
        }
        return [{ range: model.getFullModelRange(), text: formatted }];
    }
});

/** Every id the bundle registered, for the pure resolver. */
export function knownLanguages(): string[] {
    return monaco.languages.getLanguages().map((l) => l.id);
}

export function resolveLanguage(raw: string | null | undefined): string {
    return resolve(raw, knownLanguages());
}

export default monaco;
