// THROWAWAY — the 1.5.9 probe build. Delete this file and its import in
// index.ts before 1.6.0.
//
// It asks the form the questions 1.6.0 rests on (SPEC.md, the 1.5.9 probe):
// whether Monaco's diff editor computes on the form without a worker, whether
// a field control can see the form being saved, what Monaco's own Markdown
// renderer leaves of hostile input and which images it fetches, which images
// the form will load, and what openUrl does with a link pressed in the
// preview. It touches no editor and changes nothing on the record. From the
// browser console:
//
//     const p = window.__pcfCodeEditorProbe
//     p.env()                       the host: page, client URL, navigation, language
//     await p.diff(500)             P1: a diff editor over two 500-line documents
//     p.mark("typed")               P2: a label in the pass log — see SPEC.md for the steps
//     p.passes()                    P2: every init and updateView since the page loaded
//     await p.markdown()            P3: the hostile sample, two configurations
//     await p.images()              P3: which image sources the form loads
//     p.links()                     P4: buttons that call openUrl — press them, say what opened
//     copy(await p.all())           all of the above but the buttons, onto the clipboard
//
// Each answer goes into SPEC.md verbatim, and a wrong one removes the feature
// it names.

import { IInputs } from "./generated/ManifestTypes";
import monaco from "./monacoSetup";
// The renderer Monaco's hovers use, imported directly: what 1.6.0 would reuse.
import { renderMarkdown } from "monaco-editor/base/browser/markdownRenderer";
import { allowedMarkdownHtmlTags } from "monaco-editor/base/browser/markdownRenderer";

type Context = ComponentFramework.Context<IInputs>;

const PROBE_VERSION = "1.5.9";

let latest: Context | undefined;
let installed = false;
let mounts = 0;
const started = performance.now();

interface Pass {
    t: number;
    kind: "init" | "update" | "mark" | "destroy";
    mount: number;
    updated?: string[];
    length?: number;
    hash?: string;
    focus?: boolean;
    disabled?: boolean;
    label?: string;
}

const passes: Pass[] = [];

/** FNV-1a, enough to tell two values apart in a pasted log without pasting them. */
function hash(text: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}

function round(ms: number): number {
    return Math.round(ms * 10) / 10;
}

