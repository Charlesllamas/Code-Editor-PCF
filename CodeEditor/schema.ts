// JSON Schema validation, on the main thread, with a position per fault.
//
// The validator is @cfworker/json-schema, chosen for one property above the
// rest: it interprets a schema rather than compiling one. Ajv — the usual
// answer — generates a function per schema with `new Function`, and a
// control has no say over the Content-Security-Policy of the page it is
// mounted in. An interpreter has nothing for a policy to refuse.
//
// What it reports is an output-unit list, and read raw it is not what an
// author wants to see. Measured against 4.1.1 (dev/smoke.js pins each):
//
//   - Every applicator reports a wrapper *and* its child: "Property "id" does
//     not match schema." at `#`, then the real fault at `#/id`. The wrapper
//     says nothing the child does not.
//   - anyOf and oneOf report every branch's failure beneath their own. A
//     reader wants "none of the shapes fit", not one line per shape.
//   - A `false` schema — `additionalProperties: false`, `items: false` —
//     reports as keyword "false", with a keywordLocation that is really an
//     instance path.
//   - **A declared property that fails its own schema is also reported as
//     additional.** `{"id": "x"}` against `properties.id: number` plus
//     `additionalProperties: false` yields a type fault on `id` *and* "id is
//     not allowed", which is false. So a not-allowed fault is dropped
//     wherever the same place has a fault of its own.
//   - An `if` wrapper's child sits under `/then/` or `/else/`, beside it.
//   - An unresolved `$ref` throws from `validate()`, not from the
//     constructor.
//
// No Monaco import, and no DOM: `dev/smoke.js` drives this in Node.

import { Validator, Schema, SchemaDraft, OutputUnit } from "@cfworker/json-schema";
import { parse, parseTree, Node, ParseError } from "jsonc-parser";
import { positionAt, Problem } from "./validate";
import { Arg, Worded, list, raw, said, worded } from "./messages";

/* ---------------------------------------------------------------- source */

export type SchemaSource =
    | { kind: "none" }
    | { kind: "inline"; text: string }
    | { kind: "webResource"; name: string }
    | { kind: "unsupported"; raw: string };

/**
 * What the maker put in `schema`. A document is inline; anything else is the
 * name of a web resource. A URL is refused rather than fetched: another
 * origin would make the control premium and put a network call behind a text
 * box, and the maker would find out from the import prompt.
 */
export function resolveSchemaSource(raw: string | null | undefined): SchemaSource {
    const text = (raw ?? "").trim();
    if (text === "") {
        return { kind: "none" };
    }
    if (text.startsWith("{")) {
        return { kind: "inline", text };
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//") || /[?#]/.test(text) || /(^|\/)\.\.(\/|$)/.test(text)) {
        return { kind: "unsupported", raw: text };
    }
    // A maker copying the address out of the browser brings the folder with it.
    const name = text.replace(/^\/+/, "").replace(/^WebResources\//i, "");
    return name === "" ? { kind: "unsupported", raw: text } : { kind: "webResource", name };
}

/* ---------------------------------------------------------------- schema */

export type SchemaFault = "notJson" | "invalidSchema";

export type CompiledSchema =
    // `schema` is the parsed document, for completion and hover to walk;
    // `validate` is the prepared validator.
    | { ok: true; validate: (text: string) => Problem[]; schema: unknown }
    | ({ ok: false; fault: SchemaFault } & Worded);

/**
 * Parse and prepare a schema once, so each keystroke pays only for the
 * validation. The schema itself is read leniently — comments are a normal
 * thing to find in a schema file, and the maker is not the integration.
 */
export function compileSchema(text: string): CompiledSchema {
    const errors: ParseError[] = [];
    const schema: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
        return { ok: false, fault: "notJson", message: "The schema is not valid JSON" };
    }
    if (typeof schema !== "boolean" && (schema === null || typeof schema !== "object" || Array.isArray(schema))) {
        return { ok: false, fault: "invalidSchema", ...worded("Schema_NotAnObject") };
    }

    let validator: Validator;
    try {
        validator = new Validator(schema as Schema | boolean, draftOf(schema), false);
        // A reference nothing resolves throws on first use, not here; ask once
        // now so the fault belongs to the schema rather than to a keystroke.
        validator.validate(null);
    } catch (error) {
        return { ok: false, fault: "invalidSchema", ...schemaErrorText(error) };
    }

    return { ok: true, validate: (doc) => validateWith(validator, doc), schema };
}

/** The draft a schema declares, defaulting to the newest. */
export function draftOf(schema: unknown): SchemaDraft {
    const declared = typeof schema === "object" && schema !== null ? String((schema as { $schema?: unknown }).$schema ?? "") : "";
    if (/draft-0?4/.test(declared)) {
        return "4";
    }
    if (/draft-0?[67]/.test(declared)) {
        return "7";
    }
    if (/2019-09/.test(declared)) {
        return "2019-09";
    }
    return "2020-12";
}

