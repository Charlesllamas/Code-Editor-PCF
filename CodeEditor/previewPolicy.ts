/**
 * What the Markdown preview may open, and which images it may draw.
 *
 * Decided before rendering, because rendering is too late. Monaco's renderer
 * hands back a fragment imported into the live document, and an image there
 * starts loading whether it is attached or not: on the form and in the
 * harness it fetched three `example.com` URLs — a Markdown image, a raw
 * `<img>`, a `<video>` — before anything could strip them (SPEC.md, the 1.5.9
 * probe, P3). So every Markdown image is turned into a link while it is still
 * a token, and only the ones this module allows are drawn, after sanitising.
 * Raw-HTML media never survive the sanitiser (`MEDIA_TAGS`).
 *
 * Allowed: an image from the environment's own origin, and a `data:` image,
 * which contacts nobody. Anything else stays a link with its alt text, so
 * opening a record never tells a third party who opened it.
 *
 * Pure, so the suite loads it from source.
 */

/** Tags taken out of the sanitiser's allow-list: nothing that fetches survives raw HTML. */
export const MEDIA_TAGS: readonly string[] = ["img", "video", "audio", "source", "picture", "track"];

/**
 * Starts the title of a link that stands for an allowed image until it is
 * drawn, followed by its index. A zero-width space: invisible should the
 * drawing ever not happen, and not something a writer types.
 */
export const IMAGE_MARK = String.fromCharCode(0x200b);

/**
 * The href an allowed image's link carries until it is drawn. The renderer
 * drops a link to `data:` (measured in the harness), and the real source is
 * kept beside the token anyway; `.invalid` never resolves.
 */
export const PLACEHOLDER = "https://image.invalid/";

/** An image the preview will draw, in the order the tokens were walked. */
export interface Drawn {
    src: string;
    alt: string;
    title: string;
}

/**
 * Where a link in the preview may go: an absolute `http` or `https` URL, as
 * `openUrl` takes it (the skill's allow-list), or nowhere. `mailto:` did
 * nothing through `openUrl` on the form (P4), so it renders as its text.
 */
export function linkTarget(href: string | null | undefined): string | null {
    if (typeof href !== "string") {
        return null;
    }

    let url: URL;

    try {
        url = new URL(href.trim());
    } catch {
        return null; // a relative path lands here too: no base the control can honestly choose
    }

    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i;

/**
 * The source an image may be drawn from, or null for "a link instead".
 * `origin` is the environment's (from `page.getClientUrl()`); without one —
 * a canvas app, the hub's demo — only `data:` images are drawn.
 */
export function imageSource(href: string | null | undefined, origin: string | null): string | null {
    if (typeof href !== "string") {
        return null;
    }

    const trimmed = href.trim();

    if (DATA_IMAGE.test(trimmed)) {
        return trimmed;
    }

    if (!origin) {
        return null;
    }

    let base: URL;
    let url: URL;

    try {
        base = new URL(origin);
        url = new URL(trimmed, base);
    } catch {
        return null;
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return null;
    }

    return url.origin === base.origin ? url.href : null;
}

/** The part of a `marked` token this reads and rewrites. */
export interface Token {
    type: string;
    href?: string;
    title?: string | null;
    text?: string;
    tokens?: unknown[];
}

/**
 * The `walkTokens` body: turn an image token into a link token. An allowed
 * one gets the placeholder href and a marked title, and its source goes on
 * `drawn`; a refused one keeps its URL, so it opens in a new tab like any
 * other link, and says why in its title. The alt text is already escaped by
 * the lexer (`marked` 14), so it goes in as an escaped text token.
 */
export function rewriteImageToken(token: Token, origin: string | null, drawn: Drawn[], refusedTitle: (url: string) => string): void {
    if (token.type !== "image" || typeof token.href !== "string") {
        return;
    }

    const alt = token.text ?? "";
    const src = imageSource(token.href, origin);

    token.type = "link";
    token.tokens = [{ type: "text", raw: alt, text: alt, escaped: true }];

    if (src) {
        drawn.push({ src, alt, title: token.title ?? "" });
        token.href = `${PLACEHOLDER}${drawn.length - 1}`;
        token.title = `${IMAGE_MARK}${drawn.length - 1}`;
    } else {
        token.title = refusedTitle(token.href);
    }
}

/** The index a marked title carries, or null for an ordinary link. */
export function markedIndex(title: string | null | undefined): number | null {
    if (typeof title !== "string" || !title.startsWith(IMAGE_MARK)) {
        return null;
    }

    const digits = title.slice(IMAGE_MARK.length);

    // Digits, not Number(): Number("") is 0, and a bare mark is no index.
    return /^\d+$/.test(digits) ? Number(digits) : null;
}
