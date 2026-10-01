// Completion for FetchXML: the grammar's elements and attributes, its
// operators, and — where the environment's table definitions have been read
// — its tables, the columns of the table in scope, the joins a link-entity
// can make, and a choice's options.
//
// Synchronous, and honest about what it lacked: the answer carries `needs`,
// the metadata it would have used and did not have. The provider fetches
// those (metadata.ts) and asks again, so this module decides and never waits
// — `dev/smoke.js` drives it with a snapshot it builds by hand.
//
// Offsets in, offsets out; monacoSetup.ts turns them into a Monaco range.
// No Monaco import, and no DOM.

import { scanXml, placeAt, attrOf, XmlDoc } from "./xmlCursor";
import { ELEMENTS, OPERATORS, AttrSpec, attributeOf, elementOf, isChoice, operandTypes } from "./fetchGrammar";
import { attributeAliases, columnTable, containerOf, linkAliases, tableOf } from "./fetchScope";
import { ColumnInfo, Need, Snapshot } from "./metadata";

/** The words a suggestion shows, from the control's .resx. */
export interface FetchLabels {
    required: string;
    deprecated: string;
    /** A relationship item's detail: "{0}" is its schema name. */
    relationship: string;
    /** A many-to-many item's detail: "{0}" is the table at the far side. */
    manyToMany: string;
}

export type FetchKind = "element" | "attribute" | "value" | "table" | "column" | "operator" | "relationship" | "alias";

export interface FetchSuggestion {
    label: string;
    kind: FetchKind;
    /** What replaces [start, end). A snippet when `snippet` is true. */
    insertText: string;
    snippet: boolean;
    filterText: string;
    /** Shown beside the label on every row — a column's display name, a join's lookup. */
    description?: string;
    detail: string;
    /** Markdown, already safe. */
    documentation?: string;
    sortText: string;
    deprecated: boolean;
    /** Open the list again after inserting — an attribute whose value has one. */
    retrigger: boolean;
    start: number;
    end: number;
}

export interface FetchAnswer {
    suggestions: FetchSuggestion[];
    needs: Need[];
}

const LISTED: Set<string> = new Set(["table", "column", "linkedColumn", "parentColumn", "operator", "enum", "boolean", "linkAlias", "attributeAlias", "value"]);

export function fetchComplete(text: string, offset: number, snapshot: Snapshot | null, labels: FetchLabels): FetchAnswer {
    const doc = scanXml(text);
    const place = placeAt(doc, text, offset);
    const out: FetchAnswer = { suggestions: [], needs: [] };

    switch (place.kind) {
        case "elementName":
            elements(doc, place.element, place.parent, place.start, place.end, place.tagHasMore, out);
            break;
        case "closeTag":
            if (place.open !== -1) {
                const name = doc.elements[place.open].name;
                const done = text[place.end] === ">";
                out.suggestions.push(item(`/${name}`, "element", done ? name : `${name}>`, false, name, "", "0", place.start, place.end));
            }
            break;
        case "attributeName":
            attributes(doc, place.element, place.attr, place.start, place.end, labels, out);
            break;
        case "attributeValue": {
            const e = doc.elements[place.element];
            const spec = attributeOf(e.name, e.attrs[place.attr].name);
            if (spec) {
                values(doc, place.element, spec, place.start, place.end, place.closed, snapshot, labels, out);
            }
            break;
        }
        case "text": {
            // Inside `<value>` under a condition: that condition's choice values.
            const e = doc.elements[place.element];
            if (e.name === "value" && e.parent !== -1 && doc.elements[e.parent].name === "condition" && e.children.length === 0) {
                choiceValues(doc, e.parent, e.contentStart, e.contentEnd, snapshot, out);
            }
            break;
        }
    }
    return out;
}

/* ---------------------------------------------------------------- items */

function item(label: string, kind: FetchKind, insertText: string, snippet: boolean, filterText: string, detail: string, sortText: string, start: number, end: number, extra: Partial<FetchSuggestion> = {}): FetchSuggestion {
    return { label, kind, insertText, snippet, filterText, detail, sortText, deprecated: false, retrigger: false, start, end, ...extra };
}

function pad(n: number): string {
    return String(n).padStart(3, "0");
}

function need(out: FetchAnswer, n: Need): void {
    if (!out.needs.some((x) => JSON.stringify(x) === JSON.stringify(n))) {
        out.needs.push(n);
    }
}

/* ------------------------------------------------------------- elements */

