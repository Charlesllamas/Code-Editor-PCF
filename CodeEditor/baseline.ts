/**
 * What Changes compares the document with: the value as it was last saved,
 * as far as a field control can tell.
 *
 * A field control is never told the record was saved. What it does get, on a
 * model-driven form, is a burst of `updateView` passes naming the bound
 * property and carrying the value it already holds — three after a Save, two
 * after an auto-save, and two when the record was saved for a change to
 * another column (SPEC.md, the 1.5.9 probe, P2). The other two shapes a
 * `code` pass takes are told apart by the same reading:
 *
 * - **an echo** of this control's write lands 120–430 ms after the write
 *   (echo.ts), so nothing within `QUIET_MS` of a write counts;
 * - **a form script's `setValue`** is one pass carrying a *new* value, which
 *   never equals what the editor holds, so it is taken into the editor and
 *   stays in the diff — an unsaved change, as it should.
 *
 * Wrong towards showing too much, never too little: a save pressed within a
 * second of the last keystroke leaves the baseline where it was until the
 * next one, and a script that sets the value the editor already holds moves
 * it. A pass that does not name the bound property — a resize, the hub
 * demo's re-render — never moves it.
 *
 * Pure, so the suite loads it from source; the clock is the caller's.
 */

/** No write for this long, and a pass repeating the editor's text is a save. */
export const QUIET_MS = 1000;

/** The bound property's name, as `updatedProperties` lists it. */
export const BOUND = "code";

export class Baseline {
    private value: string;
    private lastWrite = Number.NEGATIVE_INFINITY;

    /** The value the control was mounted with: what the record holds. */
    public constructor(initial: string | null | undefined) {
        this.value = initial ?? "";
    }

    public get(): string {
        return this.value;
    }

    /** The control is handing the platform a value — a keystroke. */
    public wrote(now: number): void {
        this.lastWrite = now;
    }

    /**
     * A pass from the host, read before the editor takes anything from it.
     * `current` is the editor's text at that moment. Returns whether the
     * baseline moved.
     */
    public pass(incoming: string | null | undefined, current: string, updated: readonly string[] | null | undefined, now: number): boolean {
        const value = incoming ?? "";

        if (!updated || !updated.includes(BOUND)) {
            return false;
        }

        if (value !== current || now - this.lastWrite < QUIET_MS || value === this.value) {
            return false;
        }

        this.value = value;

        return true;
    }

    /**
     * The host handed the editor a new value it took (echo.ts), on a host
     * with **no form** — a canvas app, the hub's demo. There nothing is
     * unsaved but what the user typed: a new value is the app's `Default`
     * moving to another record, or a preset switching, so it is the new
     * starting point. On a form the same pass is a script's `setValue`,
     * unsaved, and the caller does not call this.
     */
    public took(value: string | null | undefined): void {
        this.value = value ?? "";
    }

    /** Whether the document differs from the baseline: whether Changes has anything to show. */
    public differs(current: string): boolean {
        return current !== this.value;
    }
}
