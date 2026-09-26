// Completion from the JSON Schema in force: property names where a key goes,
// allowed values where a value goes.
//
// The position comes from jsonc-parser's getLocation, which reads a document
// half-typed. Measured against 3.3.1 (dev/smoke.js pins each):
//
//   - A key being typed arrives as `previousNode` of type "property" — the
//     key string, quotes included — and `isAtPropertyKey` true.
//   - A key position with nothing typed yet has path [..., ""] and no node.
//   - An array slot after a comma reports `isAtPropertyKey` **true** with a
//     numeric last segment. It is a value position; the segment decides.
//   - A value being typed is `previousNode` of type "string", "number",
//     "boolean" or "null".
//
// Every answer is offsets into the text; monacoSetup.ts turns them into a
// Monaco range. No Monaco import, and no DOM: `dev/smoke.js` drives this.

import { getLocation, parseTree, findNodeAtLocation, Node } from "jsonc-parser";
import {
    SchemaObject, allowedValues, declaredProperties, documentation, firstOf,
    isDeprecated, isRequired, schemasAt, typesOf
} from "./schemaNav";

/** The words a suggestion shows, from the control's .resx. */
export interface CompletionLabels {
    required: string;
    deprecated: string;
    defaultValue: string;
}

export interface Suggestion {
    label: string;
    kind: "property" | "value";
    /** What replaces [start, end). A snippet when `snippet` is true. */
    insertText: string;
    snippet: boolean;
    /** What Monaco filters the typed text against; covers the same range. */
    filterText: string;
    detail: string;
    /** Markdown, already safe: descriptions are escaped in schemaNav.ts. */
    documentation?: string;
    sortText: string;
    deprecated: boolean;
    start: number;
    end: number;
}

const VALUE_NODE = new Set(["string", "number", "boolean", "null"]);

export function complete(text: string, offset: number, root: unknown, labels: CompletionLabels): Suggestion[] {
    if (root === undefined || root === false) {
        return [];
    }
    const location = getLocation(text, offset);
    const path = location.path;
    const last = path[path.length - 1];
    const atKey = location.isAtPropertyKey && typeof last === "string";
    return atKey
        ? keySuggestions(text, offset, root, path.slice(0, -1), location.previousNode, labels)
        : valueSuggestions(text, offset, root, path, location.previousNode, labels);
}

/* -------------------------------------------------------------- keys */

function keySuggestions(text: string, offset: number, root: unknown, parentPath: (string | number)[], node: Node | undefined, labels: CompletionLabels): Suggestion[] {
    const parents = schemasAt(root, parentPath);
    const declared = declaredProperties(root, parents);
    if (declared.size === 0) {
        return [];
    }

    // The key being typed is replaced whole, quotes included; with nothing
    // typed, whatever bare word sits before the caret.
    const typing = node && node.type === "property" ? node : undefined;
    const start = typing ? typing.offset : wordStart(text, offset);
    const end = typing ? typing.offset + typing.length : offset;

    // An existing key being renamed keeps its colon and value.
    const keyOnly = nextChar(text, end) === ":";
    // Another property follows: the new one needs a comma to stay valid.
    const comma = !keyOnly && nextChar(text, end) === "\"" ? "," : "";

    const present = siblingKeys(text, parentPath, start, end);
    const out: Suggestion[] = [];
    for (const [name, schemas] of declared) {
        if (present.has(name)) {
            continue;
        }
        const required = isRequired(parents, name);
        const deprecated = isDeprecated(schemas);
        const types = typesOf(schemas);
        const detail = [types.join(" | "), required ? labels.required : "", deprecated ? labels.deprecated : ""].filter(Boolean).join(" · ");
        const quoted = JSON.stringify(name);
        out.push({
            label: name,
            kind: "property",
            insertText: keyOnly ? escapeSnippet(quoted) : `${escapeSnippet(quoted)}: ${valuePlaceholder(schemas)}${comma}`,
            snippet: true,
            filterText: typing ? quoted : name,
            detail,
            documentation: documentation(schemas),
            sortText: `${deprecated ? 2 : required ? 0 : 1}_${name}`,
            deprecated,
            start,
            end
        });
    }
    return out;
}

/**
 * The keys already in the object at `parentPath`, less the one being typed —
 * a property offered twice is invalid JSON waiting to happen.
 *
 * Read from the document **with the half-typed key cut out**. Left in, a new
 * `""` above an existing `"id": 1` parses as a key missing its colon, the
 * tolerant parser folds the two together, and `id` vanishes from the tree —
 * so the list offered `id` again (harness, 2026-09-26). Cut out, the rest is
 * usually valid JSON again.
 */
