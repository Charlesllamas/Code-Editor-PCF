// THROWAWAY — the 1.3.9 probe build. Delete this file and its import in
// index.ts before 1.4.0.
//
// It asks the form the questions 1.4.0 rests on (SPEC.md, P1–P6). The
// suggest and snippet contributions are in this build (monacoFeatures.ts,
// where 1.4.0 keeps them), and a static
// completion provider and a markdown hover provider are registered for JSON
// — the same wiring 1.4.0 will use, with fixed answers instead of a schema.
// From the browser console:
//
//     const p = window.__pcfCodeEditorProbe
//     p.env()                    what the page is: CSP, Trusted Types, instances
//     await p.suggest()          P1: open the list, measure it against its ancestors
//     await p.hover()            P1, P2: open a hover, measure it, read what rendered
//     p.overflow("fixed")        P1: then reload the form, and suggest/hover again
//     p.overflow("body")         P1: the same with the widgets outside the control
//     p.overflow("none")         …and back
//     p.keys()                   P3: the last keys that reached Monaco
//     p.console()                P2, P4: violations, warnings, getWorker calls
//     await p.each()             P5: every instance's own list
//
// Typing `"` or `:` in a JSON editor opens the list the way 1.4.0 will; the
// items name the instance they came from, which is what P5 reads.
//
// Nothing here is feature code; each answer goes into SPEC.md verbatim.

// The suggest and snippet contributions are in monacoFeatures.ts: imported
// here, after monacoSetup.ts's first API call, they are inert.
import monaco from "./monacoSetup";

type Editor = monaco.editor.IStandaloneCodeEditor;

interface Instance {
    index: number;
    editor: Editor;
    host: HTMLElement;
    schemaInput: () => string | null;
}

const instances = new Map<string, Instance>();
const keys: unknown[] = [];
const violations: unknown[] = [];
const counts = { warn: 0, error: 0, workerWarning: 0, getWorker: 0 };

/* ------------------------------------------------------------ passive */

let installed = false;

function install(): void {
    if (installed) {
        return;
    }
    installed = true;

    document.addEventListener("securitypolicyviolation", (e) => {
        violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample, source: e.sourceFile, line: e.lineNumber });
    });

    // Counted and passed through: P4 wants to know whether the suggest
    // contribution asks for a worker a second time.
    const warn = console.warn.bind(console);
    const error = console.error.bind(console);
    console.warn = (...args: unknown[]) => {
        counts.warn++;
        if (args.some((a) => String(a).includes("without web workers"))) {
            counts.workerWarning++;
        }
        warn(...args);
    };
    console.error = (...args: unknown[]) => {
        counts.error++;
        error(...args);
    };

    const env = (globalThis as { MonacoEnvironment?: { getWorker?: (...a: unknown[]) => unknown } }).MonacoEnvironment;
    const original = env?.getWorker;
    if (env && original) {
        env.getWorker = (...a: unknown[]) => {
            counts.getWorker++;
            return original.apply(env, a);
        };
    }

    monaco.languages.registerCompletionItemProvider("json", {
        triggerCharacters: ["\"", ":"],
        provideCompletionItems(model, position) {
            const owner = instances.get(model.uri.toString());
            const who = owner ? `instance ${owner.index}` : "no instance";
            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
            const doc = (text: string) => ({ value: `**${who}** — ${text}\n\n\`schema\`: ${owner?.schemaInput()?.slice(0, 40) ?? "(none)"}` });
            return {
                suggestions: [
                    { label: `probeId (${who})`, kind: monaco.languages.CompletionItemKind.Property, insertText: "\"probeId\": ", range, detail: "string · required", documentation: doc("a *required* key"), sortText: "0" },
                    { label: "probeName", kind: monaco.languages.CompletionItemKind.Property, insertText: "\"probeName\": ", range, detail: "string", documentation: doc("a plain key"), sortText: "1" },
                    { label: "probeStatus", kind: monaco.languages.CompletionItemKind.Property, insertText: "\"probeStatus\": \"${1|draft,active,closed|}\"", insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: "enum · snippet", documentation: doc("a snippet with a choice"), sortText: "2" },
                    { label: "probeOld", kind: monaco.languages.CompletionItemKind.Property, insertText: "\"probeOld\": ", range, detail: "deprecated", tags: [monaco.languages.CompletionItemTag.Deprecated], documentation: doc("a deprecated key"), sortText: "3" },
                    { label: "\"active\"", kind: monaco.languages.CompletionItemKind.Value, insertText: "\"active\"", range, detail: "value", documentation: doc("a value, with a `code span` and a [link](https://pcfhub.dev)"), sortText: "4" }
                ]
            };
        }
    });

    monaco.languages.registerHoverProvider("json", {
        provideHover(model, position) {
            const owner = instances.get(model.uri.toString());
            const word = model.getWordAtPosition(position);
            if (!word) {
                return null;
            }
            return {
                range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                contents: [
                    { value: `**probe hover** · instance ${owner?.index ?? "?"}` },
                    { value: "Markdown: *emphasis*, `code`, a list:\n\n- one\n- two\n\n```json\n{ \"a\": 1 }\n```" },
                    { value: "<b>raw html</b> should show as text", supportHtml: false }
                ]
            };
        }
    });
}

