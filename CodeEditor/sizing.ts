// How tall the control is, as one decision.
//
// Three parties have an opinion, in this order of precedence:
//
//   1. The host. A canvas app always allocates a box, and a model-driven
//      form sometimes does; when `allocatedHeight` is positive it is the box
//      the maker drew, and nothing below overrides it.
//   2. The maker, through the `height` property — the number the form gets
//      when it allocates none, which on a model-driven form is the usual case.
//      Unset, 500px, which is what 1.1.0 hard-wired.
//   3. The document, when `fitContent` is on: the editor grows with what is
//      in it, between a floor that shows a few lines and the maker's number as
//      a ceiling — a ceiling, because a form section grows to fit its contents
//      and a 3,000-line document would otherwise be a 3,000-line form.
//
// Kept free of Monaco and the DOM so `dev/smoke.js` can drive every branch.

/** What the editor falls back to when nobody says otherwise — 1.1.0's constant. */
export const FALLBACK_HEIGHT = 500;

/** With `fitContent` on, never shorter than this — about four lines plus the strip. */
export const MIN_FIT_HEIGHT = 96;

/** The status strip under the editor; the editor gets the rest. */
export const STATUS_BAR_HEIGHT = 24;

export interface HeightInputs {
    /** `context.mode.allocatedHeight`; `-1` (or `0`) when the host has no opinion. */
    allocated: number;
    /** The `height` property; `null` when the maker left it blank. */
    preferred: number | null;
    fitContent: boolean;
    /** Monaco's `getContentHeight()`, or `null` before the editor exists. */
    contentHeight: number | null;
}

/** The height of the whole control, strip included. */
export function resolveHeight(input: HeightInputs): number {
    if (input.allocated > 0) {
        return Math.round(input.allocated);
    }

    const preferred = input.preferred !== null && input.preferred > 0
        ? Math.round(input.preferred)
        : FALLBACK_HEIGHT;

    if (input.fitContent && input.contentHeight !== null) {
        const wanted = Math.ceil(input.contentHeight) + STATUS_BAR_HEIGHT;
        return Math.max(Math.min(MIN_FIT_HEIGHT, preferred), Math.min(wanted, preferred));
    }

    return preferred;
}

/**
 * `allocatedWidth` is `-1` until the control asks with `trackContainerResize`
 * and on hosts that never answer; the container's own width is the fallback.
 */
export function resolveWidth(allocated: number, measured: number): number {
    return allocated > 0 ? Math.round(allocated) : Math.max(0, Math.round(measured));
}
