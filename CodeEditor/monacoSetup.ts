// Monaco is bundled here rather than fetched from jsDelivr at runtime.
// Every import below adds to bundle.js, which PCF serves as a single file --
// see docs/limitations.md on the 5 MB Dataverse web resource cap before
// widening this list.
import * as monaco from "monaco-editor/editor/editor.api";
import "./monacoFeatures";
import { format as formatJson, applyEdits } from "jsonc-parser";
import { resolveLanguage as resolve } from "./languages";
import { formatXml } from "./formatXml";
import { complete } from "./complete";
import { hover } from "./hover";
import { schemaRegistry } from "./schemaRegistry";
import { fetchComplete, FetchKind } from "./fetchComplete";
import { fetchHover } from "./fetchHover";
import { fetchRegistry } from "./fetchRegistry";

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
    // 1.5.0: the same grammar under a language of its own, so the FetchXML
    // providers below can be registered for it alone — an `xml` editor is
    // untouched by construction, not by a check.
    { id: "fetchxml", extensions: [], aliases: ["FetchXML"], conf: xmlConf, language: xmlLang },
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

// Format Document for XML and FetchXML, through formatXml.ts: re-indentation
// of element-only content, anything holding text written back as it was. A
// document it cannot read comes back null and the command changes nothing.
for (const id of ["xml", "fetchxml"]) {
    monaco.languages.registerDocumentFormattingEditProvider(id, {
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
}

// Completion and hover for JSON, from the schema in force. Registered once for
// the page, like everything above: a provider belongs to a language, not to
// an editor, so each looks up the schema its model's control filed in
// schemaRegistry.ts and answers nothing without one — a JSON editor with no
// schema behaves exactly as 1.3 did. The contributions that draw the list and
// place a snippet's caret are imported in monacoFeatures.ts, ahead of the
// first API call above, or they are inert.
//
// `"` opens the list on a key, `:` on a value; typing a word opens it too
// (quickSuggestions, set per editor in index.ts). Enter takes a suggestion —
// on a model-driven form Tab never reaches the editor (SPEC.md P3).
function rangeOf(model: monaco.editor.ITextModel, start: number, end: number): monaco.Range {
    const a = model.getPositionAt(start);
    const b = model.getPositionAt(end);
    return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
}

function markdown(value: string): monaco.IMarkdownString {
    // Untrusted and without HTML: the text is the schema author's, and a
    // hover renders it (SPEC.md P2 — tags are stripped, not rendered).
    return { value, isTrusted: false, supportHtml: false };
}

monaco.languages.registerCompletionItemProvider("json", {
    triggerCharacters: ["\"", ":"],
    provideCompletionItems(model, position) {
        const entry = schemaRegistry.get(model.uri.toString());
        if (!entry) {
            return { suggestions: [] };
        }
        const found = complete(model.getValue(), model.getOffsetAt(position), entry.schema, entry.labels);
        return {
            suggestions: found.map((s) => ({
                label: s.label,
                kind: s.kind === "property"
                    ? monaco.languages.CompletionItemKind.Property
                    : monaco.languages.CompletionItemKind.Value,
                insertText: s.insertText,
                insertTextRules: s.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                filterText: s.filterText,
                detail: s.detail,
                documentation: s.documentation ? markdown(s.documentation) : undefined,
                sortText: s.sortText,
                tags: s.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
                range: rangeOf(model, s.start, s.end)
            }))
        };
    }
});

monaco.languages.registerHoverProvider("json", {
    provideHover(model, position) {
        const entry = schemaRegistry.get(model.uri.toString());
        if (!entry) {
            return null;
        }
        const answer = hover(model.getValue(), model.getOffsetAt(position), entry.schema, entry.labels);
        return answer
            ? { range: rangeOf(model, answer.offset, answer.offset + answer.length), contents: [markdown(answer.markdown)] }
            : null;
    }
});

// Completion and hover for FetchXML (1.5.0): the grammar, and the
// environment's tables, columns, joins and choice values where the control
// could read its table definitions (fetchRegistry.ts holds whether it can).
//
// The decisions are synchronous and say what metadata they lacked; these
// providers fetch that and ask again, waiting up to METADATA_WAIT_MS — the
// slowest cold read on the form was 311 ms (SPEC.md, the 1.4.9 probe) — and
// answering with what they have after that, marked incomplete so Monaco asks
// again on the next keystroke.
const METADATA_WAIT_MS = 1000;

const FETCH_KINDS: Record<FetchKind, monaco.languages.CompletionItemKind> = {
    element: monaco.languages.CompletionItemKind.Module,
    attribute: monaco.languages.CompletionItemKind.Property,
    value: monaco.languages.CompletionItemKind.Value,
    table: monaco.languages.CompletionItemKind.Class,
    column: monaco.languages.CompletionItemKind.Field,
    operator: monaco.languages.CompletionItemKind.Operator,
    relationship: monaco.languages.CompletionItemKind.Reference,
    alias: monaco.languages.CompletionItemKind.Variable
};

function waitFor(promise: Promise<void>): Promise<boolean> {
    return Promise.race([
        promise.then(() => true),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), METADATA_WAIT_MS))
    ]);
}

monaco.languages.registerCompletionItemProvider("fetchxml", {
    triggerCharacters: ["<", "/", "\"", "'", " "],
    async provideCompletionItems(model, position) {
        const entry = fetchRegistry.get(model.uri.toString());
        if (!entry) {
            return { suggestions: [] };
        }
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        let found = fetchComplete(text, offset, entry.metadata, entry.labels);
        let incomplete = false;
        if (found.needs.length > 0 && entry.metadata) {
            const settled = await waitFor(entry.metadata.ensure(found.needs));
            found = fetchComplete(text, offset, entry.metadata, entry.labels);
            incomplete = !settled || found.needs.length > 0;
        }
        return {
            incomplete,
            suggestions: found.suggestions.map((s) => ({
                label: s.description ? { label: s.label, description: s.description } : s.label,
                kind: FETCH_KINDS[s.kind],
                insertText: s.insertText,
                insertTextRules: s.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                filterText: s.filterText,
                detail: s.detail,
                documentation: s.documentation ? markdown(s.documentation) : undefined,
                sortText: s.sortText,
                tags: s.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
                // An attribute whose value has a list: open it inside the quotes.
                command: s.retrigger ? { id: "editor.action.triggerSuggest", title: "" } : undefined,
                range: rangeOf(model, s.start, s.end)
            }))
        };
    }
});

monaco.languages.registerHoverProvider("fetchxml", {
    async provideHover(model, position) {
        const entry = fetchRegistry.get(model.uri.toString());
        if (!entry) {
            return null;
        }
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        let found = fetchHover(text, offset, entry.metadata, entry.labels);
        if (found.needs.length > 0 && entry.metadata) {
            await waitFor(entry.metadata.ensure(found.needs));
            found = fetchHover(text, offset, entry.metadata, entry.labels);
        }
        const answer = found.answer;
        return answer
            ? { range: rangeOf(model, answer.offset, answer.offset + answer.length), contents: [markdown(answer.markdown)] }
            : null;
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
