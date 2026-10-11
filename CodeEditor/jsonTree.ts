/**
 * 1.7.0's JSON tree, as data: the document parsed into nodes that remember
 * where they sit in the text, the rows an expanded tree shows, and the path
 * of each node as a person would copy it.
 *
 * The tree is built only from a document validation would pass for syntax —
 * strictly, no comments and no trailing commas, as `validate.ts` reads it —
 * so the tree never shows a guess at half a document. jsonc-parser's
 * `parseTree` gives every node its offset and length, which is what lets a
 * node be selected in the editor (`selectionOf`) and the node under the caret
 * be found again (`nodeAtOffset`).
 *
 * Pure, so the suite loads it from source; `index.ts` draws the rows.
 */

import { Node, parseTree } from "jsonc-parser";
import { Problem, validateJson } from "./validate";

export type Segment = string | number;
export type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface TreeNode {
    /** From the root: property names and array indexes, as jsonc-parser reports them. */
    path: Segment[];
    /** The property name or index under the parent; null at the root. */
    key: Segment | null;
    type: JsonType;
    /** A scalar's value; undefined for an object or an array. */
    value?: string | number | boolean | null;
    /** An object's properties or an array's items. */
    count: number;
    /** The value's place in the text. */
    offset: number;
    length: number;
    /** Where the property's name starts, quote included; null for an array item and the root. */
    keyOffset: number | null;
    children: TreeNode[];
    parent: TreeNode | null;
}

export type Tree =
    | { kind: "empty" }
    | { kind: "faults"; first: Problem }
    | { kind: "ok"; root: TreeNode };

export interface Row {
    node: TreeNode;
    /** 1 at the root, as `aria-level` counts. */
    level: number;
    /** Siblings including itself, and its place among them from 1, as `aria-setsize` and `aria-posinset` count. */
    setSize: number;
    posInSet: number;
    /** Whether an object or array with something in it is open; undefined for anything that cannot open. */
    expanded: boolean | undefined;
}

/** Parse `text` into a tree, or say why there is none. */
export function buildTree(text: string): Tree {
    if (text.trim() === "") {
        return { kind: "empty" };
    }
    const faults = validateJson(text);
    if (faults.length > 0) {
        return { kind: "faults", first: faults[0] };
    }
    const root = parseTree(text, [], { disallowComments: true, allowTrailingComma: false });
    if (!root) {
        return { kind: "empty" };
    }
    return { kind: "ok", root: convert(root, [], null, null, null) };
}

function convert(node: Node, path: Segment[], key: Segment | null, keyOffset: number | null, parent: TreeNode | null): TreeNode {
    const type = node.type === "property" ? "null" : node.type;
    const out: TreeNode = {
        path,
        key,
        type,
        count: 0,
        offset: node.offset,
        length: node.length,
        keyOffset,
        children: [],
        parent
    };
    if (type === "object") {
        for (const property of node.children ?? []) {
            const [name, value] = property.children ?? [];
            if (name && value) {
                const k = String(name.value);
                out.children.push(convert(value, [...path, k], k, name.offset, out));
            }
        }
        out.count = out.children.length;
    } else if (type === "array") {
        (node.children ?? []).forEach((item, index) => {
            out.children.push(convert(item, [...path, index], index, null, out));
        });
        out.count = out.children.length;
    } else {
        out.value = node.value as string | number | boolean | null;
    }
    return out;
}

/** A path as a set key: unique, and the same for the same place in any rebuild. */
export function pathKey(path: Segment[]): string {
    return JSON.stringify(path);
}

/** Whether a node can open: an object or array with something in it. */
export function opens(node: TreeNode): boolean {
    return (node.type === "object" || node.type === "array") && node.count > 0;
}

/**
 * Every row an expanded tree shows, in order: the root, then each open
 * node's children under it. A node is open when its path key is in
 * `expanded`.
 */
export function visibleRows(root: TreeNode, expanded: ReadonlySet<string>): Row[] {
    const rows: Row[] = [];
    const walk = (node: TreeNode, level: number, setSize: number, posInSet: number): void => {
        const open = opens(node) ? expanded.has(pathKey(node.path)) : undefined;
        rows.push({ node, level, setSize, posInSet, expanded: open });
        if (open) {
            node.children.forEach((child, i) => walk(child, level + 1, node.children.length, i + 1));
        }
    };
    walk(root, 1, 1, 1);
    return rows;
}

/** The node at `path`, or null when the document no longer has one there. */
export function findNode(root: TreeNode, path: Segment[]): TreeNode | null {
    let node: TreeNode | undefined = root;
    for (const segment of path) {
        node = node?.children.find((c) => c.key === segment);
        if (!node) {
            return null;
        }
    }
    return node ?? null;
}

/** The deepest node that still exists along `path`: the place itself, or the nearest ancestor left. */
export function nearestNode(root: TreeNode, path: Segment[]): TreeNode {
    let node = root;
    for (const segment of path) {
        const next = node.children.find((c) => c.key === segment);
        if (!next) {
            break;
        }
        node = next;
    }
    return node;
}

/**
 * The deepest node whose text holds `offset`: from a property's name to the
 * end of its value, so a caret on a key finds that property. The root when
 * nothing deeper does.
 */
export function nodeAtOffset(root: TreeNode, offset: number): TreeNode {
    let node = root;
    for (;;) {
        const inside = node.children.find((c) => {
            const { start, end } = selectionOf(c);
            return offset >= start && offset <= end;
        });
        if (!inside) {
            return node;
        }
        node = inside;
    }
}

/** The text a node stands for: its name, if it has one, through the end of its value. */
export function selectionOf(node: TreeNode): { start: number; end: number } {
    return { start: node.keyOffset ?? node.offset, end: node.offset + node.length };
}

/** `expanded` with every ancestor of `node` opened, so the node is a row. */
export function expandTo(expanded: ReadonlySet<string>, node: TreeNode): Set<string> {
    const out = new Set(expanded);
    for (let p = node.parent; p; p = p.parent) {
        out.add(pathKey(p.path));
    }
    return out;
}

/**
 * A path as a person copies it, in JSONPath's shorthand (RFC 9535): `$`,
 * `.name` for a name that is a plain identifier, `['odd key']` for any other,
 * `[2]` for an index.
 */
export function formatPath(path: Segment[]): string {
    return "$" + path.map((segment) => {
        if (typeof segment === "number") {
            return `[${segment}]`;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
            return `.${segment}`;
        }
        return `['${segment.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']`;
    }).join("");
}

/** What a row says after the key: a scalar as JSON writes it, cut at `max` characters; a count for the rest. */
export function previewOf(node: TreeNode, max = 120): string {
    switch (node.type) {
        case "object":
            return `{${node.count}}`;
        case "array":
            return `[${node.count}]`;
        case "string": {
            const text = JSON.stringify(node.value);
            return text.length > max ? `${text.slice(0, max - 2)}…"` : text;
        }
        default:
            return String(node.value);
    }
}