function schemaErrorText(error: unknown): Worded {
    const text = error instanceof Error ? error.message : String(error);
    const ref = /Unresolved \$ref "([^"]+)"/.exec(text);
    if (ref) {
        return worded("Schema_UnresolvedRef", ref[1]);
    }
    // The library's own sentence: no key to translate it by.
    return raw(text.split("\n")[0]);
}

/* -------------------------------------------------------------- validate */

/**
 * The schema's faults in `text`, positioned. A document that does not parse
 * gets none: its syntax faults come first, and a schema check against half a
 * document is noise.
 */
function validateWith(validator: Validator, text: string): Problem[] {
    if (text.trim() === "") {
        return [];
    }
    const errors: ParseError[] = [];
    const instance: unknown = parse(text, errors, { allowTrailingComma: false, disallowComments: true });
    if (errors.length > 0) {
        return [];
    }
    const tree = parseTree(text);
    if (!tree) {
        return [];
    }

    let units: OutputUnit[];
    try {
        units = validator.validate(instance).errors;
    } catch {
        return [];
    }

    const seen = new Set<string>();
    const problems: Problem[] = [];
    for (const fault of readable(units)) {
        const problem = place(text, tree, fault);
        const key = `${problem.line}:${problem.column}:${problem.message}`;
        if (!seen.has(key)) {
            seen.add(key);
            problems.push(problem);
        }
    }
    problems.sort((a, b) => a.line - b.line || a.column - b.column);
    return problems;
}

/** A fault worth showing, before it has a position. */
export interface Fault extends Worded {
    /** The instance path, decoded: property names and array indexes. */
    path: (string | number)[];
    /** Mark the property's name rather than its value. */
    atKey: boolean;
}

// Applicators whose own report only restates their children's.
const WRAPPERS = new Set([
    "properties", "patternProperties", "additionalProperties", "unevaluatedProperties",
    "items", "prefixItems", "additionalItems", "unevaluatedItems",
    "$ref", "$dynamicRef", "$recursiveRef", "allOf", "if", "then", "else",
    "dependentSchemas", "dependencies", "propertyNames"
]);

const ITEM_APPLICATORS = new Set(["items", "prefixItems", "additionalItems", "unevaluatedItems"]);

/**
 * The output units reduced to what a reader wants, per the list at the top of
 * this file. Exported for the suite, which pins each rule against the
 * library's real output.
 */
export function readable(units: OutputUnit[]): Fault[] {
    // A branch of anyOf/oneOf failed by design; the alternation says so once.
    const alternations = units.filter((u) => u.keyword === "anyOf" || u.keyword === "oneOf");
    const inBranch = (u: OutputUnit) => alternations.some((a) => a !== u && u.keywordLocation.startsWith(a.keywordLocation + "/"));
    const kept = units.filter((u) => !inBranch(u));

    const faults: Fault[] = [];
    for (const unit of kept) {
        if (WRAPPERS.has(unit.keyword)) {
            continue;
        }
        const path = decodePointer(unit.instanceLocation);

        if (unit.keyword === "false") {
            // The declared-property quirk: a place with a fault of its own was
            // not "additional", whatever the report says.
            const here = unit.instanceLocation;
            const hasOwn = kept.some((other) => other !== unit
                && other.keyword !== "false"
                && !WRAPPERS.has(other.keyword)
                && (other.instanceLocation === here || other.instanceLocation.startsWith(here + "/"))
                && !other.keywordLocation.includes("/propertyNames/"));
            if (hasOwn) {
                continue;
            }
            // A pointer segment is a string either way; whether it names an
            // item is said by the applicator that refused it, at the parent.
            const last = path[path.length - 1];
            const parent = here.slice(0, here.lastIndexOf("/"));
            const isItem = kept.some((other) => other.instanceLocation === parent && ITEM_APPLICATORS.has(other.keyword));
            faults.push(isItem
                ? { path, ...worded("Schema_ItemNotAllowed"), atKey: false }
                : { path, ...worded("Schema_PropertyNotAllowed", String(last)), atKey: true });
            continue;
        }

        if (unit.keywordLocation.includes("/propertyNames/")) {
            const inner = words(unit);
            const reason: Arg = inner.key ? said(inner.key, ...(inner.args ?? [])) : inner.message;
            faults.push({ path, ...worded("Schema_PropertyName", String(path[path.length - 1]), reason), atKey: true });
            continue;
        }

        faults.push({ path, ...words(unit), atKey: false });
    }
    return faults;
}

const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

/** A JSON type as a reader names it — "a string" — by resx key; anything else as it is. */
function describeType(name: string): Arg {
    return TYPES.has(name) ? said(`Type_${name}`) : name;
}

/** "a, b or c", as messages, so the "or" is the reader's language's. */
function either(items: Arg[]): Arg {
    return items.length === 1 ? items[0] : said("Schema_Or", list(...items.slice(0, -1)), items[items.length - 1]);
}

