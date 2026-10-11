// THROWAWAY — the 1.6.9 probe build. Delete this file and its import in
// index.ts before 1.7.0.
//
// It asks the form the questions 1.7.0's JSON tree rests on (SPEC.md, the
// 1.6.9 probe): how long a large document takes to parse and draw as rows
// (P1), which keys reach a focused element inside the control and whether the
// form acts on them too (P2), and which way of writing to the clipboard works
// (P3). It changes nothing on the record. From the browser console:
//
//     const p = window.__pcfCodeEditorProbe
//     p.env()                    the host
//     p.size()                   P1: a ~1 MB document parsed, walked and drawn
//     p.keys()                   P2 + P3: a bar in the control — click its box,
//                                press the keys it lists, press each copy button
//     p.keysResult()             P2 + P3: what each press and each copy did
//     copy(p.all())              everything above, onto the clipboard
//
// Each answer goes into SPEC.md verbatim, and a wrong one removes the feature
// it names.

import { IInputs } from "./generated/ManifestTypes";
import { Node, ParseError, parseTree } from "jsonc-parser";

type Context = ComponentFramework.Context<IInputs>;

const PROBE_VERSION = "1.6.9";

let latest: Context | undefined;
let host: HTMLElement | undefined;
let installed = false;
let mounts = 0;
const started = performance.now();

function now(): number {
    return Math.round((performance.now() - started) * 10) / 10;
}

function round(ms: number): number {
    return Math.round(ms * 10) / 10;
}