/* ------------------------------------------------------ overflow mode */

// P1. Monaco reads fixedOverflowWidgets and overflowWidgetsDomNode when the
// editor is created, and ignores updateOptions for both (measured in the
// harness, 2026-09-26) — so the mode is chosen before the form loads:
//
//     localStorage.setItem("pcfCodeEditorProbe.overflow", "fixed")   // or "body", or remove it
//     location.reload()

type OverflowMode = "none" | "fixed" | "body";

const bodyNodes = new Map<Editor, HTMLElement>();

function overflowMode(): OverflowMode {
    try {
        const v = window.localStorage.getItem("pcfCodeEditorProbe.overflow");
        return v === "fixed" || v === "body" ? v : "none";
    } catch {
        return "none";
    }
}

/** Options for monaco.editor.create, per the stored mode. */
export function createOptions(): monaco.editor.IStandaloneEditorConstructionOptions & { __body?: HTMLElement } {
    const mode = overflowMode();
    if (mode === "fixed") {
        return { fixedOverflowWidgets: true };
    }
    if (mode === "body") {
        // Monaco's stylesheet is scoped under .monaco-editor, so the node
        // outside the editor has to carry the class to be styled at all.
        const node = document.createElement("div");
        node.className = "monaco-editor pcf-code-editor-probe-overflow";
        document.body.appendChild(node);
        return { overflowWidgetsDomNode: node, fixedOverflowWidgets: true, __body: node };
    }
    return {};
}

/* ------------------------------------------------------------ parking */

export function park(editor: Editor, host: HTMLElement, schemaInput: () => string | null, bodyNode?: HTMLElement): void {
    install();
    const model = editor.getModel();
    if (!model) {
        return;
    }
    if (bodyNode) {
        bodyNodes.set(editor, bodyNode);
    }
    instances.set(model.uri.toString(), { index: instances.size + 1, editor, host, schemaInput });

    // The options 1.4.0 means to ship; P1 toggles fixedOverflowWidgets.
    editor.updateOptions({
        wordBasedSuggestions: "off",
        quickSuggestions: { strings: true, other: true, comments: false },
        acceptSuggestionOnEnter: "smart",
        suggest: { showWords: false }
    });

    editor.onKeyDown((e) => {
        keys.push({ at: Math.round(performance.now()), code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, instance: instances.get(model.uri.toString())?.index });
        if (keys.length > 20) {
            keys.shift();
        }
    });

    (window as unknown as { __pcfCodeEditorProbe: typeof probe }).__pcfCodeEditorProbe = probe;
}

export function unpark(editor: Editor): void {
    const model = editor.getModel();
    if (model) {
        instances.delete(model.uri.toString());
    }
    bodyNodes.get(editor)?.remove();
    bodyNodes.delete(editor);
}

/* ------------------------------------------------------------ measure */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function rect(el: Element | null): unknown {
    if (!el) {
        return null;
    }
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
}

