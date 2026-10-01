// The FetchXML checks, on a document that is already well-formed XML (the
// syntax check comes first, as it does for a JSON schema).
//
// Which fault is an error and which a warning is what the server decided,
// not this file (SPEC.md, the 1.4.9 probe, P2, 2026-10-01):
//
//   - **Errors** — the server refuses the query: an element FetchXML does not
//     have (`0x8004111c`, "Invalid Child Node"), an element where its parent
//     does not take it (the same refusal), an operator it does not know
//     (`0x80041120`). They count in `isValid` and `problemCount`.
//   - **Warnings** — everything else. An attribute FetchXML does not have is
//     *run*, not refused, so it cannot be an error; a value outside a fixed
//     list, a missing required attribute and a second `<entity>` were not
//     asked. And every name checked against the environment — a table or a
//     column it does not have, one not valid for read, a value that is not
//     one of a choice's options — depends on the environment, so it never
//     counts. An `entityname` that names no link-entity is a warning too.
//
// Metadata it lacks it asks for, through `needs`, and checks on the next
// pass. No Monaco import, and no DOM.

import { scanXml, attrOf, textOf, XmlDoc, XmlAttr } from "./xmlCursor";
import { ELEMENTS, attributeOf, elementOf, isChoice, operatorOf } from "./fetchGrammar";
import { columnTable, linkAliases } from "./fetchScope";
import { ColumnInfo, Need, Snapshot } from "./metadata";
import { positionAt, Problem } from "./validate";

export interface FetchValidation {
    problems: Problem[];
    needs: Need[];
}

/** Operators whose values are compared against a choice's options. */
const CHOICE_OPERATORS = new Set(["eq", "ne", "neq", "in", "not-in", "contain-values", "not-contain-values"]);

export function fetchValidate(text: string, snapshot: Snapshot | null): FetchValidation {
    const doc = scanXml(text);
    const out: FetchValidation = { problems: [], needs: [] };
    const mark = (start: number, end: number, message: string, severity: "error" | "warning") => {
        const at = positionAt(text, start);
        out.problems.push({ line: at.line, column: at.column, length: Math.max(1, end - start), message, severity });
    };
    const need = (n: Need) => {
        if (!out.needs.some((x) => JSON.stringify(x) === JSON.stringify(n))) {
            out.needs.push(n);
        }
    };

    const root = doc.roots[0];
    if (root !== undefined && doc.elements[root].name !== "fetch") {
        const r = doc.elements[root];
        mark(r.nameStart, r.nameEnd, "A FetchXML query starts with <fetch>", "warning");
        return out;
    }

    const aliases = linkAliases(doc);

    doc.elements.forEach((e, index) => {
        const spec = elementOf(e.name);
        const parent = e.parent === -1 ? null : doc.elements[e.parent];
        const parentSpec = parent ? elementOf(parent.name) : undefined;

        if (!spec) {
            if (parentSpec) {
                mark(e.nameStart, e.nameEnd, `<${e.name}> is not a FetchXML element — <${parent?.name}> takes ${list(parentSpec.children)}`, "error");
            }
            return;
        }
        if (parent && parentSpec && !parentSpec.children.includes(e.name)) {
            mark(e.nameStart, e.nameEnd, parentSpec.children.length > 0
                ? `<${e.name}> cannot go in <${parent.name}> — it takes ${list(parentSpec.children)}`
                : `<${e.name}> cannot go in <${parent.name}>, which takes no elements`, "error");
            return;
        }
        if (e.name === "entity" && parent && parent.children.filter((c) => doc.elements[c].name === "entity")[0] !== index) {
            mark(e.nameStart, e.nameEnd, "A query has one <entity>; join more tables with <link-entity>", "warning");
        }

        for (const attr of e.attrs) {
            const a = attributeOf(e.name, attr.name);
            const value = (attr.value ?? "").trim();
            if (!a) {
                mark(attr.nameStart, attr.nameEnd, `<${e.name}> has no "${attr.name}" attribute — Dataverse ignores it`, "warning");
                continue;
            }
            if (a.kind === "operator") {
                if (!operatorOf(value)) {
                    mark(attr.valueStart, attr.valueEnd, `Unknown operator "${value}"`, "error");
                }
                continue;
            }
            if ((a.kind === "enum" || a.kind === "boolean") && a.values && !a.values.includes(value)) {
                mark(attr.valueStart, attr.valueEnd, `"${value}" is not one of ${list(a.values)}`, "warning");
                continue;
            }
            if (a.kind === "number" && !/^\d+$/.test(value)) {
                mark(attr.valueStart, attr.valueEnd, `"${attr.name}" takes a whole number`, "warning");
                continue;
            }
            if (a.kind === "linkAlias" && value && !aliases.has(value)) {
                mark(attr.valueStart, attr.valueEnd, `No link-entity is named or aliased "${value}"`, "warning");
            }
        }
        for (const a of spec.attributes) {
            if (a.required && !attrOf(e, a.name)) {
                mark(e.nameStart, e.nameEnd, `<${e.name}> needs a "${a.name}"`, "warning");
            }
        }

        if (snapshot) {
            names(doc, text, index, snapshot, mark, need);
        }
    });

    out.problems.sort((a, b) => a.line - b.line || a.column - b.column);
    return out;
}

