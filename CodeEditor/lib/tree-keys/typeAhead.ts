/*
 * _template/variants/lib/tree-keys — type-ahead
 *
 * SHARED. Copied into a control as <Control>/lib/tree-keys/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-10-15 from pcf-code-editor 1.7.0 (treeKeys.ts and the buffer
 * that lived in its index.ts).
 */

import { Press, TreeRow } from './keys';

/** How long a pause starts a new search, as the APG's tree example waits. */
export const TYPE_AHEAD_QUIET_MS = 500;

/** Whether a key is a printable character for type-ahead: one character, no shortcut held. */
export function isTypeAhead(press: Press): boolean {
    return (
        !press.ctrl &&
        !press.meta &&
        !press.alt &&
        [...press.key].length === 1 &&
        press.key !== ' ' &&
        press.key !== '*'
    );
}

export interface Buffer {
    text: string;
    /** When the last character arrived, in the clock `now` is read from. */
    at: number;
}

/**
 * The buffer after `char` arrives at `now`: appended within the quiet time,
 * started again after it. Pure, so the timing is the suite's to prove; the
 * control keeps the value between keys.
 */
export function nextBuffer(prev: Buffer | null, char: string, now: number, quietMs = TYPE_AHEAD_QUIET_MS): Buffer {
    const fresh = prev === null || now - prev.at > quietMs;
    return { text: (fresh ? '' : prev.text) + char, at: now };
}

/**
 * The next row whose name starts with `buffer`, searching from the row after
 * `focus` for a first character and from `focus` itself while the buffer
 * grows, wrapping round. -1 when nothing matches. Case is forgiven.
 */
export function typeAhead(rows: readonly TreeRow[], focus: number, buffer: string): number {
    if (rows.length === 0 || buffer === '') {
        return -1;
    }
    const wanted = buffer.toLowerCase();
    const start = wanted.length === 1 ? focus + 1 : focus;
    for (let i = 0; i < rows.length; i++) {
        const index = (((start + i) % rows.length) + rows.length) % rows.length;
        if (rows[index].name.toLowerCase().startsWith(wanted)) {
            return index;
        }
    }
    return -1;
}