/** The library's sentence, reworded where it reads as a stack trace. */
export function message(unit: OutputUnit): string {
    return words(unit).message;
}

/** The same, worded: the English and the resx key it renders from (messages.ts). */
export function words(unit: OutputUnit): Worded {
    const text = unit.error;

    const type = /Instance type "(\w+)" is invalid\. Expected (.+)\.$/.exec(text);
    if (unit.keyword === "type" && type) {
        const expected = type[2].split(",").map((t) => describeType(t.trim().replace(/"/g, "")));
        return worded("Schema_TypeExpected", either(expected), describeType(type[1]));
    }

    const required = /required property "(.+)"\.$/.exec(text);
    if (unit.keyword === "required" && required) {
        return worded("Schema_Required", required[1]);
    }

    if (unit.keyword === "enum") {
        const list = /any of (.+)\.$/.exec(text);
        try {
            const values: unknown[] = list ? JSON.parse(list[1]) : [];
            const shown = values.slice(0, 6).map((v) => JSON.stringify(v)).join(", ");
            return worded("Schema_OneOf", `${shown}${values.length > 6 ? ", …" : ""}`);
        } catch {
            return raw(tidy(text));
        }
    }

    const constant = /does not match (.+)\.$/.exec(text);
    if (unit.keyword === "const" && constant) {
        return worded("Schema_Const", constant[1]);
    }

    if (unit.keyword === "anyOf" || (unit.keyword === "oneOf" && /\(0 matches\)/.test(text))) {
        return worded("Schema_NoShape");
    }
    if (unit.keyword === "oneOf") {
        return worded("Schema_ManyShapes");
    }
    if (unit.keyword === "not") {
        return worded("Schema_NotShape");
    }

    // "0 is less than 1." states the arithmetic; the author wants the rule.
    const bound = /(-?[\d.e+]+)\.$/i.exec(text)?.[1];
    const RANGE: Record<string, string> = {
        minimum: "Schema_Minimum",
        maximum: "Schema_Maximum",
        exclusiveMinimum: "Schema_ExclusiveMinimum",
        exclusiveMaximum: "Schema_ExclusiveMaximum"
    };
    if (RANGE[unit.keyword] && bound !== undefined) {
        return worded(RANGE[unit.keyword], bound);
    }

    const dependent = /has "(.+)" but does not have "(.+)"\.$/.exec(text);
    if (unit.keyword === "dependentRequired" && dependent) {
        return worded("Schema_DependentRequired", dependent[1], dependent[2]);
    }

    // The library's own sentence: no key to translate it by.
    return raw(tidy(text));
}

function tidy(text: string): string {
    return text.replace(/^Instance /, "").replace(/\.$/, "").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * `#/a~1b/c%20d/0` → `["a/b", "c d", "0"]`. Array indexes stay strings here;
 * `place` reads them against the tree, which knows which node is an array.
 */
export function decodePointer(pointer: string): (string | number)[] {
    const body = pointer.replace(/^#/, "");
    if (body === "") {
        return [];
    }
    return body.slice(1).split("/").map((segment) => {
        let decoded = segment;
        try {
            decoded = decodeURIComponent(segment);
        } catch {
            // A literal % in a property name that was never encoded.
        }
        return decoded.replace(/~1/g, "/").replace(/~0/g, "~");
    });
}

/* ---------------------------------------------------------------- place */

/**
 * Where a fault goes. A scalar marks itself; an object or an array marks the
 * name it sits under — a squiggle across forty lines reads as nothing — or
 * its opening bracket at the root; a key-level fault marks the name.
 */
export function place(text: string, root: Node, fault: Fault): Problem {
    let node: Node | undefined = root;
    for (const segment of fault.path) {
        const next = child(node, segment);
        if (!next) {
            break;
        }
        node = next;
    }

    const property = node.parent && node.parent.type === "property" ? node.parent : undefined;
    const key = property?.children?.[0];

    let offset = node.offset;
    let length = node.length;
    if ((fault.atKey || node.type === "object" || node.type === "array") && key) {
        offset = key.offset;
        length = key.length;
    } else if (node.type === "object" || node.type === "array") {
        length = 1;
    }

    // One line only: a Problem is a line and a column.
    const lineEnd = text.indexOf("\n", offset);
    if (lineEnd !== -1 && offset + length > lineEnd) {
        length = Math.max(1, lineEnd - offset - (text[lineEnd - 1] === "\r" ? 1 : 0));
    }

    const at = positionAt(text, offset);
    return { line: at.line, column: at.column, length: Math.max(1, length), message: fault.message, key: fault.key, args: fault.args };
}

function child(node: Node, segment: string | number): Node | undefined {
    if (node.type === "array") {
        const index = Number(segment);
        return Number.isInteger(index) ? node.children?.[index] : undefined;
    }
    if (node.type === "object") {
        const property = node.children?.find((p) => p.children?.[0]?.value === String(segment));
        return property?.children?.[1];
    }
    return undefined;
}