function siblingKeys(text: string, parentPath: (string | number)[], start: number, end: number): Set<string> {
    const tree = parseTree(text.slice(0, start) + text.slice(end));
    const object = tree ? (parentPath.length === 0 ? tree : findNodeAtLocation(tree, parentPath)) : undefined;
    const keys = new Set<string>();
    for (const property of object?.type === "object" ? object.children ?? [] : []) {
        const key = property.children?.[0];
        if (key && typeof key.value === "string") {
            keys.add(key.value);
        }
    }
    return keys;
}

/**
 * The value a new key is inserted with, as a snippet: the one allowed value,
 * a choice of the allowed strings, the default, or an empty value of the
 * declared type with the caret inside it.
 */
export function valuePlaceholder(schemas: SchemaObject[]): string {
    const allowed = allowedValues(schemas);
    if (allowed.length === 1) {
        return escapeSnippet(JSON.stringify(allowed[0]));
    }
    if (allowed.length > 1 && allowed.every((v) => typeof v === "string")) {
        return `\${1|${allowed.map((v) => escapeChoice(JSON.stringify(v))).join(",")}|}`;
    }
    const def = firstOf(schemas, "default");
    if (def !== undefined) {
        return `\${1:${escapeSnippet(JSON.stringify(def))}}`;
    }
    const types = typesOf(schemas);
    if (types.length !== 1) {
        return "$1";
    }
    switch (types[0]) {
        case "string": return "\"$1\"";
        case "number":
        case "integer": return "${1:0}";
        case "boolean": return "${1:false}";
        case "object": return "{$1}";
        case "array": return "[$1]";
        case "null": return "null";
        default: return "$1";
    }
}

/* ------------------------------------------------------------ values */

function valueSuggestions(text: string, offset: number, root: unknown, path: (string | number)[], node: Node | undefined, labels: CompletionLabels): Suggestion[] {
    const schemas = schemasAt(root, path);
    if (schemas.length === 0) {
        return [];
    }

    const typing = node && VALUE_NODE.has(node.type) && offset >= node.offset && offset <= node.offset + node.length ? node : undefined;
    const start = typing ? typing.offset : wordStart(text, offset);
    const end = typing ? typing.offset + typing.length : offset;
    const typed = text.slice(start, end);

    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const add = (label: string, insertText: string, snippet: boolean, detail: string, rank: number) => {
        if (seen.has(label)) {
            return;
        }
        seen.add(label);
        out.push({
            label,
            kind: "value",
            insertText,
            snippet,
            // Filter against what is under the caret, so `"ac` finds "active".
            filterText: typed.startsWith("\"") ? label : label.replace(/^"/, ""),
            detail,
            documentation: documentation(schemas),
            sortText: `${rank}_${label}`,
            deprecated: false,
            start,
            end
        });
    };

    const def = firstOf(schemas, "default");
    for (const value of allowedValues(schemas)) {
        const json = JSON.stringify(value);
        add(json, escapeSnippet(json), true, def !== undefined && JSON.stringify(def) === json ? labels.defaultValue : "", 0);
    }
    if (def !== undefined) {
        const json = JSON.stringify(def);
        add(json, escapeSnippet(json), true, labels.defaultValue, 0);
    }
    const examples = firstOf(schemas, "examples");
    if (Array.isArray(examples)) {
        for (const example of examples) {
            const json = JSON.stringify(example);
            add(json, escapeSnippet(json), true, "", 1);
        }
    }
    // With no list of values, the type's own shapes.
    if (out.length === 0) {
        for (const type of typesOf(schemas)) {
            switch (type) {
                case "boolean":
                    add("true", "true", false, type, 2);
                    add("false", "false", false, type, 2);
                    break;
                case "null":
                    add("null", "null", false, type, 2);
                    break;
                case "object":
                    add("{}", "{$1}", true, type, 2);
                    break;
                case "array":
                    add("[]", "[$1]", true, type, 2);
                    break;
                case "string":
                    add("\"\"", "\"$1\"", true, type, 2);
                    break;
            }
        }
    }
    return out;
}

/* ----------------------------------------------------------- helpers */

/** Where the bare word before the caret starts: letters, digits, _ $ - . */
function wordStart(text: string, offset: number): number {
    let i = offset;
    while (i > 0 && /[\w$\-.]/.test(text[i - 1])) {
        i--;
    }
    return i;
}

/** The first character after `offset` that is not whitespace. */
function nextChar(text: string, offset: number): string {
    const rest = text.slice(offset).match(/\S/);
    return rest ? rest[0] : "";
}

/** A literal inside a snippet: `$`, `}` and `\` are syntax there. */
export function escapeSnippet(text: string): string {
    return text.replace(/[\\$}]/g, "\\$&");
}

/** A literal inside a snippet choice, where `,` and `|` are syntax too. */
function escapeChoice(text: string): string {
    return text.replace(/[\\$}|,]/g, "\\$&");
}
