// Which parts of a JSON Schema apply at a place in the document.
//
// Completion and hover both ask the same question — "at this path, what does
// the schema say?" — and a schema rarely answers it in one object: a property
// is described under `properties`, reached through a `$ref`, split across an
// `allOf`, or offered as one of several shapes by `anyOf`/`oneOf`/`if`. This
// file flattens all of that into a list of plain object schemas, and the
// callers read keywords off the list.
//
// Deliberately generous: every branch of an `anyOf`, `oneOf` or `if` counts,
// because completion is a suggestion, not a verdict — validation (schema.ts)
// is what decides. Only a `$ref` inside the schema resolves, as in schema.ts.
//
// No Monaco import, and no DOM: `dev/smoke.js` drives this in Node.

export type SchemaObject = Record<string, unknown>;

/** How deep a chain of $refs and applicators may go before it is a cycle. */
const MAX_DEPTH = 32;

const APPLICATORS_UNION = ["anyOf", "oneOf"];

function isObject(value: unknown): value is SchemaObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A `$ref` inside the schema: `#`, `#/$defs/x`, `#/definitions/x`, or any
 * JSON pointer into the root. Anything else — another file, a URL, an `$id`
 * anchor — resolves to nothing.
 */
export function resolveRef(root: unknown, ref: string): unknown {
    if (ref === "#") {
        return root;
    }
    if (!ref.startsWith("#/")) {
        return undefined;
    }
    let node: unknown = root;
    for (const raw of ref.slice(2).split("/")) {
        let segment = raw;
        try {
            segment = decodeURIComponent(raw);
        } catch {
            // A literal % that was never encoded.
        }
        segment = segment.replace(/~1/g, "/").replace(/~0/g, "~");
        if (Array.isArray(node)) {
            node = node[Number(segment)];
        } else if (isObject(node)) {
            node = node[segment];
        } else {
            return undefined;
        }
    }
    return node;
}

/**
 * One schema, flattened: itself (when it is an object), and everything its
 * `$ref`, `allOf`, `anyOf`, `oneOf`, `if`/`then`/`else` lead to. `true` is
 * the empty schema; `false` and anything that is not a schema contribute
 * nothing. A `$ref` already on the path is a cycle and stops there.
 */
export function expand(root: unknown, schema: unknown, seen: Set<unknown> = new Set(), depth = 0): SchemaObject[] {
    if (schema === true) {
        return [{}];
    }
    if (!isObject(schema) || depth > MAX_DEPTH || seen.has(schema)) {
        return [];
    }
    const path = new Set(seen);
    path.add(schema);

    const out: SchemaObject[] = [schema];
    if (typeof schema.$ref === "string") {
        out.push(...expand(root, resolveRef(root, schema.$ref), path, depth + 1));
    }
    if (Array.isArray(schema.allOf)) {
        for (const part of schema.allOf) {
            out.push(...expand(root, part, path, depth + 1));
        }
    }
    for (const key of APPLICATORS_UNION) {
        const list = schema[key];
        if (Array.isArray(list)) {
            for (const part of list) {
                out.push(...expand(root, part, path, depth + 1));
            }
        }
    }
    for (const key of ["then", "else"]) {
        if (schema.if !== undefined && schema[key] !== undefined) {
            out.push(...expand(root, schema[key], path, depth + 1));
        }
    }
    return out;
}

/**
 * The schemas that describe the value at `path` — property names and array
 * indexes, as jsonc-parser reports them. An empty list means the schema says
 * nothing about that place.
 */
export function schemasAt(root: unknown, path: (string | number)[]): SchemaObject[] {
    let current = expand(root, root);
    for (const segment of path) {
        const next: unknown[] = [];
        for (const schema of current) {
            if (typeof segment === "number") {
                next.push(...itemSchemas(schema, segment));
            } else {
                next.push(...propertySchemas(schema, segment));
            }
        }
        current = next.flatMap((s) => expand(root, s));
        if (current.length === 0) {
            break;
        }
    }
    return current;
}

function propertySchemas(schema: SchemaObject, name: string): unknown[] {
    const properties = isObject(schema.properties) ? schema.properties : {};
    if (Object.prototype.hasOwnProperty.call(properties, name)) {
        return [properties[name]];
    }
    const out: unknown[] = [];
    if (isObject(schema.patternProperties)) {
        for (const [pattern, sub] of Object.entries(schema.patternProperties)) {
            if (matches(pattern, name)) {
                out.push(sub);
            }
        }
    }
    if (out.length === 0 && schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
        out.push(schema.additionalProperties);
    }
    return out;
}