function describe(el: Element): string {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
}

/**
 * Every ancestor that clips (overflow other than visible) and whether the
 * widget's box escapes it — the answer to "is the list shown whole".
 */
function clipping(widget: Element): unknown[] {
    const box = widget.getBoundingClientRect();
    const found: unknown[] = [];
    // A fixed box escapes every overflow clip above it until an ancestor that
    // is its containing block — a transform, a filter, contain: paint/layout.
    let escaped = getComputedStyle(widget).position === "fixed";
    for (let el = widget.parentElement; el; el = el.parentElement) {
        const style = getComputedStyle(el);
        const contains = style.contain;
        const transformed = style.transform !== "none";
        const capturesFixed = transformed || style.filter !== "none" || /paint|layout|strict|content/.test(contains);
        if (escaped && capturesFixed) {
            escaped = false;
        }
        const clips = !escaped && [style.overflowX, style.overflowY].some((o) => o !== "visible");
        if (style.position === "fixed") {
            escaped = true;
        }
        if (!clips && !transformed && (contains === "none" || contains === "")) {
            continue;
        }
        const r = el.getBoundingClientRect();
        found.push({
            el: describe(el),
            overflow: `${style.overflowX}/${style.overflowY}`,
            transform: transformed ? style.transform : undefined,
            contain: contains !== "none" ? contains : undefined,
            cutTop: Math.max(0, Math.round(r.top - box.top)),
            cutBottom: Math.max(0, Math.round(box.bottom - r.bottom)),
            cutLeft: Math.max(0, Math.round(r.left - box.left)),
            cutRight: Math.max(0, Math.round(box.right - r.right))
        });
    }
    return found;
}

/**
 * What is actually drawn at the widget's corners and centre: whether the top
 * element there belongs to the widget. Geometry says where a box is; this
 * says whether anyone can see it.
 */
function seen(widget: Element): unknown {
    const r = widget.getBoundingClientRect();
    const at = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
            return "offscreen";
        }
        const top = document.elementFromPoint(x, y);
        return top ? widget.contains(top) : false;
    };
    return {
        topLeft: at(r.left + 4, r.top + 4),
        topRight: at(r.right - 4, r.top + 4),
        centre: at(r.left + r.width / 2, r.top + r.height / 2),
        bottomLeft: at(r.left + 4, r.bottom - 4),
        bottomRight: at(r.right - 4, r.bottom - 4)
    };
}

function first(): Instance | undefined {
    return instances.values().next().value;
}

async function suggestOn(instance: Instance): Promise<unknown> {
    // A caret the user could have put there: the end of line 2, or line 1.
    // Triggered with the caret wherever the last scripted step left it, the
    // widget was marked visible and never positioned (harness, 2026-09-26).
    const model = instance.editor.getModel();
    const line = model && model.getLineCount() > 1 ? 2 : 1;
    instance.editor.focus();
    instance.editor.setPosition({ lineNumber: line, column: model ? model.getLineMaxColumn(line) : 1 });
    instance.editor.revealLine(line);
    instance.editor.trigger("probe", "editor.action.triggerSuggest", {});
    // The list lays itself out after it becomes visible; measured at 400 ms
    // the hit test missed a list that was plainly on screen.
    await wait(800);
    const widget = instance.host.ownerDocument.querySelector(".suggest-widget.visible") as HTMLElement | null;
    const labels = widget ? Array.from(widget.querySelectorAll(".monaco-list-row .label-name")).map((n) => n.textContent) : [];
    return {
        instance: instance.index,
        visible: !!widget,
        position: widget ? getComputedStyle(widget).position : null,
        insideHost: widget ? instance.host.contains(widget) : null,
        widget: rect(widget),
        editor: rect(instance.host),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        clippedBy: widget ? clipping(widget) : [],
        seen: widget ? seen(widget) : null,
        labels
    };
}

