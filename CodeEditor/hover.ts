// What the schema says about the key or value under the pointer, as
// Markdown: its title and description, its type, whether it is required,
// the values it allows and its default.
//
// Offsets in, offsets out; monacoSetup.ts turns them into a Monaco range.
// No Monaco import, and no DOM: `dev/smoke.js` drives this in Node.

import { parseTree, findNodeAtOffset, getNodePath, Node } from "jsonc-parser";
import { allowedValues, documentation, escapeMarkdown, firstOf, isDeprecated, isRequired, schemasAt, typesOf } from "./schemaNav";

/** The words a hover shows, from the control's .resx. */
export interface HoverLabels {
    required: string;
    deprecated: string;
    allowedValues: string;
    /** A heading, capitalised — completion's `defaultValue` is a lower-case tag. */
    defaultHeading: string;
}

export interface HoverAnswer {
    offset: number;
    length: number;
    markdown: string;
}

/** How many allowed values a hover lists before it says how many more. */
const MAX_VALUES = 10;

export function hover(text: string, offset: number, root: unknown, labels: HoverLabels): HoverAnswer | null {
    if (root === undefined || root === false) {
        return null;
    }
    const tree = parseTree(text);
    const node = tree ? findNodeAtOffset(tree, offset, true) : undefined;
    if (!node) {
        return null;
    }

    const place = placeOf(node);
    if (!place) {
        return null;
    }
    const schemas = schemasAt(root, place.path);
    if (schemas.length === 0) {
        return null;
    }

    const lines: string[] = [];
    const doc = documentation(schemas);
    if (doc) {
        lines.push(doc);
    }

    const facts: string[] = [];
    const types = typesOf(schemas);
    if (types.length > 0) {
        facts.push(types.map((t) => `\`${t}\``).join(" | "));
    }
    const name = place.path[place.path.length - 1];
    if (typeof name === "string" && isRequired(schemasAt(root, place.path.slice(0, -1)), name)) {
        facts.push(escapeMarkdown(labels.required));
    }
    if (isDeprecated(schemas)) {
        const message = firstOf(schemas, "deprecationMessage");
        facts.push(escapeMarkdown(typeof message === "string" ? `${labels.deprecated}: ${message}` : labels.deprecated));
    }
    if (facts.length > 0) {
        lines.push(facts.join(" · "));
    }

    const allowed = allowedValues(schemas);
    if (allowed.length > 1) {
        const shown = allowed.slice(0, MAX_VALUES).map(code).join(", ");
        const more = allowed.length > MAX_VALUES ? `, … (+${allowed.length - MAX_VALUES})` : "";
        lines.push(`${escapeMarkdown(labels.allowedValues)}: ${shown}${more}`);
    }
    const def = firstOf(schemas, "default");
    if (def !== undefined) {
        lines.push(`${escapeMarkdown(labels.defaultHeading)}: ${code(def)}`);
    }

    if (lines.length === 0) {
        return null;
    }
    return { offset: place.node.offset, length: place.node.length, markdown: lines.join("\n\n") };
}

/**
 * The path a node stands for, and the node to underline. A property's key
 * stands for its value's place; a value stands for itself.
 */
function placeOf(node: Node): { path: (string | number)[]; node: Node } | null {
    const parent = node.parent;
    if (parent?.type === "property" && parent.children?.[0] === node) {
        const container = parent.parent;
        if (!container || typeof node.value !== "string") {
            return null;
        }
        return { path: [...getNodePath(container), node.value], node };
    }
    return { path: getNodePath(node), node };
}

/** A JSON value as inline code, backticks in it made safe. */
function code(value: unknown): string {
    const json = JSON.stringify(value) ?? String(value);
    return json.includes("`") ? `\`\` ${json} \`\`` : `\`${json}\``;
}