function elements(doc: XmlDoc, self: number, parent: number, start: number, end: number, tagHasMore: boolean, out: FetchAnswer): void {
    const allowed = parent === -1 ? ["fetch"] : elementOf(doc.elements[parent].name)?.children ?? [];
    const fetchHasEntity = parent !== -1 && doc.elements[parent].name === "fetch"
        && doc.elements[parent].children.some((c) => c !== self && doc.elements[c].name === "entity");
    allowed.forEach((name, i) => {
        if (name === "entity" && fetchHasEntity) {
            return;
        }
        const spec = ELEMENTS[name];
        out.suggestions.push(item(name, "element", tagHasMore ? name : spec.snippet, !tagHasMore, name, "", `0_${pad(i)}`, start, end, {
            documentation: spec.description
        }));
    });
}

/* ----------------------------------------------------------- attributes */

function attributes(doc: XmlDoc, index: number, attr: number, start: number, end: number, labels: FetchLabels, out: FetchAnswer): void {
    const e = doc.elements[index];
    const spec = elementOf(e.name);
    if (!spec) {
        return;
    }
    const present = new Set(e.attrs.filter((_, i) => i !== attr).map((a) => a.name));
    // Renaming an attribute that already has its value keeps the value.
    const renaming = attr !== -1 && e.attrs[attr].value !== null;
    spec.attributes.forEach((a, i) => {
        if (present.has(a.name)) {
            return;
        }
        const listed = LISTED.has(a.kind) || (a.values?.length ?? 0) > 0;
        out.suggestions.push(item(a.name, "attribute", renaming ? a.name : `${a.name}="$1"`, !renaming, a.name, a.required ? labels.required : "", `${a.required ? 0 : 1}_${pad(i)}`, start, end, {
            documentation: a.description,
            retrigger: !renaming && listed
        }));
    });
}

/* --------------------------------------------------------------- values */

function values(doc: XmlDoc, index: number, spec: AttrSpec, start: number, end: number, closed: boolean, snapshot: Snapshot | null, labels: FetchLabels, out: FetchAnswer): void {
    switch (spec.kind) {
        case "enum":
        case "boolean":
        case "text":
        case "number":
            (spec.values ?? []).forEach((v, i) => out.suggestions.push(item(v, "value", v, false, v, "", `0_${pad(i)}`, start, end)));
            return;
        case "operator":
            operators(doc, index, start, end, snapshot, labels, out);
            return;
        case "table":
            if (doc.elements[index].name === "link-entity") {
                joins(doc, index, start, end, closed, snapshot, labels, out);
            }
            tables(start, end, snapshot, out);
            return;
        case "column":
        case "linkedColumn":
        case "parentColumn":
            columns(doc, index, spec, start, end, snapshot, out);
            return;
        case "linkAlias":
            [...linkAliases(doc)].forEach(([alias, link], i) => {
                out.suggestions.push(item(alias, "alias", alias, false, alias, tableOf(doc, link) ?? "", `0_${pad(i)}`, start, end));
            });
            return;
        case "attributeAlias":
            attributeAliases(doc).forEach((alias, i) => out.suggestions.push(item(alias, "alias", alias, false, alias, "", `0_${pad(i)}`, start, end)));
            return;
        case "value":
            choiceValues(doc, index, start, end, snapshot, out);
            return;
        default:
            return;
    }
}

function tables(start: number, end: number, snapshot: Snapshot | null, out: FetchAnswer): void {
    if (!snapshot) {
        return;
    }
    const list = snapshot.tables();
    if (list === undefined || list.state === "loading") {
        need(out, { kind: "tables" });
        return;
    }
    if (list.state !== "ready") {
        return;
    }
    for (const t of list.value) {
        out.suggestions.push(item(t.name, "table", t.name, false, t.label ? `${t.name} ${t.label}` : t.name, t.label ?? "", `1_${t.name}`, start, end, { description: t.label ?? undefined }));
    }
}

/**
 * The joins a link-entity can make from the table it sits under, each filling
 * in `from` and `to` — and `intersect` for a many-to-many — when the tag has
 * neither yet.
 */