function message(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Called from init, every updateView and destroy: the pass log (P2), and the latest context. */
export function see(context: Context | undefined, kind: "init" | "update" | "destroy", focus: boolean): void {
    if (kind === "init") {
        mounts++;
    }
    if (context) {
        latest = context;
    }
    const raw = context?.parameters.code.raw ?? "";
    passes.push({
        t: round(performance.now() - started),
        kind,
        mount: mounts,
        updated: context ? [...(context.updatedProperties ?? [])] : undefined,
        length: context ? raw.length : undefined,
        hash: context ? hash(raw) : undefined,
        focus,
        disabled: context?.mode.isControlDisabled
    });
    if (passes.length > 400) {
        passes.splice(0, passes.length - 400);
    }
    if (!installed) {
        installed = true;
        (window as unknown as { __pcfCodeEditorProbe?: unknown }).__pcfCodeEditorProbe = api;
        console.info(`Code Editor ${PROBE_VERSION} probe: window.__pcfCodeEditorProbe — see SPEC.md, the 1.5.9 probe`);
    }
}

/* ---------------------------------------------------------------- host */

function clientUrl(): { url: string | null; how: string } {
    const page = (latest as unknown as { page?: { getClientUrl?: () => string } } | undefined)?.page;
    if (!page) {
        return { url: null, how: "context.page absent" };
    }
    if (typeof page.getClientUrl !== "function") {
        return { url: null, how: "context.page has no getClientUrl" };
    }
    try {
        return { url: page.getClientUrl(), how: "page.getClientUrl()" };
    } catch (error) {
        return { url: null, how: `getClientUrl threw ${message(error)}` };
    }
}

function env(): Record<string, unknown> {
    const navigation = latest?.navigation as unknown as Record<string, unknown> | undefined;
    const code = latest?.parameters.code as unknown as Record<string, unknown> | undefined;
    return {
        probe: PROBE_VERSION,
        origin: window.location.origin,
        framed: window !== window.top,
        clientUrl: clientUrl(),
        languageId: latest?.userSettings?.languageId,
        navigation: navigation ? Object.keys(navigation).filter((k) => typeof navigation[k] === "function").sort() : null,
        codeKeys: code ? Object.keys(code).sort() : null,
        security: latest?.parameters.code.security ?? null,
        disabled: latest?.mode.isControlDisabled,
        mounts,
        csp: (document.querySelector("meta[http-equiv='Content-Security-Policy']") as HTMLMetaElement | null)?.content ?? "no meta CSP (a header CSP is in DevTools, Network, the document's response headers)"
    };
}

/* ------------------------------------------------------- P1: the diff */

/** A JSON document of `lines` lines; `edited` changes one value, inserts a line and deletes one. */
function document_(lines: number, edited: boolean): string {
    const rows: string[] = [];
    for (let i = 0; i < lines - 2; i++) {
        rows.push(`  "key${i}": { "id": ${i}, "name": "row ${i}", "on": ${i % 2 === 0} }`);
    }
    if (edited) {
        const a = Math.floor(rows.length * 0.1);
        const b = Math.floor(rows.length * 0.5);
        const c = Math.floor(rows.length * 0.9);
        rows[a] = rows[a].replace(`"row ${a}"`, `"row ${a}, edited"`);
        rows.splice(b, 0, `  "inserted": { "id": -1, "name": "new", "on": true }`);
        rows.splice(c + 1, 1);
    }
    return `{\n${rows.join(",\n")}\n}`;
}

async function diff(lines = 500): Promise<Record<string, unknown>> {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:600px;";
    document.body.appendChild(host);

    const said: string[] = [];
    const warn = console.warn;
    const error = console.error;
    console.warn = (...args: unknown[]) => { said.push(`warn: ${args.map(String).join(" ").slice(0, 200)}`); warn.apply(console, args); };
    console.error = (...args: unknown[]) => { said.push(`error: ${args.map(String).join(" ").slice(0, 200)}`); error.apply(console, args); };

    const resourcesBefore = performance.getEntriesByType("resource").length;

    // The longest the main thread went without running a 10 ms ticker: the
    // stall a user typing on the form would feel while the diff computes.
    let last = performance.now();
    let stall = 0;
    const ticker = window.setInterval(() => {
        const now = performance.now();
        stall = Math.max(stall, now - last);
        last = now;
    }, 10);

    const original = monaco.editor.createModel(document_(lines, false), "json");
    const modified = monaco.editor.createModel(document_(lines, true), "json");
    const t0 = performance.now();
    let editor: monaco.editor.IStandaloneDiffEditor | undefined;
    let ms: number | null = null;
    let threw: string | null = null;
    try {
        editor = monaco.editor.createDiffEditor(host, { readOnly: true, automaticLayout: false, renderSideBySide: true });
        const created = performance.now() - t0;
        const computed = new Promise<number | null>((resolve) => {
            const sub = editor!.onDidUpdateDiff(() => {
                sub.dispose();
                resolve(performance.now() - t0);
            });
            window.setTimeout(() => resolve(null), 10000);
        });
        editor.setModel({ original, modified });
        ms = await computed;
        const changes = editor.getLineChanges();
        await new Promise((r) => window.setTimeout(r, 50));
        return {
            lines,
            createMs: round(created),
            firstDiffMs: ms === null ? "no onDidUpdateDiff within 10 s" : round(ms),
            changes: changes ? changes.length : null,
            expected: 3,
            shape: changes?.map((c) => [c.originalStartLineNumber, c.originalEndLineNumber, c.modifiedStartLineNumber, c.modifiedEndLineNumber]) ?? null,
            longestStallMs: round(stall),
            workerRequests: performance.getEntriesByType("resource").slice(resourcesBefore).map((e) => e.name).filter((n) => /worker/i.test(n)),
            console: said
        };
    } catch (e) {
        threw = message(e);
        return { lines, threw, console: said };
    } finally {
        window.clearInterval(ticker);
        console.warn = warn;
        console.error = error;
        editor?.dispose();
        original.dispose();
        modified.dispose();
        host.remove();
    }
}

/* ------------------------------------------------- P3: the renderer */

/**
 * Every hostile shape worth naming, and the images to watch. Remote images go
 * to example.com, the domain IANA keeps for exactly this, each URL unique to
 * the configuration that renders it so a fetch can be pinned on one.
 */
function sample(tag: string): string {
    return [
        "# Heading",
        "",
        "Some **bold**, `code`, ~~struck~~ and a table:",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "- [x] a task",
        "- [ ] another",
        "",
        "Links: [https](https://example.com/page) · [mailto](mailto:someone@example.com) · [js](javascript:window.__probeXss='md-js') · [data](data:text/html,<script>window.__probeXss='md-data'</script>) · [command](command:workbench.action.reload) · [relative](/main.aspx?pagetype=entitylist) · <https://example.com/autolink>",
        "",
        `Images: ![remote](https://example.com/probe-${tag}-md.png "remote title") · ![relative](/_imgs/probe-${tag}-md.png) · ![data](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)`,
        "",
        "```",
        `![inside code, not an image](https://example.com/probe-${tag}-code.png)`,
        "```",
        "",
        "<script>window.__probeXss='script'</script>",
        `<img src="https://example.com/probe-${tag}-html.png" onerror="window.__probeXss='onerror'">`,
        `<img src="/_imgs/probe-${tag}-html.png">`,
        "<iframe src=\"https://example.com/frame\"></iframe>",
        "<style>body{display:none}</style>",
        "<svg onload=\"window.__probeXss='svg'\"><circle r=\"5\"></circle></svg>",
        "<a href=\"javascript:window.__probeXss='html-js'\">raw js</a>",
        "<div style=\"position:fixed;top:0;left:0;width:100vw;height:100vh;background:red\">overlay</div>",
        "<details><summary>more</summary>inside <sub>sub</sub> <kbd>Ctrl</kbd></details>",
        "<input type=\"text\" value=\"x\"> <input type=\"checkbox\" checked>",
        "<form action=\"https://example.com/post\"><button>go</button></form>",
        `<video src="https://example.com/probe-${tag}-video.mp4"></video>`,
        `<p style="color: red">styled</p>`,
        "<object data=\"https://example.com/x.swf\"></object><embed src=\"https://example.com/x.swf\">"
    ].join("\n");
}

const MEDIA = new Set(["img", "video", "audio", "source", "picture", "track"]);

/** Starts the title of a link that stands for a same-origin image until it is drawn. */
const MARK = "\u200b";

/** What survived that could run, style the page, or fetch. */
function residue(root: HTMLElement): Record<string, unknown> {
    const all = Array.from(root.querySelectorAll("*"));
    const handlers = all.flatMap((el) => Array.from(el.attributes).filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName.toLowerCase()}[${a.name}]`));
    const dangerousTags = all.map((el) => el.tagName.toLowerCase()).filter((t) => ["script", "iframe", "style", "object", "embed", "form", "button", "svg", "math", "link", "meta", "base"].includes(t));
    const scriptUrls = all.flatMap((el) => ["href", "src", "data-href", "action", "formaction"]
        .map((n) => el.getAttribute(n))
        .filter((v): v is string => !!v && /^\s*(javascript|vbscript|data:text)/i.test(v)));
    const styles = all.filter((el) => el.hasAttribute("style")).map((el) => `${el.tagName.toLowerCase()}: ${el.getAttribute("style")}`);
    const media = all.filter((el) => MEDIA.has(el.tagName.toLowerCase())).map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute("src") ?? ""}`);
    const links = Array.from(root.querySelectorAll("a")).map((a) => ({ text: a.textContent, href: a.getAttribute("href"), dataHref: a.getAttribute("data-href"), title: a.getAttribute("title") }));
    return { handlers, dangerousTags, scriptUrls, styles, media, links };
}

