// Where the completion list and the hover live, and what keeps them honest.
//
// Measured on the Accounts form with the 1.3.10 probe (SPEC.md P1):
//
//   - Inside the editor, as 1.3 had it, the form's `overflow: hidden`
//     containers cut them: the list on a short field's last line was not
//     clipped but gone, and a hover near the top lost 138px.
//   - `fixedOverflowWidgets` alone put every one of them 296px below and 44px
//     right of the caret. Three of the form's containers carry an identity
//     `transform`, which makes each the containing block for position: fixed,
//     while Monaco computes the widget's coordinates against the viewport.
//     It cannot work on a model-driven form.
//   - `overflowWidgetsDomNode` — a node under <body>, outside every one of
//     those containers — placed all of them on the caret, whole. But Monaco
//     repositions an overflow widget on its own scroll only, and the form's
//     scroll belongs to a container around it: the list stayed behind.
//
// So the widgets go in a node under <body>, and a capturing scroll listener
// re-renders the editor on any scroll outside it (Monaco reads the editor's
// page position again when it lays the widgets out) — or closes them once
// the caret's line leaves the visible part of the form (clip.ts). An
// IntersectionObserver closes them when the editor leaves the view entirely,
// which is also what a form-tab switch does (P1b).
//
// DOM, but no Monaco: index.ts hands in what to do.

import { Rect } from "./clip";

/**
 * The node Monaco renders overflow widgets into. Monaco's stylesheet and
 * theme variables are scoped under `.monaco-editor`, so the node carries the
 * class or the list renders unstyled.
 */
export function createOverflowNode(doc: Document): HTMLElement {
    const node = doc.createElement("div");
    node.className = "monaco-editor CodeEditor-overflow";
    doc.body.appendChild(node);
    return node;
}

/** The viewport, as a rectangle. */
export function viewportRect(win: Window): Rect {
    return { top: 0, left: 0, bottom: win.innerHeight, right: win.innerWidth };
}

/**
 * The rectangle of every ancestor of `el` that clips what overflows it —
 * the form's scroll container, its sections, the shell — innermost first.
 */
export function clipRects(el: Element): Rect[] {
    const view = el.ownerDocument.defaultView;
    const out: Rect[] = [];
    for (let node = el.parentElement; node && view; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        if (style.overflowX === "visible" && style.overflowY === "visible") {
            continue;
        }
        const r = node.getBoundingClientRect();
        out.push({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
    }
    return out;
}

/**
 * Call `onScroll` for every scroll outside `host` — the form's, the page's,
 * any container's; the editor's own scroll is Monaco's — and `onHidden` when
 * `host` leaves the view. Returns the function that stops both.
 */
export function watchOuterScroll(host: HTMLElement, onScroll: () => void, onHidden: () => void): () => void {
    const doc = host.ownerDocument;
    const listener = (e: Event) => {
        const target = e.target;
        if (target instanceof Node && target !== doc && host.contains(target)) {
            return;
        }
        onScroll();
    };
    doc.addEventListener("scroll", listener, { capture: true, passive: true });

    const view = doc.defaultView as (Window & typeof globalThis) | null;
    const observer = view && typeof view.IntersectionObserver === "function"
        ? new view.IntersectionObserver((entries) => {
            if (entries.some((entry) => !entry.isIntersecting)) {
                onHidden();
            }
        })
        : null;
    observer?.observe(host);

    return () => {
        doc.removeEventListener("scroll", listener, { capture: true });
        observer?.disconnect();
    };
}
