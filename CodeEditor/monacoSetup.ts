// Monaco is bundled here rather than fetched from jsDelivr at runtime.
// Every import below adds to bundle.js, which PCF serves as a single file --
// see docs/limitations.md on the 5 MB Dataverse web resource cap before
// widening this list.
import * as monaco from "monaco-editor/editor/editor.api";

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

// JSON language service. Costs roughly 1.9 MB because it drags in editor
// features that tree-shaking otherwise drops; kept because JSON is this
// control's default and most common language.
import "monaco-editor/language/json/monaco.contribution";

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

// Monaco resolves language ids, not aliases. A maker who types "DAX" or "M"
// would otherwise silently get plain text.
const ALIASES: Record<string, string> = {
    dax: "msdax",
    m: "powerquery",
    "power query": "powerquery",
    powerquerym: "powerquery",
    yml: "yaml",
    tsql: "sql",
    "t-sql": "sql",
    cs: "csharp",
    "c#": "csharp",
    ps1: "powershell",
    md: "markdown",
    py: "python",
    js: "javascript",
    ts: "typescript",
    node: "javascript",
    ecmascript: "javascript"
};

export function resolveLanguage(raw: string | null | undefined): string {
    const key = (raw ?? "json").trim().toLowerCase();
    const resolved = ALIASES[key] ?? key;
    const known = monaco.languages.getLanguages().some((l) => l.id === resolved);
    return known ? resolved : "plaintext";
}

export default monaco;

