// Which table a FetchXML name belongs to.
//
// A column is named in four places, and each resolves differently:
//
//   - `<attribute name>`, `<order attribute>`, `<condition attribute>` and
//     `valueof`: the nearest `entity` or `link-entity` around the element —
//     unless a condition or order says `entityname`, which names a
//     link-entity by its alias (or its name, when it has none).
//   - `<link-entity from>`: a column of the linked table itself.
//   - `<link-entity to>`: a column of the table it links *from*.
//
// `from` and `to` mean the opposite of QueryExpression's LinkFromAttributeName
// and LinkToAttributeName (Learn, *link-entity element*); getting that
// backwards is the classic join that returns nothing.
//
// No Monaco import, and no DOM: `dev/smoke.js` drives this in Node.

import { XmlDoc, attrOf } from "./xmlCursor";
import { AttrKind } from "./fetchGrammar";

const CONTAINERS = new Set(["entity", "link-entity"]);

/** The nearest entity or link-entity at or above an element, or -1. */
export function containerOf(doc: XmlDoc, index: number): number {
    for (let i = index; i !== -1; i = doc.elements[i].parent) {
        if (CONTAINERS.has(doc.elements[i].name)) {
            return i;
        }
    }
    return -1;
}

/** The table an entity or link-entity names, or null while it names none. */
export function tableOf(doc: XmlDoc, container: number): string | null {
    if (container === -1) {
        return null;
    }
    const name = attrOf(doc.elements[container], "name")?.value?.trim();
    return name ? name : null;
}

/** Every link-entity by the name `entityname` would use for it: its alias, else its table. */
export function linkAliases(doc: XmlDoc): Map<string, number> {
    const out = new Map<string, number>();
    doc.elements.forEach((e, index) => {
        if (e.name !== "link-entity") {
            return;
        }
        const alias = attrOf(e, "alias")?.value?.trim() || attrOf(e, "name")?.value?.trim();
        if (alias && !out.has(alias)) {
            out.set(alias, index);
        }
    });
    return out;
}

/** The aliases the document's `<attribute>` elements declare. */
export function attributeAliases(doc: XmlDoc): string[] {
    const out: string[] = [];
    for (const e of doc.elements) {
        const alias = e.name === "attribute" ? attrOf(e, "alias")?.value?.trim() : undefined;
        if (alias && !out.includes(alias)) {
            out.push(alias);
        }
    }
    return out;
}

/**
 * The table whose columns an attribute of `element` names, by the
 * attribute's kind — or null when the document does not say yet.
 */
export function columnTable(doc: XmlDoc, element: number, kind: AttrKind): string | null {
    const e = doc.elements[element];
    if (kind === "linkedColumn") {
        return tableOf(doc, element);
    }
    if (kind === "parentColumn") {
        return tableOf(doc, containerOf(doc, e.parent));
    }
    if (kind !== "column" && kind !== "value") {
        return null;
    }
    const named = attrOf(e, "entityname")?.value?.trim();
    if (named) {
        const link = linkAliases(doc).get(named);
        return link === undefined ? null : tableOf(doc, link);
    }
    return tableOf(doc, containerOf(doc, element));
}
