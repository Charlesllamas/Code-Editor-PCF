/**
 * 1.7.0's tree keyboard: the WAI-ARIA tree pattern as a function of the rows
 * on show, the focused row and what is open. Every key the 1.6.9 probe
 * pressed reached the control on a form, and the form acted on none of them
 * (SPEC.md, the 1.6.9 probe, P2), so the map is the pattern's whole set.
 *
 * The map itself lives in the template's shared `lib/tree-keys` since
 * 2026-10-15 — lifted from this file — and this one adapts the JSON tree to
 * it: a row's id is its path key, its name is what type-ahead matches, and
 * the ids the map names to open and close are applied to the expanded set
 * here, so `index.ts` and the suite keep the shape they had.
 *
 * Pure, so the suite loads it from source; `index.ts` hands it a key and
 * applies what comes back.
 */

import { Row, pathKey } from "./jsonTree";
import { Press, TreeRow, parentIndex, treeKey as sharedTreeKey } from "./lib/tree-keys/keys";
import { isTypeAhead, typeAhead as sharedTypeAhead } from "./lib/tree-keys/typeAhead";

export { Press, isTypeAhead };

export type TreeAction = "reveal" | "copy";

export interface KeyResult {
    focus: number;
    expanded: Set<string>;
    action?: TreeAction;
    /** The key was the tree's: the browser's own default (a scroll) is stopped. */
    handled: boolean;
}

/** A row's name as type-ahead matches it: the property name or index, lower-cased. */
export function rowName(row: Row): string {
    const key = row.node.key;
    return key === null ? "$" : String(key).toLowerCase();
}

/** The JSON tree's rows as the shared map reads them. */
export function asTreeRows(rows: Row[]): TreeRow[] {
    return rows.map((row) => ({ id: pathKey(row.node.path), level: row.level, expanded: row.expanded, name: rowName(row) }));
}

/** The row above `index` one level up, or -1 at the root. */
export function parentRow(rows: Row[], index: number): number {
    return parentIndex(asTreeRows(rows), index);
}

/**
 * What `press` does with the focus on `rows[focus]`. `page` is how many rows
 * the view shows, for Page Up and Page Down. A key the tree does not take
 * comes back unhandled, with nothing changed.
 */
export function treeKey(rows: Row[], focus: number, expanded: ReadonlySet<string>, press: Press, page = 10): KeyResult {
    const result = sharedTreeKey(asTreeRows(rows), focus, press, page);
    const next = new Set(expanded);
    result.open.forEach((id) => next.add(id));
    result.close.forEach((id) => next.delete(id));
    const action: TreeAction | undefined = result.action === "activate" ? "reveal" : result.action;
    return { focus: result.focus, expanded: next, handled: result.handled, ...(action ? { action } : {}) };
}

/**
 * Type-ahead: the next row whose name starts with `buffer`, searching from
 * the row after `focus` for a first character and from `focus` itself while
 * the buffer grows, wrapping round. -1 when nothing matches.
 */
export function typeAhead(rows: Row[], focus: number, buffer: string): number {
    return sharedTypeAhead(asTreeRows(rows), focus, buffer);
}
