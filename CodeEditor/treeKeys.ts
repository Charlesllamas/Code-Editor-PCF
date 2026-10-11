/**
 * 1.7.0's tree keyboard: the WAI-ARIA tree pattern as a function of the rows
 * on show, the focused row and what is open. Every key the 1.6.9 probe
 * pressed reached the control on a form, and the form acted on none of them
 * (SPEC.md, the 1.6.9 probe, P2), so the map is the pattern's whole set.
 *
 * Pure, so the suite loads it from source; `index.ts` hands it a key and
 * applies what comes back.
 */

import { Row, opens, pathKey } from "./jsonTree";

export interface Press {
    key: string;
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
}

export type TreeAction = "reveal" | "copy";

export interface KeyResult {
    focus: number;
    expanded: Set<string>;
    action?: TreeAction;
    /** The key was the tree's: the browser's own default (a scroll) is stopped. */
    handled: boolean;
}

/** The row above `index` one level up, or -1 at the root. */
export function parentRow(rows: Row[], index: number): number {
    const level = rows[index]?.level ?? 1;
    for (let i = index - 1; i >= 0; i--) {
        if (rows[i].level === level - 1) {
            return i;
        }
    }
    return -1;
}

/**
 * What `press` does with the focus on `rows[focus]`. `page` is how many rows
 * the view shows, for Page Up and Page Down. A key the tree does not take
 * comes back unhandled, with nothing changed.
 */
export function treeKey(rows: Row[], focus: number, expanded: ReadonlySet<string>, press: Press, page = 10): KeyResult {
    const same = (): KeyResult => ({ focus, expanded: new Set(expanded), handled: false });
    if (rows.length === 0) {
        return same();
    }
    const at = Math.max(0, Math.min(focus, rows.length - 1));
    const row = rows[at];
    const to = (index: number): KeyResult => ({ focus: Math.max(0, Math.min(index, rows.length - 1)), expanded: new Set(expanded), handled: true });
    const toggled = (open: boolean): KeyResult => {
        const next = new Set(expanded);
        const key = pathKey(row.node.path);
        if (open) {
            next.add(key);
        } else {
            next.delete(key);
        }
        return { focus: at, expanded: next, handled: true };
    };

    if (press.ctrl || press.meta) {
        // Ctrl+C (Cmd+C) copies the focused node's path; every other shortcut is the host's.
        return !press.alt && press.key.toLowerCase() === "c" ? { ...to(at), action: "copy" } : same();
    }
    if (press.alt) {
        return same();
    }

    switch (press.key) {
        case "ArrowDown":
            return to(at + 1);
        case "ArrowUp":
            return to(at - 1);
        case "Home":
            return to(0);
        case "End":
            return to(rows.length - 1);
        case "PageDown":
            return to(at + Math.max(1, page));
        case "PageUp":
            return to(at - Math.max(1, page));
        case "ArrowRight":
            if (row.expanded === false) {
                return toggled(true);
            }
            if (row.expanded === true) {
                return to(at + 1);
            }
            return to(at);
        case "ArrowLeft":
            if (row.expanded === true) {
                return toggled(false);
            }
            {
                const parent = parentRow(rows, at);
                return to(parent >= 0 ? parent : at);
            }
        case "Enter":
            return { ...to(at), action: "reveal" };
        case "*": {
            // Every sibling that can open, opens; focus stays put.
            const parent = parentRow(rows, at);
            const siblings = parent >= 0 ? rows[parent].node.children : [row.node];
            const next = new Set(expanded);
            siblings.filter(opens).forEach((n) => next.add(pathKey(n.path)));
            return { focus: at, expanded: next, handled: true };
        }
        case " ":
            // Selection follows focus, so Space has nothing to select; taken
            // anyway, or the tree's own scroller jumps a page under the focus.
            return to(at);
        default:
            return same();
    }
}

/** A row's name as type-ahead matches it: the property name or index, lower-cased. */
export function rowName(row: Row): string {
    const key = row.node.key;
    return key === null ? "$" : String(key).toLowerCase();
}

/**
 * Type-ahead: the next row whose name starts with `buffer`, searching from
 * the row after `focus` for a first character and from `focus` itself while
 * the buffer grows, wrapping round. -1 when nothing matches.
 */
export function typeAhead(rows: Row[], focus: number, buffer: string): number {
    if (rows.length === 0 || buffer === "") {
        return -1;
    }
    const wanted = buffer.toLowerCase();
    const start = wanted.length === 1 ? focus + 1 : focus;
    for (let i = 0; i < rows.length; i++) {
        const index = (start + i) % rows.length;
        if (rowName(rows[index]).startsWith(wanted)) {
            return index;
        }
    }
    return -1;
}

/** Whether a key is a printable character for type-ahead: one character, no shortcut held. */
export function isTypeAhead(press: Press): boolean {
    return !press.ctrl && !press.meta && !press.alt && [...press.key].length === 1 && press.key !== " " && press.key !== "*";
}
