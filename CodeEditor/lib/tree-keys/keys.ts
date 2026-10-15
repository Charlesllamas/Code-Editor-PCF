/*
 * _template/variants/lib/tree-keys — the keys
 *
 * SHARED. Copied into a control as <Control>/lib/tree-keys/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-10-15 from pcf-code-editor 1.7.0's treeKeys.ts, whose SPEC.md
 * carries the 1.6.9 probe: every key below reached a focusable element
 * inside a control on a model-driven form, and the form acted on none.
 */

/**
 * The WAI-ARIA tree pattern's keyboard as a function of the rows on show,
 * the focused row and a key. Pure — no DOM, no React — so a suite loads it
 * through `dev/modules.js`, and the control only applies what comes back:
 * moves the focus, opens and closes what `open` and `close` name, and runs
 * `action`. `handled` decides `preventDefault()`.
 *
 * Rows are whatever the control draws, flattened in the order it draws them
 * (depth first, an open node's children under it) and reduced to the four
 * things the pattern needs. Which rows are open stays the control's own
 * state; this names ids, it never owns a set.
 */

export interface TreeRow {
    /** The control's own key for the node: what `open` and `close` name. */
    id: string;
    /** 1 at the top, as `aria-level` counts. */
    level: number;
    /** `true` open, `false` closed, `undefined` a node that cannot open. */
    expanded: boolean | undefined;
    /** What type-ahead matches, as the row shows it. */
    name: string;
}

export interface Press {
    key: string;
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
}

/** Enter asks for the row's action; Ctrl+C (Cmd+C) for a copy. */
export type TreeAction = 'activate' | 'copy';

export interface KeyResult {
    focus: number;
    /** Ids to open, in row order. */
    open: string[];
    /** Ids to close. */
    close: string[];
    action?: TreeAction;
    /** The key was the tree's: stop the browser's own default (a scroll). */
    handled: boolean;
}

/** The row above `index` one level up, or -1 at the top. */
export function parentIndex(rows: readonly TreeRow[], index: number): number {
    const level = rows[index]?.level ?? 1;
    for (let i = index - 1; i >= 0; i--) {
        if (rows[i].level === level - 1) {
            return i;
        }
    }
    return -1;
}

/** The rows that share `index`'s parent, itself included. */
export function siblingIndexes(rows: readonly TreeRow[], index: number): number[] {
    const level = rows[index]?.level ?? 1;
    const parent = parentIndex(rows, index);
    const out: number[] = [];
    for (let i = parent + 1; i < rows.length; i++) {
        if (rows[i].level < level) {
            break;
        }
        if (rows[i].level === level) {
            out.push(i);
        }
    }
    return out;
}

/**
 * What `press` does with the focus on `rows[focus]`. `page` is how many rows
 * the view shows, for Page Up and Page Down. A key the tree does not take
 * comes back unhandled, with nothing changed.
 */
export function treeKey(rows: readonly TreeRow[], focus: number, press: Press, page = 10): KeyResult {
    const same = (): KeyResult => ({ focus, open: [], close: [], handled: false });
    if (rows.length === 0) {
        return same();
    }
    const at = Math.max(0, Math.min(focus, rows.length - 1));
    const row = rows[at];
    const to = (index: number): KeyResult => ({
        focus: Math.max(0, Math.min(index, rows.length - 1)),
        open: [],
        close: [],
        handled: true,
    });

    if (press.ctrl || press.meta) {
        // Ctrl+C (Cmd+C) is the tree's; every other shortcut is the host's.
        return !press.alt && press.key.toLowerCase() === 'c' ? { ...to(at), action: 'copy' } : same();
    }
    if (press.alt) {
        return same();
    }

    switch (press.key) {
        case 'ArrowDown':
            return to(at + 1);
        case 'ArrowUp':
            return to(at - 1);
        case 'Home':
            return to(0);
        case 'End':
            return to(rows.length - 1);
        case 'PageDown':
            return to(at + Math.max(1, page));
        case 'PageUp':
            return to(at - Math.max(1, page));
        case 'ArrowRight':
            if (row.expanded === false) {
                return { ...to(at), open: [row.id] };
            }
            if (row.expanded === true) {
                // To the first child — if the control has drawn one yet.
                return to(rows[at + 1]?.level === row.level + 1 ? at + 1 : at);
            }
            return to(at);
        case 'ArrowLeft': {
            if (row.expanded === true) {
                return { ...to(at), close: [row.id] };
            }
            const parent = parentIndex(rows, at);
            return to(parent >= 0 ? parent : at);
        }
        case 'Enter':
            return { ...to(at), action: 'activate' };
        case '*': {
            // Every sibling that can open, opens; focus stays put.
            const open = siblingIndexes(rows, at)
                .filter((i) => rows[i].expanded === false)
                .map((i) => rows[i].id);
            return { ...to(at), open };
        }
        case ' ':
            // Selection follows focus, so Space has nothing to select; taken
            // anyway, or the tree's own scroller jumps a page under the focus.
            return to(at);
        default:
            return same();
    }
}
