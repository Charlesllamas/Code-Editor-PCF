// The language decision, with Monaco taken out of it.
//
// `monacoSetup.ts` owns the grammars and asks Monaco which ids it knows; this
// file owns only the mapping from what a maker typed to an id, and takes the
// known list as an argument so `dev/smoke.js` can drive it in Node, where the
// bundle itself cannot load (see the header of that file).

export const DEFAULT_LANGUAGE = "json";

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

/**
 * `raw` is whatever the maker put in the `language` property; `known` is the
 * list of ids the bundle registered. Anything that resolves to an id outside
 * that list is plain text rather than an error, so a misconfigured property
 * shows up as an uncoloured document instead of a broken control.
 */
export function resolveLanguage(raw: string | null | undefined, known: readonly string[]): string {
    const key = (raw ?? DEFAULT_LANGUAGE).trim().toLowerCase();
    const resolved = ALIASES[key] ?? (key === "" ? DEFAULT_LANGUAGE : key);
    return known.includes(resolved) ? resolved : "plaintext";
}

/** The label the status strip shows for an id — the alias people recognise. */
export function displayName(id: string): string {
    const names: Record<string, string> = {
        json: "JSON",
        xml: "XML",
        sql: "SQL",
        yaml: "YAML",
        powerquery: "Power Query M",
        msdax: "DAX",
        markdown: "Markdown",
        powershell: "PowerShell",
        csharp: "C#",
        python: "Python",
        css: "CSS",
        html: "HTML",
        javascript: "JavaScript",
        typescript: "TypeScript",
        plaintext: "Plain text"
    };
    return names[id] ?? id;
}