/**
 * The candidate 1.6.0 configuration: every Markdown image becomes a link
 * before rendering (so nothing fetches what the policy refuses), a
 * same-origin one is marked and drawn after sanitising, and raw-HTML media
 * never survive the sanitiser.
 */
function candidateOptions(base: string, allowed: { href: string; alt: string; title: string }[]): Record<string, unknown> {
    const tags = (allowedMarkdownHtmlTags as readonly string[]).filter((t) => !MEDIA.has(t));
    return {
        markedExtensions: [{
            walkTokens(token: { type: string; href?: string; title?: string | null; text?: string; tokens?: unknown[] }) {
                if (token.type !== "image" || typeof token.href !== "string") {
                    return;
                }
                const text = token.text ?? "";
                let sameOrigin: string | null = null;
                try {
                    const url = new URL(token.href, base);
                    if (url.origin === new URL(base).origin && (url.protocol === "https:" || url.protocol === "http:")) {
                        sameOrigin = url.href;
                    }
                } catch {
                    sameOrigin = null;
                }
                if (/^data:image\//i.test(token.href)) {
                    sameOrigin = token.href;
                }
                token.type = "link";
                token.tokens = [{ type: "text", raw: text, text, escaped: true }];
                if (sameOrigin) {
                    allowed.push({ href: sameOrigin, alt: text, title: token.title ?? "" });
                    // A placeholder the renderer keeps: it drops a link to data:
                    // (measured in the harness, 9 Oct), and the real source is
                    // in `allowed` anyway. .invalid never resolves.
                    token.href = `https://image.invalid/${allowed.length - 1}`;
                    token.title = `${MARK}${allowed.length - 1}`;
                }
            }
        }],
        sanitizerConfig: {
            allowedTags: { override: tags }
        },
        actionHandler: (href: string) => {
            console.info("probe: link pressed", href);
        }
    };
}