function list(names: string[]): string {
    return names.length === 0 ? "nothing" : names.map((n) => (ELEMENTS[n] ? `<${n}>` : `"${n}"`)).join(", ");
}

type Mark = (start: number, end: number, message: string, severity: "error" | "warning") => void;

/** The environment's names: tables, columns, readability, a choice's options. */
function names(doc: XmlDoc, text: string, index: number, snapshot: Snapshot, mark: Mark, need: (n: Need) => void): void {
    const e = doc.elements[index];

    const columnsOf = (table: string): ColumnInfo[] | null => {
        const load = snapshot.columns(table);
        if (load === undefined || load.state === "loading") {
            need({ kind: "columns", table });
            return null;
        }
        return load.state === "ready" ? load.value : null;
    };

    for (const attr of e.attrs) {
        const a = attributeOf(e.name, attr.name);
        const value = (attr.value ?? "").trim();
        if (!a || !value) {
            continue;
        }
        if (a.kind === "table") {
            // A table's columns answer for the table: a 404 there is "no such table".
            const load = snapshot.columns(value);
            if (load === undefined) {
                need({ kind: "columns", table: value });
            } else if (load.state === "notFound") {
                mark(attr.valueStart, attr.valueEnd, `There is no table "${value}" in this environment`, "warning");
            }
            continue;
        }
        if (a.kind === "column" || a.kind === "linkedColumn" || a.kind === "parentColumn") {
            const table = columnTable(doc, index, a.kind);
            const columns = table ? columnsOf(table) : null;
            if (!table || !columns) {
                continue;
            }
            const column = columns.find((c) => c.name === value);
            if (!column) {
                mark(attr.valueStart, attr.valueEnd, `${table} has no column "${value}"`, "warning");
            } else if (!column.readable) {
                mark(attr.valueStart, attr.valueEnd, `${table}.${value} is not valid for read — Dataverse refuses it`, "warning");
            }
        }
    }

    if (e.name === "condition") {
        choiceValues(doc, text, index, snapshot, columnsOf, mark, need);
    }
}

function choiceValues(doc: XmlDoc, text: string, index: number, snapshot: Snapshot, columnsOf: (table: string) => ColumnInfo[] | null, mark: Mark, need: (n: Need) => void): void {
    const e = doc.elements[index];
    const name = attrOf(e, "attribute")?.value?.trim();
    const operator = attrOf(e, "operator")?.value?.trim() ?? "";
    const table = columnTable(doc, index, "column");
    if (!name || !table || !CHOICE_OPERATORS.has(operator)) {
        return;
    }
    const column = columnsOf(table)?.find((c) => c.name === name);
    // A Yes/No is left alone: whether the server takes "true" for 1 was not asked.
    if (!column || !isChoice(column.type, column.typeName) || column.type === "Boolean") {
        return;
    }
    const load = snapshot.options(table, name);
    if (load === undefined || load.state === "loading") {
        need({ kind: "options", table, column: name });
        return;
    }
    if (load.state !== "ready") {
        return;
    }
    const known = new Set(load.value.map((o) => String(o.value)));
    const check = (value: string, start: number, end: number) => {
        if (value !== "" && !known.has(value)) {
            mark(start, end, `${value} is not an option of ${table}.${name}`, "warning");
        }
    };
    const valueAttr: XmlAttr | undefined = attrOf(e, "value");
    if (valueAttr) {
        check((valueAttr.value ?? "").trim(), valueAttr.valueStart, valueAttr.valueEnd);
    }
    for (const child of e.children) {
        const v = doc.elements[child];
        if (v.name === "value") {
            check(textOf(doc, text, child).trim(), v.contentStart, v.contentEnd);
        }
    }
}