function joins(doc: XmlDoc, index: number, start: number, end: number, closed: boolean, snapshot: Snapshot | null, labels: FetchLabels, out: FetchAnswer): void {
    const parentTable = tableOf(doc, containerOf(doc, doc.elements[index].parent));
    if (!snapshot || !parentTable) {
        return;
    }
    const links = snapshot.links(parentTable);
    if (links === undefined || links.state === "loading") {
        need(out, { kind: "links", table: parentTable });
        return;
    }
    if (links.state !== "ready") {
        return;
    }
    const e = doc.elements[index];
    const bare = !attrOf(e, "from") && !attrOf(e, "to");
    for (const link of links.value) {
        const rest = `" from="${link.from}" to="${link.to}"${link.intersect ? " intersect=\"true\"" : ""}`;
        // Inside the quotes: the closing quote already typed stays where it is.
        const insert = bare ? `${link.table}${closed ? rest.slice(0, -1) : rest}` : link.table;
        const detail = link.intersect ? labels.manyToMany.replace("{0}", link.through ?? "") : labels.relationship.replace("{0}", link.schemaName);
        out.suggestions.push(item(link.table, "relationship", insert, false, `${link.table} ${link.schemaName}`, detail, `0_${link.table}_${link.schemaName}`, start, end, {
            documentation: `\`${link.table}.${link.from}\` = \`${parentTable}.${link.to}\``,
            // Joins to one table read alike by name, and a self-referencing
            // lookup is a join each way: say what each inserts, from = to.
            description: link.intersect ? link.through : `${link.from} = ${link.to}`
        }));
    }
}

function columnsOf(snapshot: Snapshot | null, table: string, out: FetchAnswer): ColumnInfo[] | null {
    if (!snapshot) {
        return null;
    }
    const columns = snapshot.columns(table);
    if (columns === undefined || columns.state === "loading") {
        need(out, { kind: "columns", table });
        return null;
    }
    return columns.state === "ready" ? columns.value : null;
}

function columns(doc: XmlDoc, index: number, spec: AttrSpec, start: number, end: number, snapshot: Snapshot | null, out: FetchAnswer): void {
    const table = columnTable(doc, index, spec.kind);
    const list = table ? columnsOf(snapshot, table, out) : null;
    if (!list) {
        return;
    }
    // A shadow is a name FetchXML takes but nobody types first; one not valid
    // for read is refused by the server (SPEC.md, P2). Neither is offered.
    for (const c of list) {
        if (c.shadowOf || !c.readable) {
            continue;
        }
        out.suggestions.push(item(c.name, "column", c.name, false, c.label ? `${c.name} ${c.label}` : c.name, [c.label, c.typeName.replace(/Type$/, "")].filter(Boolean).join(" · "), `1_${c.name}`, start, end, {
            documentation: c.description ?? undefined,
            description: c.label ?? undefined
        }));
    }
}

/** The condition's column, when its table and its metadata are known. */
function conditionColumn(doc: XmlDoc, condition: number, snapshot: Snapshot | null, out: FetchAnswer): { table: string; column: ColumnInfo } | null {
    const name = attrOf(doc.elements[condition], "attribute")?.value?.trim();
    const table = columnTable(doc, condition, "column");
    if (!name || !table) {
        return null;
    }
    const column = columnsOf(snapshot, table, out)?.find((c) => c.name === name);
    return column ? { table, column } : null;
}

function operators(doc: XmlDoc, index: number, start: number, end: number, snapshot: Snapshot | null, labels: FetchLabels, out: FetchAnswer): void {
    const found = doc.elements[index].name === "condition" ? conditionColumn(doc, index, snapshot, out) : null;
    const types = found ? operandTypes(found.column.type, found.column.typeName) : [];
    OPERATORS.forEach((o, i) => {
        // Ranked by the column's type when it is known; never filtered out —
        // a ranking is a suggestion, and the server decides.
        const fits = types.length === 0 || o.types.some((t) => types.includes(t));
        out.suggestions.push(item(o.name, "operator", o.name, false, o.name, o.deprecated ? labels.deprecated : o.types.join(", "), `${o.deprecated ? 2 : fits ? 0 : 1}_${pad(i)}`, start, end, {
            documentation: o.description,
            deprecated: Boolean(o.deprecated)
        }));
    });
}

/** A choice's options, by label, inserting the number. */
function choiceValues(doc: XmlDoc, condition: number, start: number, end: number, snapshot: Snapshot | null, out: FetchAnswer): void {
    const found = conditionColumn(doc, condition, snapshot, out);
    if (!found || !snapshot || !isChoice(found.column.type, found.column.typeName)) {
        return;
    }
    const options = snapshot.options(found.table, found.column.name);
    if (options === undefined || options.state === "loading") {
        need(out, { kind: "options", table: found.table, column: found.column.name });
        return;
    }
    if (options.state !== "ready") {
        return;
    }
    options.value.forEach((o, i) => {
        const value = String(o.value);
        const label = o.label ?? value;
        out.suggestions.push(item(label, "value", value, false, `${label} ${value}`, value, `0_${pad(i)}`, start, end));
    });
}

