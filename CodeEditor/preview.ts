// The Markdown preview: Monaco's own renderer — the one its hovers use, with
// `marked` 14 and a DOMPurify-based sanitiser inside it, already in the
// bundle — run with the decisions in previewPolicy.ts.
//
// What it does to a document, in order:
//
// 1. While the document is still tokens, every image becomes a link
//    (`walkTokens`). An image previewPolicy allows is marked to be drawn;
//    any other keeps its URL, so it is a link with its alt text and nothing
//    fetches it.
// 2. Monaco renders untrusted Markdown with HTML on, through a sanitiser
//    whose tag list has no media: an `<img>` or `<video>` written as HTML
//    never survives. Nothing executable survived it on the form or in the
//    harness (SPEC.md, the 1.5.9 probe, P3).
// 3. The marked links are drawn as images, from the source kept in step 1.
//    A link previewPolicy would not open (`mailto:`, anything not http or
//    https) is unwrapped to its text.
//
// Links are rendered `href=""` with the target in `data-href`, so a press
// is the action handler's to answer — it opens the URL through `openUrl`
// in a new tab, and Monaco prevents the default around it, which is what
// stops a press reloading the form.

import { allowedMarkdownHtmlTags, renderMarkdown } from "monaco-editor/base/browser/markdownRenderer";
import { Drawn, MEDIA_TAGS, Token, linkTarget, markedIndex, rewriteImageToken } from "./previewPolicy";

export interface PreviewOptions {
    /** The environment's origin, or null where there is none (canvas, the demo). */
    origin: string | null;
    /** Opens an http(s) URL; the control hands `context.navigation.openUrl`. */
    open: (url: string) => void;
    /** The title a refused image's link carries. */
    refusedTitle: (url: string) => string;
}

const TAGS = allowedMarkdownHtmlTags.filter((tag) => !MEDIA_TAGS.includes(tag));

/** Render `text` into `target`, replacing what was there. Dispose before the next render. */
export function renderPreview(text: string, target: HTMLElement, options: PreviewOptions): { dispose(): void } {
    const drawn: Drawn[] = [];

    const rendered = renderMarkdown(
        { value: text, isTrusted: false, supportHtml: true },
        {
            markedExtensions: [{
                walkTokens(token: Token) {
                    rewriteImageToken(token, options.origin, drawn, options.refusedTitle);
                }
            }],
            sanitizerConfig: { allowedTags: { override: TAGS } },
            actionHandler(href: string) {
                const url = linkTarget(href);
                if (url) {
                    options.open(url);
                }
            }
        }
    );

    const root = rendered.element;
    const doc = target.ownerDocument;

    for (const a of Array.from(root.querySelectorAll("a"))) {
        const index = markedIndex(a.getAttribute("title"));
        const image = index === null ? undefined : drawn[index];

        if (image) {
            const img = doc.createElement("img");
            img.src = image.src;
            img.alt = image.alt;
            if (image.title) {
                img.title = image.title;
            }
            a.replaceWith(img);
        } else if (!linkTarget(a.getAttribute("data-href"))) {
            a.replaceWith(...Array.from(a.childNodes));
        }
    }

    target.replaceChildren(root);

    return rendered;
}