function itemSchemas(schema: SchemaObject, index: number): unknown[] {
    // 2020-12: prefixItems is the tuple, items the rest.
    if (Array.isArray(schema.prefixItems)) {
        if (index < schema.prefixItems.length) {
            return [schema.prefixItems[index]];
        }
        return schema.items !== undefined ? [schema.items] : [];
    }
    // Drafts 4–2019-09: an items array is the tuple, additionalItems the rest.
    if (Array.isArray(schema.items)) {
        if (index < schema.items.length) {
            return [schema.items[index]];
        }
        return schema.additionalItems !== undefined ? [schema.additionalItems] : [];
    }
    return schema.items !== undefined ? [schema.items] : [];
}

function matches(pattern: string, name: string): boolean {
    try {
        return new RegExp(pattern, "u").test(name);
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------ keywords */

/**
 * Every property a list of schemas declares, with the schemas declaring it.
 * A property declared `false` is forbidden, not offered.
 */
export function declaredProperties(root: unknown, schemas: SchemaObject[]): Map<string, SchemaObject[]> {
    const found = new Map<string, SchemaObject[]>();
    for (const schema of schemas) {
        if (!isObject(schema.properties)) {
            continue;
        }
        for (const [name, sub] of Object.entries(schema.properties)) {
            if (sub === false) {
                continue;
            }
            const expanded = expand(root, sub);
            found.set(name, [...(found.get(name) ?? []), ...expanded]);
        }
    }
    return found;
}

/** Whether any of the schemas lists `name` under `required`. */
export function isRequired(schemas: SchemaObject[], name: string): boolean {
    return schemas.some((s) => Array.isArray(s.required) && s.required.includes(name));
}

/** The declared types, from `type` and — where there is none — `enum`/`const`. */
export function typesOf(schemas: SchemaObject[]): string[] {
    const types = new Set<string>();
    for (const schema of schemas) {
        const type = schema.type;
        if (typeof type === "string") {
            types.add(type);
        } else if (Array.isArray(type)) {
            type.filter((t): t is string => typeof t === "string").forEach((t) => types.add(t));
        }
    }
    return Array.from(types);
}

/** The first of a keyword's values across the schemas, in order. */
export function firstOf(schemas: SchemaObject[], keyword: string): unknown {
    for (const schema of schemas) {
        if (schema[keyword] !== undefined) {
            return schema[keyword];
        }
    }
    return undefined;
}

/** Whether the schemas mark the place deprecated (2019-09's keyword, or VS Code's message). */
export function isDeprecated(schemas: SchemaObject[]): boolean {
    return schemas.some((s) => s.deprecated === true || typeof s.deprecationMessage === "string");
}

/**
 * Text as Markdown that renders as itself. A schema's `description` is plain
 * text — an underscore in a property name is not emphasis — so it is escaped;
 * `markdownDescription` (VS Code's keyword) is Markdown already and is not.
 */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, "\\$&");
}

/** A place's documentation as Markdown: its title, then its description. */
export function documentation(schemas: SchemaObject[]): string | undefined {
    const parts: string[] = [];
    const title = firstOf(schemas, "title");
    if (typeof title === "string" && title.trim() !== "") {
        parts.push(`**${escapeMarkdown(title.trim())}**`);
    }
    const markdown = firstOf(schemas, "markdownDescription");
    const plain = firstOf(schemas, "description");
    if (typeof markdown === "string" && markdown.trim() !== "") {
        parts.push(markdown.trim());
    } else if (typeof plain === "string" && plain.trim() !== "") {
        parts.push(escapeMarkdown(plain.trim()));
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** Every value an `enum`, a `const` or a `oneOf` of consts allows, deduplicated. */
export function allowedValues(schemas: SchemaObject[]): unknown[] {
    const out: unknown[] = [];
    const seen = new Set<string>();
    const add = (v: unknown) => {
        const key = JSON.stringify(v);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(v);
        }
    };
    for (const schema of schemas) {
        if (Array.isArray(schema.enum)) {
            schema.enum.forEach(add);
        }
        if (schema.const !== undefined) {
            add(schema.const);
        }
    }
    return out;
}