function message(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Called from init (with the container), every updateView and destroy. */
export function see(context: Context | undefined, kind: "init" | "update" | "destroy", container?: HTMLElement): void {
    if (kind === "init") {
        mounts++;
        host = container;
    }
    if (context) {
        latest = context;
    }
    if (!installed) {
        installed = true;
        (window as unknown as { __pcfCodeEditorProbe?: unknown }).__pcfCodeEditorProbe = api;
        console.info(`Code Editor ${PROBE_VERSION} probe: window.__pcfCodeEditorProbe — see SPEC.md, the 1.6.9 probe`);
    }
}

/** A short description of a node, for a log a person reads. */
function describe(node: EventTarget | null): string {
    if (!node) {
        return "null";
    }
    if (node === window) {
        return "window";
    }
    if (node === document) {
        return "document";
    }
    const el = node as Element;
    if (!el.tagName) {
        return String(node);
    }
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const role = el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}${role}`;
}

function env(): Record<string, unknown> {
    const featurePolicy = (document as unknown as { featurePolicy?: { allowsFeature?: (f: string) => boolean } }).featurePolicy;
    return {
        probe: PROBE_VERSION,
        origin: window.location.origin,
        framed: window !== window.top,
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        languageId: latest?.userSettings?.languageId,
        client: latest?.client?.getClient?.(),
        formFactor: latest?.client?.getFormFactor?.(),
        disabled: latest?.mode.isControlDisabled,
        mounts,
        clipboardApi: typeof navigator.clipboard?.writeText === "function",
        clipboardWritePolicy: featurePolicy?.allowsFeature ? featurePolicy.allowsFeature("clipboard-write") : "no featurePolicy",
        execCommandCopySupported: typeof document.queryCommandSupported === "function" ? document.queryCommandSupported("copy") : "no queryCommandSupported",
        secureContext: window.isSecureContext
    };
}

/* ---------------------------------------------------------- P1: size */

/** A JSON document of at least `bytes` characters, indented as Format leaves one. */
function sample(bytes: number): string {
    const items: unknown[] = [];
    const doc = { meta: { source: "probe", version: PROBE_VERSION, generated: new Date(0).toISOString() }, items };
    let i = 0;
    let length = 0;
    while (length < bytes) {
        const batch: unknown[] = [];
        for (let k = 0; k < 50; k++, i++) {
            batch.push({
                id: i,
                name: `Item ${i}`,
                active: i % 3 !== 0,
                score: (i * 7) % 100,
                tags: ["alpha", "beta", `t${i % 7}`],
                address: { street: `${i} Main St`, city: "Springfield", geo: { lat: 39.78 + i / 1e5, lng: -89.65 } },
                notes: i % 5 === 0 ? null : `A note about item ${i} that is long enough to be truncated in a row.`
            });
        }
        items.push(...batch);
        length += JSON.stringify(batch, null, 2).length;
    }
    return JSON.stringify(doc, null, 2);
}

interface ProbeRow {
    level: number;
    key: string;
    preview: string;
    parent: boolean;
}

/** Every node as a row, as an expand-all would show it. */
function rowsOf(root: Node): ProbeRow[] {
    const rows: ProbeRow[] = [];
    const walk = (node: Node, level: number, key: string): void => {
        const parent = node.type === "object" || node.type === "array";
        const count = node.children?.length ?? 0;
        const preview = parent
            ? (node.type === "object" ? `{${count}}` : `[${count}]`)
            : node.type === "string"
                ? JSON.stringify(String(node.value).slice(0, 80))
                : String(node.value);
        rows.push({ level, key, preview, parent });
        if (node.type === "object") {
            for (const property of node.children ?? []) {
                const [k, v] = property.children ?? [];
                if (k && v) {
                    walk(v, level + 1, String(k.value));
                }
            }
        } else if (node.type === "array") {
            (node.children ?? []).forEach((child, index) => walk(child, level + 1, String(index)));
        }
    };
    walk(root, 1, "$");
    return rows;
}

/** Draw `rows` as the 1.7.0 tree would, off-screen, and read layout back. */
function draw(rows: ProbeRow[]): number {
    const box = document.createElement("div");
    box.setAttribute("role", "tree");
    box.style.cssText = "position:fixed;left:-30000px;top:0;width:640px;font:12px Consolas,monospace;line-height:22px;";
    const t0 = performance.now();
    const fragment = document.createDocumentFragment();
    rows.forEach((row, index) => {
        const item = document.createElement("div");
        item.setAttribute("role", "treeitem");
        item.id = `probe-row-${index}`;
        item.setAttribute("aria-level", String(row.level));
        if (row.parent) {
            item.setAttribute("aria-expanded", "true");
        }
        item.style.paddingLeft = `${row.level * 16}px`;
        item.style.height = "22px";
        item.style.whiteSpace = "nowrap";
        item.style.overflow = "hidden";
        const chevron = document.createElement("span");
        chevron.textContent = row.parent ? "▾" : " ";
        const key = document.createElement("span");
        key.textContent = `${row.key}: `;
        const value = document.createElement("span");
        value.textContent = row.preview;
        item.append(chevron, key, value);
        fragment.append(item);
    });
    box.append(fragment);
    document.body.append(box);
    void box.offsetHeight; // force layout
    void box.lastElementChild?.getBoundingClientRect();
    const ms = performance.now() - t0;
    box.remove();
    return round(ms);
}

let lastSize: Record<string, unknown> | undefined;

function size(bytes = 1_000_000): Record<string, unknown> {
    const t0 = performance.now();
    const text = sample(bytes);
    const t1 = performance.now();
    const errors: ParseError[] = [];
    const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
    const t2 = performance.now();
    const rows = root ? rowsOf(root) : [];
    const t3 = performance.now();
    const dom: Record<string, number> = {};
    for (const n of [500, 2000, 10000]) {
        dom[String(n)] = draw(rows.slice(0, n));
    }
    // Every row, as an expand-all would draw it — capped so a slow host cannot hang the form.
    const all = Math.min(rows.length, 60000);
    dom[`all (${all})`] = draw(rows.slice(0, all));
    lastSize = {
        chars: text.length,
        generateMs: round(t1 - t0),
        parseTreeMs: round(t2 - t1),
        parseErrors: errors.length,
        rows: rows.length,
        walkMs: round(t3 - t2),
        drawMs: dom,
        maxLevel: rows.reduce((m, r) => Math.max(m, r.level), 0)
    };
    return lastSize;
}

/* ------------------------------------------- P2 + P3: keys and copying */

interface KeyEntry {
    seq: number;
    t: number;
    key: string;
    code: string;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    alt: boolean;
    target: string;
    atWindowCapture: boolean;
    atElement: boolean;
    preventedOnArrival?: boolean;
    atWindowBubble: boolean;
    preventedAtEnd?: boolean;
    keyupAtElement?: boolean;
    focusAfter?: string;
}

interface CopyEntry {
    t: number;
    how: string;
    text: string;
    ok: boolean;
    detail?: string;
    ms: number;
}

const entries: KeyEntry[] = [];
const scrolls: { t: number; target: string; top: number; left: number }[] = [];
const focusLost: { t: number; to: string }[] = [];
const copies: CopyEntry[] = [];
let bar: HTMLDivElement | undefined;
let tree: HTMLDivElement | undefined;
let detach: (() => void) | undefined;
let seq = 0;

/** The keys 1.7.0's tree would claim; the probe prevents their default as the tree would. */
const TREE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " ", "*"]);

async function copyWithApi(text: string): Promise<CopyEntry> {
    const t0 = performance.now();
    try {
        await navigator.clipboard.writeText(text);
        return { t: now(), how: "navigator.clipboard.writeText", text, ok: true, ms: round(performance.now() - t0) };
    } catch (error) {
        return { t: now(), how: "navigator.clipboard.writeText", text, ok: false, detail: message(error), ms: round(performance.now() - t0) };
    }
}

function copyWithExec(text: string): CopyEntry {
    const t0 = performance.now();
    const back = document.activeElement as HTMLElement | null;
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.append(scratch);
    scratch.select();
    let ok = false;
    let detail: string | undefined;
    try {
        ok = document.execCommand("copy");
    } catch (error) {
        detail = message(error);
    }
    scratch.remove();
    back?.focus();
    return { t: now(), how: "document.execCommand('copy')", text, ok, detail, ms: round(performance.now() - t0) };
}

async function copyAsShipped(text: string): Promise<CopyEntry> {
    const first = await copyWithApi(text);
    if (first.ok) {
        return { ...first, how: "as 1.7.0 would: the API" };
    }
    const second = copyWithExec(text);
    return { ...second, how: "as 1.7.0 would: the API refused, execCommand", detail: `API: ${first.detail}; exec: ${second.detail ?? (second.ok ? "ok" : "returned false")}` };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = "margin-left:6px;font:12px sans-serif;";
    b.addEventListener("click", onClick);
    return b;
}

function keys(prevent = true): string {
    if (bar) {
        return "already mounted — p.keysResult() reads it, p.keysDone() removes it";
    }
    const where = host ?? document.body;
    bar = document.createElement("div");
    bar.style.cssText = "position:relative;z-index:10;background:#fff3cd;border:1px solid #d39e00;padding:4px;font:12px sans-serif;";
    tree = document.createElement("div");
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "Probe tree");
    tree.tabIndex = 0;
    tree.id = "pcf-code-editor-probe-tree";
    tree.textContent = "1.6.9 probe: click here, then press ↑ ↓ ← → Home End Enter Space * a Ctrl+C F2 Escape";
    tree.style.cssText = "display:inline-block;padding:4px 6px;border:1px dashed #555;background:#fff;";
    const stamp = (): string => new Date().toISOString().slice(11, 19);
    bar.append(
        tree,
        button("Copy (API)", () => { void copyWithApi(`probe-api-${stamp()}`).then((r) => copies.push(r)); }),
        button("Copy (execCommand)", () => { copies.push(copyWithExec(`probe-exec-${stamp()}`)); }),
        button("Copy as 1.7.0 would", () => { void copyAsShipped(`probe-shipped-${stamp()}`).then((r) => copies.push(r)); }),
        button("Done", () => keysDone())
    );
    where.prepend(bar);

    const onCapture = (e: KeyboardEvent): void => {
        if (!tree || (e.target !== tree && !tree.contains(e.target as globalThis.Node))) {
            return;
        }
        entries.push({
            seq: ++seq, t: now(), key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey,
            target: describe(e.target), atWindowCapture: true, atElement: false, atWindowBubble: false
        });
    };
    const onElement = (e: KeyboardEvent): void => {
        const entry = [...entries].reverse().find((x) => x.key === e.key && !x.atElement);
        if (entry) {
            entry.atElement = true;
            entry.preventedOnArrival = e.defaultPrevented;
        } else {
            entries.push({
                seq: ++seq, t: now(), key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey,
                target: describe(e.target), atWindowCapture: false, atElement: true, preventedOnArrival: e.defaultPrevented, atWindowBubble: false
            });
        }
        if (prevent && TREE_KEYS.has(e.key)) {
            e.preventDefault();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
            void copyAsShipped(`probe-ctrl-c-${stamp()}`).then((r) => copies.push({ ...r, how: `Ctrl+C in the keydown — ${r.how}` }));
            e.preventDefault();
        }
        window.setTimeout(() => {
            const last = entries.find((x) => x.seq === (entry?.seq ?? seq));
            if (last) {
                last.focusAfter = describe(document.activeElement);
            }
        }, 150);
    };
    const onBubble = (e: KeyboardEvent): void => {
        if (!tree || (e.target !== tree && !tree.contains(e.target as globalThis.Node))) {
            return;
        }
        const entry = [...entries].reverse().find((x) => x.key === e.key && !x.atWindowBubble);
        if (entry) {
            entry.atWindowBubble = true;
            entry.preventedAtEnd = e.defaultPrevented;
        }
    };
    const onKeyup = (e: KeyboardEvent): void => {
        const entry = [...entries].reverse().find((x) => x.key === e.key && x.keyupAtElement === undefined);
        if (entry) {
            entry.keyupAtElement = true;
        }
    };
    const onScroll = (e: Event): void => {
        const target = e.target === document ? document.scrollingElement : (e.target as Element);
        scrolls.push({ t: now(), target: describe(e.target), top: (target as Element)?.scrollTop ?? -1, left: (target as Element)?.scrollLeft ?? -1 });
    };
    const onFocusOut = (e: FocusEvent): void => {
        focusLost.push({ t: now(), to: describe(e.relatedTarget) });
    };

    window.addEventListener("keydown", onCapture, true);
    tree.addEventListener("keydown", onElement);
    window.addEventListener("keydown", onBubble, false);
    tree.addEventListener("keyup", onKeyup);
    document.addEventListener("scroll", onScroll, true);
    tree.addEventListener("focusout", onFocusOut);
    detach = () => {
        window.removeEventListener("keydown", onCapture, true);
        window.removeEventListener("keydown", onBubble, false);
        document.removeEventListener("scroll", onScroll, true);
    };
    return "mounted at the top of the control: click its dashed box, press the keys, press each copy button and paste (Ctrl+V) somewhere to see what landed";
}

function keysDone(): string {
    detach?.();
    detach = undefined;
    bar?.remove();
    bar = undefined;
    tree = undefined;
    return "removed";
}

function keysResult(): Record<string, unknown> {
    return { prevent: true, entries, scrolls, focusLost, copies };
}

function all(): string {
    return JSON.stringify({ env: env(), size: lastSize ?? size(), keys: keysResult() }, null, 2);
}

const api = { env, size, keys, keysResult, keysDone, all };
