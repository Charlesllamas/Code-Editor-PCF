// Whether the caret's line is where the user can see it.
//
// The completion list and the hover live in a node under <body> (overflow.ts)
// and follow the form's scroll by re-rendering. That alone left the list
// floating over the form's sticky header once the editor slid beneath it
// (SPEC.md P1b): the editor was still partly in view, so nothing closed it.
// A form clips its scrolling content at the scroll container's edge, so the
// part of the page the user can see the editor through is the intersection
// of every clipping ancestor with the viewport — and once the caret's line
// leaves that, the widgets close.
//
// Rectangles in, a verdict out. overflow.ts reads the rectangles off the DOM;
// this file is the rule, and `dev/smoke.js` drives it in Node.

export interface Rect {
    top: number;
    left: number;
    bottom: number;
    right: number;
}

/** The overlap of two rectangles, or null when they do not meet. */
export function intersect(a: Rect, b: Rect): Rect | null {
    const out = {
        top: Math.max(a.top, b.top),
        left: Math.max(a.left, b.left),
        bottom: Math.min(a.bottom, b.bottom),
        right: Math.min(a.right, b.right)
    };
    return out.top < out.bottom && out.left < out.right ? out : null;
}

/** What survives every clip, starting from the viewport. */
export function visibleArea(viewport: Rect, clips: Rect[]): Rect | null {
    let area: Rect | null = viewport;
    for (const clip of clips) {
        if (!area) {
            return null;
        }
        area = intersect(area, clip);
    }
    return area;
}

/**
 * Whether a line is wholly inside the visible area. Half a line under a
 * header already puts the list next to something that is not the caret;
 * a pixel of rounding either way is not a reason to close it.
 */
export function lineVisible(area: Rect | null, line: { top: number; bottom: number }): boolean {
    if (!area) {
        return false;
    }
    return line.top >= area.top - 1 && line.bottom <= area.bottom + 1;
}