const probe = {
    env() {
        const tt = (window as unknown as { trustedTypes?: { getPolicyNames?: () => string[] } }).trustedTypes;
        const meta = Array.from(document.querySelectorAll("meta[http-equiv='Content-Security-Policy']")).map((m) => m.getAttribute("content"));
        return {
            monaco: "0.56.0",
            overflowMode: overflowMode(),
            trustedTypes: !!tt,
            ttPolicies: tt?.getPolicyNames?.() ?? null,
            cspMeta: meta,
            instances: Array.from(instances.values()).map((i) => ({ index: i.index, schema: i.schemaInput()?.slice(0, 60) ?? null, rect: rect(i.host) })),
            options: (() => {
                const e = first()?.editor;
                if (!e) {
                    return null;
                }
                const o = monaco.editor.EditorOption;
                return {
                    // wordBasedSuggestions is set in park(); it has no EditorOption id to read back.
                    quickSuggestions: e.getOption(o.quickSuggestions),
                    acceptSuggestionOnEnter: e.getOption(o.acceptSuggestionOnEnter),
                    fixedOverflowWidgets: e.getOption(o.fixedOverflowWidgets)
                };
            })()
        };
    },

    /** P1: open the list on the first instance (or the one given) and measure it. */
    async suggest(index?: number) {
        const instance = index ? Array.from(instances.values()).find((i) => i.index === index) : first();
        return instance ? suggestOn(instance) : "no instance";
    },

    /** P1: the overflow mode for the next load — "none", "fixed" or "body". Reload after. */
    overflow(mode?: OverflowMode) {
        if (mode) {
            try {
                if (mode === "none") {
                    window.localStorage.removeItem("pcfCodeEditorProbe.overflow");
                } else {
                    window.localStorage.setItem("pcfCodeEditorProbe.overflow", mode);
                }
            } catch (error) {
                return { stored: false, error: String(error) };
            }
            return { stored: mode, now: "reload the form" };
        }
        return { current: overflowMode(), bodyNodes: bodyNodes.size };
    },

    /** P2: a hover on the first word of line 1, and what rendered. */
    async hover(index?: number) {
        const instance = index ? Array.from(instances.values()).find((i) => i.index === index) : first();
        if (!instance) {
            return "no instance";
        }
        const model = instance.editor.getModel();
        const line = model ? Math.max(1, model.getLineCount() > 1 ? 2 : 1) : 1;
        const content = model?.getLineContent(line) ?? "";
        const column = Math.max(1, content.search(/\w/) + 2);
        instance.editor.focus();
        instance.editor.setPosition({ lineNumber: line, column });
        instance.editor.trigger("probe", "editor.action.showHover", {});
        await wait(500);
        const hover = instance.host.ownerDocument.querySelector(".monaco-hover:not(.hidden)") as HTMLElement | null;
        return {
            at: { line, column },
            visible: !!hover,
            html: hover ? hover.innerHTML.slice(0, 600) : null,
            text: hover ? hover.textContent?.slice(0, 300) : null,
            hasEm: !!hover?.querySelector("em"),
            hasCode: !!hover?.querySelector("code"),
            hasList: !!hover?.querySelector("li"),
            rawHtmlAsText: !!hover?.textContent?.includes("<b>raw html</b>"),
            widget: rect(hover),
            clippedBy: hover ? clipping(hover) : [],
            seen: hover ? seen(hover) : null,
            violations: violations.slice()
        };
    },

    /** P3: the last keys Monaco saw — Ctrl+Space, Escape, Enter, Tab. */
    keys() {
        return keys.slice();
    },

    /** P2, P4: CSP violations, console counts, and getWorker calls. */
    console() {
        return { ...counts, violations: violations.slice() };
    },

    /** P5: every instance's own list, in turn. */
    async each() {
        const out: unknown[] = [];
        for (const instance of instances.values()) {
            const answer = (await suggestOn(instance)) as { labels: string[] };
            out.push({ instance: instance.index, schema: instance.schemaInput()?.slice(0, 40) ?? null, first: answer.labels[0] ?? null, count: answer.labels.length });
            instance.editor.trigger("probe", "hideSuggestWidget", {});
            await wait(150);
        }
        return out;
    }
};
