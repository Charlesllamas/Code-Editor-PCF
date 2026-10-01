// What a FetchXML name means, under the pointer: an element, an attribute or
// an operator from the grammar; a table, a column or a choice's option from
// the environment's table definitions. Same `needs` protocol as
// fetchComplete.ts — it says what it would have shown, and the provider
// fetches that and asks again.
//
// Offsets in, offsets out. No Monaco import, and no DOM.

import { scanXml, placeAt, attrOf, textOf, XmlDoc } from "./xmlCursor";
import { attributeOf, elementOf, isChoice, operatorOf, AttrSpec } from "./fetchGrammar";
import { columnTable } from "./fetchScope";
import { Need, Snapshot } from "./metadata";
import { escapeMarkdown } from "./schemaNav";

/** The words a hover shows, from the control's .resx. */
export interface FetchHoverLabels {
    required: string;
    allowedValues: string;
    /** "Takes no value", … — keyed by arity. */
    takes: Record<"none" | "one" | "count" | "two" | "many", string>;
    /** "Not valid for read: Dataverse refuses it". */
    notReadable: string;
    /** "Name of {0}" — a shadow column. */
    shadowOf: string;
}

export interface FetchHoverAnswer {
    offset: number;
    length: number;
    markdown: string;
}

export interface FetchHoverResult {
    answer: FetchHoverAnswer | null;
    needs: Need[];
}

const MAX_VALUES = 10;

function code(text: string): string {
    return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

export function fetchHover(text: string, offset: number, snapshot: Snapshot | null, labels: FetchHoverLabels): FetchHoverResult {
    const doc = scanXml(text);
    const place = placeAt(doc, text, offset);
    const out: FetchHoverResult = { answer: null, needs: [] };
    const answer = (start: number, end: number, lines: string[]) => {
        const shown = lines.filter(Boolean);
        out.answer = shown.length > 0 && end > start ? { offset: start, length: end - start, markdown: shown.join("\n\n") } : null;
    };

    switch (place.kind) {
        case "elementName": {
            const e = doc.elements[place.element];
            const spec = elementOf(e.name);
            if (spec) {
                answer(place.start, place.end, [spec.description]);
            }
            break;
        }
        case "attributeName": {
            if (place.attr === -1) {
                break;
            }
            const e = doc.elements[place.element];
            const spec = attributeOf(e.name, e.attrs[place.attr].name);
            if (spec) {
                answer(place.start, place.end, [spec.description, ...attributeFacts(spec, labels)]);
            }
            break;
        }
        case "attributeValue": {
            const e = doc.elements[place.element];
            const attr = e.attrs[place.attr];
            const spec = attributeOf(e.name, attr.name);
            const value = (attr.value ?? "").trim();
            if (spec && value) {
                answer(place.start, place.end, valueLines(doc, place.element, spec, value, snapshot, labels, out.needs));
            }
            break;
        }
        case "text": {
            const e = doc.elements[place.element];
            if (e.name === "value" && e.parent !== -1 && doc.elements[e.parent].name === "condition") {
                const value = textOf(doc, text, place.element).trim();
                if (value) {
                    answer(e.contentStart, e.contentEnd, choiceLine(doc, e.parent, value, snapshot, out.needs));
                }
            }
            break;
        }
    }
    return out;
}

function attributeFacts(spec: AttrSpec, labels: FetchHoverLabels): string[] {
    const facts: string[] = [];
    if (spec.required) {
        facts.push(escapeMarkdown(labels.required));
    }
    if (spec.values && spec.values.length > 0) {
        const shown = spec.values.slice(0, MAX_VALUES).map(code).join(", ");
        facts.push(`${escapeMarkdown(labels.allowedValues)}: ${shown}${spec.values.length > MAX_VALUES ? ", …" : ""}`);
    }
    return facts;
}

function add(needs: Need[], n: Need): void {
    if (!needs.some((x) => JSON.stringify(x) === JSON.stringify(n))) {
        needs.push(n);
    }
}

function valueLines(doc: XmlDoc, index: number, spec: AttrSpec, value: string, snapshot: Snapshot | null, labels: FetchHoverLabels, needs: Need[]): string[] {
    switch (spec.kind) {
        case "operator": {
            const o = operatorOf(value);
            return o ? [escapeMarkdown(o.description), escapeMarkdown(labels.takes[o.arity]), o.types.map(code).join(" | ")] : [];
        }
        case "table": {
            if (!snapshot) {
                return [];
            }
            const tables = snapshot.tables();
            if (tables === undefined || tables.state === "loading") {
                add(needs, { kind: "tables" });
                return [];
            }
            const t = tables.state === "ready" ? tables.value.find((x) => x.name === value) : undefined;
            if (!t) {
                return [];
            }
            return [
                t.label ? `**${escapeMarkdown(t.label)}** ${code(t.name)}` : code(t.name),
                [t.entitySet ? code(t.entitySet) : "", t.primaryId ? code(t.primaryId) : "", t.primaryName ? code(t.primaryName) : ""].filter(Boolean).join(" · ")
            ];
        }
        case "column":
        case "linkedColumn":
        case "parentColumn": {
            const table = columnTable(doc, index, spec.kind);
            if (!snapshot || !table) {
                return [];
            }
            const columns = snapshot.columns(table);
            if (columns === undefined || columns.state === "loading") {
                add(needs, { kind: "columns", table });
                return [];
            }
            const c = columns.state === "ready" ? columns.value.find((x) => x.name === value) : undefined;
            if (!c) {
                return [];
            }
            return [
                c.label ? `**${escapeMarkdown(c.label)}** ${code(`${table}.${c.name}`)}` : code(`${table}.${c.name}`),
                code(c.typeName.replace(/Type$/, "")),
                c.shadowOf ? escapeMarkdown(labels.shadowOf.replace("{0}", c.shadowOf)) : "",
                c.readable ? "" : escapeMarkdown(labels.notReadable),
                c.description ? escapeMarkdown(c.description) : ""
            ];
        }
        case "value":
            return choiceLine(doc, index, value, snapshot, needs);
        default:
            return [escapeMarkdown(spec.description)];
    }
}

/** A choice value's label: `3` on an industry column is "Broadcasting…". */
function choiceLine(doc: XmlDoc, condition: number, value: string, snapshot: Snapshot | null, needs: Need[]): string[] {
    const name = attrOf(doc.elements[condition], "attribute")?.value?.trim();
    const table = columnTable(doc, condition, "column");
    if (!snapshot || !name || !table) {
        return [];
    }
    const columns = snapshot.columns(table);
    if (columns === undefined || columns.state === "loading") {
        add(needs, { kind: "columns", table });
        return [];
    }
    const column = columns.state === "ready" ? columns.value.find((c) => c.name === name) : undefined;
    if (!column || !isChoice(column.type, column.typeName)) {
        return [];
    }
    const options = snapshot.options(table, name);
    if (options === undefined || options.state === "loading") {
        add(needs, { kind: "options", table, column: name });
        return [];
    }
    const option = options.state === "ready" ? options.value.find((o) => String(o.value) === value) : undefined;
    return option?.label ? [`**${escapeMarkdown(option.label)}** ${code(value)}`] : [];
}
