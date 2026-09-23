// THROWAWAY — the 1.2.9 probe build. Delete this file and its import in
// index.ts before 1.3.0.
//
// It asks the form the questions 1.3.0 rests on (SPEC.md, P1–P6), from the
// browser console:
//
//     const p = window.__pcfCodeEditorProbe
//     p.env()                                  P1, P3
//     await p.webResource("new_/probe/order.schema.json")   P1
//     await p.webResource("new_/probe/missing.json")        P2
//     await p.schema()                         P5 (the schema input, validated here)
//     p.xml()                                  P6 (what Format would do)
//     p.applyXml()                             P6 (write it into the column; then save)
//     p.outputs()                              P4
//
// Nothing here is feature code; each answer goes into SPEC.md verbatim.

import { compileSchema, resolveSchemaSource } from "./schema";
import { formatXml, readXml, XmlNode } from "./formatXml";
import { IInputs } from "./generated/ManifestTypes";

interface Editor {
    getValue(): string;
    setValue(text: string): void;
}

interface Probe {
    env(): unknown;
    webResource(name: string): Promise<unknown>;
    schema(): Promise<unknown>;
    xml(): unknown;
    applyXml(): unknown;
    outputs(): unknown;
}

let current: { context: ComponentFramework.Context<IInputs>; editor: Editor; outputs: () => unknown } | undefined;

export function park(context: ComponentFramework.Context<IInputs>, editor: Editor, outputs: () => unknown): void {
    // A getter each time: a context kept from the first pass is a dead snapshot.
    current = { context, editor, outputs };
    (window as unknown as { __pcfCodeEditorProbe: Probe }).__pcfCodeEditorProbe = probe;
}

function clientUrl(): string | null {
    const page = (current?.context as unknown as { page?: { getClientUrl?: () => string } }).page;
    return typeof page?.getClientUrl === "function" ? page.getClientUrl() : null;
}

async function ask(url: string): Promise<unknown> {
    const started = performance.now();
    try {
        const response = await fetch(url, { credentials: "same-origin" });
        const body = await response.text();
        return {
            url,
            status: response.status,
            ok: response.ok,
            redirected: response.redirected,
            finalUrl: response.url,
            contentType: response.headers.get("content-type"),
            cacheControl: response.headers.get("cache-control"),
            length: body.length,
            head: body.slice(0, 160),
            ms: Math.round(performance.now() - started)
        };
    } catch (error) {
        return { url, threw: String(error), name: (error as Error)?.name };
    }
}

function shape(nodes: XmlNode[] | null): string | null {
    const walk = (list: XmlNode[]): unknown[] => list
        .filter((n) => !(n.type === "text" && n.raw.trim() === ""))
        .map((n) => (n.type === "element" ? { e: n.open, c: walk(n.children), x: n.close } : { [n.type]: n.raw }));
    return nodes ? JSON.stringify(walk(nodes)) : null;
}

const probe: Probe = {
    env() {
        const context = current?.context;
        const raw = context?.parameters.schema?.raw ?? null;
        return {
            pageType: typeof (context as unknown as { page?: unknown })?.page,
            getClientUrl: typeof (context as unknown as { page?: { getClientUrl?: unknown } })?.page?.getClientUrl,
            clientUrl: clientUrl(),
            origin: location.origin,
            pathname: location.pathname,
            schemaRawLength: raw === null ? null : raw.length,
            schemaRawHead: raw === null ? null : raw.slice(0, 80),
            schemaRawTail: raw === null ? null : raw.slice(-40),
            schemaSource: resolveSchemaSource(raw).kind,
            formFactor: context?.client.getFormFactor(),
            client: context?.client.getClient()
        };
    },

    async webResource(name: string) {
        const base = clientUrl();
        return {
            viaClientUrl: base ? await ask(`${base}/WebResources/${name}`) : "no getClientUrl",
            rootRelative: await ask(`/WebResources/${name}`)
        };
    },

    async schema() {
        const raw = current?.context.parameters.schema?.raw ?? null;
        const source = resolveSchemaSource(raw);
        let text: string | null = null;
        if (source.kind === "inline") {
            text = source.text;
        } else if (source.kind === "webResource") {
            const base = clientUrl() ?? "";
            const response = await fetch(`${base}/WebResources/${source.name}`, { credentials: "same-origin" });
            text = response.ok ? await response.text() : null;
            if (!response.ok) {
                return { source, status: response.status };
            }
        } else {
            return { source };
        }
        const started = performance.now();
        const compiled = compileSchema(text ?? "");
        if (!compiled.ok) {
            return { source, compiled };
        }
        const problems = compiled.validate(current?.editor.getValue() ?? "");
        return { source, ms: Math.round(performance.now() - started), problems };
    },

    xml() {
        const text = current?.editor.getValue() ?? "";
        const formatted = formatXml(text, { tabSize: 4, insertSpaces: true });
        return {
            formattable: formatted !== null,
            changed: formatted !== null && formatted !== text,
            sameTree: formatted !== null && shape(readXml(formatted)) === shape(readXml(text)),
            browserParses: formatted !== null && new DOMParser().parseFromString(formatted, "application/xml").getElementsByTagName("parsererror").length === 0,
            preview: formatted?.slice(0, 400)
        };
    },

    applyXml() {
        const text = current?.editor.getValue() ?? "";
        const formatted = formatXml(text, { tabSize: 4, insertSpaces: true });
        if (formatted === null) {
            return "not formattable";
        }
        current?.editor.setValue(formatted);
        return "written into the editor; save the form, reload, then run p.xml() again";
    },

    outputs() {
        return current?.outputs();
    }
};