function hydrate(root: HTMLElement, allowed: { href: string; alt: string; title: string }[]): number {
    let drawn = 0;
    for (const a of Array.from(root.querySelectorAll(`a[title^='${MARK}']`))) {
        const entry = allowed[Number((a.getAttribute("title") ?? "").slice(1))];
        if (!entry) {
            continue;
        }
        const img = document.createElement("img");
        img.src = entry.href;
        img.alt = entry.alt;
        if (entry.title) {
            img.title = entry.title;
        }
        a.replaceWith(img);
        drawn++;
    }
    return drawn;
}

async function markdown(): Promise<Record<string, unknown>> {
    (window as unknown as { __probeXss?: unknown }).__probeXss = undefined;
    const base = clientUrl().url ?? window.location.origin;
    const before = performance.getEntriesByType("resource").length;
    const out: Record<string, unknown> = { base };

    // A: Monaco's default, HTML on, untrusted.
    try {
        const a = renderMarkdown({ value: sample("a"), isTrusted: false, supportHtml: true }, { actionHandler: () => undefined });
        out.monacoDefault = { html: (a.element as HTMLElement).innerHTML, ...residue(a.element as HTMLElement) };
        a.dispose();
    } catch (e) {
        out.monacoDefault = { threw: message(e) };
    }

    // B: the candidate, HTML on.
    try {
        const allowed: { href: string; alt: string; title: string }[] = [];
        const b = renderMarkdown({ value: sample("b"), isTrusted: false, supportHtml: true, baseUri: undefined }, candidateOptions(base, allowed));
        const element = b.element as HTMLElement;
        const preHydrate = residue(element);
        const drawn = hydrate(element, allowed);
        out.candidate = { html: element.innerHTML, preHydrate, drawn, allowed: allowed.map((x) => x.href), after: residue(element) };
        b.dispose();
    } catch (e) {
        out.candidate = { threw: message(e) };
    }

    // C: the candidate, HTML off — the fallback if B leaves anything executable.
    try {
        const allowed: { href: string; alt: string; title: string }[] = [];
        const c = renderMarkdown({ value: sample("c"), isTrusted: false, supportHtml: false }, candidateOptions(base, allowed));
        const element = c.element as HTMLElement;
        hydrate(element, allowed);
        out.candidateNoHtml = { html: element.innerHTML, ...residue(element) };
        c.dispose();
    } catch (e) {
        out.candidateNoHtml = { threw: message(e) };
    }

    // Fetches start as an image node joins a live document, attached or not.
    await new Promise((r) => window.setTimeout(r, 3000));
    const fetched = performance.getEntriesByType("resource").slice(before).map((e) => e.name).filter((n) => /probe-|example\.com/.test(n));
    out.fetched = {
        monacoDefault: fetched.filter((n) => n.includes("probe-a-")),
        candidate: fetched.filter((n) => n.includes("probe-b-")),
        candidateNoHtml: fetched.filter((n) => n.includes("probe-c-")),
        other: fetched.filter((n) => !/probe-[abc]-/.test(n))
    };
    out.xss = (window as unknown as { __probeXss?: unknown }).__probeXss ?? null;
    return out;
}

