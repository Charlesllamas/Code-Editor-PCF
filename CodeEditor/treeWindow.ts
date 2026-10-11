/**
 * Which rows of the tree are drawn. The 1.6.9 probe drew 10,000 rows in
 * 167–177 ms on the form, and every row of a 1 MB document — 43,206 — in up
 * to 901 ms (SPEC.md, P1), so the tree draws only the rows in view, at a
 * fixed height, inside a box as tall as all of them.
 *
 * Pure, so the suite loads it from source.
 */

/** The rows to draw, `first` up to but not including `end`, with `overscan` either side. */
export function windowOf(scrollTop: number, viewHeight: number, rowHeight: number, count: number, overscan = 8): { first: number; end: number } {
    if (count <= 0 || rowHeight <= 0) {
        return { first: 0, end: 0 };
    }
    const top = Math.floor(Math.max(0, scrollTop) / rowHeight);
    const shown = Math.ceil(Math.max(0, viewHeight) / rowHeight) + 1;
    const first = Math.max(0, top - overscan);
    const end = Math.min(count, top + shown + overscan);
    return { first, end: Math.max(first, end) };
}

/** The scroll position that brings row `index` wholly into view, moving as little as it can. */
export function scrollFor(index: number, scrollTop: number, viewHeight: number, rowHeight: number): number {
    const top = index * rowHeight;
    const bottom = top + rowHeight;
    if (top < scrollTop) {
        return top;
    }
    if (bottom > scrollTop + viewHeight) {
        return Math.max(0, bottom - viewHeight);
    }
    return scrollTop;
}

/** How many whole rows the view shows: what Page Up and Page Down move by. */
export function pageOf(viewHeight: number, rowHeight: number): number {
    return Math.max(1, Math.floor(viewHeight / rowHeight) - 1);
}
