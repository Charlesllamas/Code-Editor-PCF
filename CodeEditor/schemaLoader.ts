// Reading a schema out of a web resource, same-origin, with every failure
// named.
//
// Measured on a model-driven form (SPEC.md, P1–P2b, 2026-09-23):
//
//   - `<clientUrl>/WebResources/<name>` answers 200 with the file from a
//     standard field control that declares no feature. `context.page
//     .getClientUrl()` is there; a root-relative path works as well.
//   - Dataverse has no JSON web resource type, so a schema is a Script
//     (JScript) resource and arrives as `text/jscript`. The body is read as
//     JSON whatever the header says.
//   - A missing name is a 404 with an **empty** body: the status is all
//     there is to go on.
//   - An edit reaches nobody until it is published, but the response says
//     `cache-control: private`, which lets the browser keep an old copy —
//     so every load revalidates (`cache: "no-cache"`).
//
// Takes `fetch` as an argument and imports nothing of Monaco or the DOM:
// `dev/smoke.js` drives it with a stub.

import { compileSchema } from "./schema";
import { Problem } from "./validate";

export type SchemaLoad =
    | { state: "ready"; validate: (text: string) => Problem[]; schema: unknown }
    | { state: "notFound" }
    | { state: "denied"; status: number }
    | { state: "failed"; status: number }
    | { state: "offline" }
    | { state: "notJson" }
    | { state: "invalidSchema"; message: string };

export type Fetch = (url: string, init: { credentials: "same-origin"; cache: "no-cache" }) => Promise<{
    status: number;
    ok: boolean;
    text(): Promise<string>;
}>;

/** The address of a web resource, from the client URL when the host has one. */
export function webResourceUrl(name: string, clientUrl: string | null | undefined): string {
    const base = (clientUrl ?? "").replace(/\/+$/, "");
    const path = name.split("/").map(encodeURIComponent).join("/");
    return `${base}/WebResources/${path}`;
}

/**
 * Fetch and compile one web resource. Never rejects: a schema that cannot be
 * had is a state the strip names, and syntax checking carries on without it.
 */
export async function loadWebResourceSchema(name: string, clientUrl: string | null | undefined, fetchFn: Fetch): Promise<SchemaLoad> {
    let response: Awaited<ReturnType<Fetch>>;
    try {
        response = await fetchFn(webResourceUrl(name, clientUrl), { credentials: "same-origin", cache: "no-cache" });
    } catch {
        // A rejected fetch is the network: offline, or the request blocked.
        return { state: "offline" };
    }

    if (response.status === 404) {
        return { state: "notFound" };
    }
    if (response.status === 401 || response.status === 403) {
        return { state: "denied", status: response.status };
    }
    if (!response.ok) {
        return { state: "failed", status: response.status };
    }

    let text: string;
    try {
        text = await response.text();
    } catch {
        return { state: "offline" };
    }

    return fromText(text);
}

/** Compile a schema's text into a load result — the inline route shares it. */
export function fromText(text: string): SchemaLoad {
    const compiled = compileSchema(text);
    if (compiled.ok) {
        return { state: "ready", validate: compiled.validate, schema: compiled.schema };
    }
    return compiled.fault === "notJson" ? { state: "notJson" } : { state: "invalidSchema", message: compiled.message };
}

/* ---------------------------------------------------------------- status */

/** Where the schema stands: none asked for, on its way, or had (or not). */
export type SchemaStatus =
    | { kind: "none" }
    | { kind: "unsupported" }
    | { kind: "loading"; name: string }
    | { kind: "loaded"; name: string | null; load: SchemaLoad };

/**
 * What the strip says about the schema: a resource key and its arguments, and
 * whether it is a fault. Null when there is no schema to speak of. `name` is
 * null for an inline schema.
 */
export function schemaStatusText(status: SchemaStatus): { key: string; args: string[]; failed: boolean } | null {
    switch (status.kind) {
        case "none":
            return null;
        case "unsupported":
            return { key: "Status_SchemaUnsupported", args: [], failed: true };
        case "loading":
            return { key: "Status_SchemaLoading", args: [status.name], failed: false };
    }

    const name = status.name ?? "";
    const load = status.load;
    switch (load.state) {
        case "ready":
            return status.name === null
                ? { key: "Status_SchemaInline", args: [], failed: false }
                : { key: "Status_SchemaReady", args: [name], failed: false };
        case "notFound":
            return { key: "Status_SchemaNotFound", args: [name], failed: true };
        case "denied":
            return { key: "Status_SchemaDenied", args: [name], failed: true };
        case "failed":
            return { key: "Status_SchemaFailed", args: [name, String(load.status)], failed: true };
        case "offline":
            return { key: "Status_SchemaOffline", args: [name], failed: true };
        case "notJson":
            return status.name === null
                ? { key: "Status_SchemaInlineNotJson", args: [], failed: true }
                : { key: "Status_SchemaNotJson", args: [name], failed: true };
        case "invalidSchema":
            return status.name === null
                ? { key: "Status_SchemaInlineInvalid", args: [load.message], failed: true }
                : { key: "Status_SchemaInvalid", args: [name, load.message], failed: true };
    }
}

/**
 * Whether the schema keeps the verdict from being "valid" whatever the
 * document holds: one was asked for and is not in force — loading, missing,
 * refused, broken. `isValid` means *checked against everything the maker
 * asked for and clean*, so it fails closed; `problemCount` still counts only
 * what was found. A canvas app enabling Save on `isValid` would otherwise
 * save a document nobody checked.
 */
export function schemaWithholdsVerdict(status: SchemaStatus): boolean {
    if (status.kind === "none") {
        return false;
    }
    return !(status.kind === "loaded" && status.load.state === "ready");
}