/* ----------------------------------------- P3: what the form will load */

function loads(src: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        const img = new Image();
        const t0 = performance.now();
        const done = (ok: boolean) => resolve({ src: src.length > 80 ? `${src.slice(0, 60)}…` : src, loaded: ok, width: img.naturalWidth, ms: round(performance.now() - t0) });
        img.onload = () => done(true);
        img.onerror = () => done(false);
        window.setTimeout(() => done(false), 8000);
        img.src = src;
    });
}

async function images(extra?: string): Promise<Record<string, unknown>[]> {
    const base = clientUrl().url ?? window.location.origin;
    const candidates = [
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        `${base}/favicon.ico`,
        "/_imgs/NavBar/ActionImgs/Ribbon_Add_16.png",
        "/WebResources/cll_/probe-missing.png"
    ];
    if (extra) {
        candidates.push(extra);
    }
    return Promise.all(candidates.map(loads));
}

/* ------------------------------------------------------ P4: openUrl */

let panel: HTMLElement | undefined;

function links(): string {
    panel?.remove();
    const nav = latest?.navigation;
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#fff;border:2px solid #b4009e;padding:8px;font:12px Segoe UI,sans-serif;display:flex;flex-direction:column;gap:6px;";
    const title = document.createElement("strong");
    title.textContent = "Code Editor 1.5.9 probe — P4";
    panel.append(title);
    const targets = ["https://example.com/?probe=openUrl", "mailto:someone@example.com?subject=probe"];
    for (const url of targets) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = `openUrl(${url.split("?")[0]})`;
        b.addEventListener("click", () => {
            try {
                const result = nav?.openUrl(url);
                console.info("probe: openUrl returned", result, url);
            } catch (e) {
                console.info("probe: openUrl threw", message(e), url);
            }
        });
        panel.append(b);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "close";
    close.addEventListener("click", () => panel?.remove());
    panel.append(close);
    document.body.append(panel);
    return "Press each openUrl button once. Say what opened: a new tab, this tab, a mail client, or nothing.";
}

/* ------------------------------------------------------------------ all */

async function all(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { at: new Date().toISOString(), env: env() };
    out.diff500 = await diff(500);
    out.diff5000 = await diff(5000);
    out.diff500again = await diff(500);
    out.markdown = await markdown();
    out.images = await images();
    out.passes = passes.slice();
    return out;
}

const api = {
    version: PROBE_VERSION,
    env,
    diff,
    markdown,
    images,
    links,
    passes: () => passes.slice(),
    mark(label: string) {
        passes.push({ t: round(performance.now() - started), kind: "mark", mount: mounts, label });
        return `marked "${label}" at ${round(performance.now() - started)} ms`;
    },
    all
};
