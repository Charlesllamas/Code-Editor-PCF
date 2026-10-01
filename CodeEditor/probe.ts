// THROWAWAY — the 1.4.9 probe build. Delete this file and its import in
// index.ts before 1.5.0.
//
// It asks the form the questions 1.5.0 rests on (SPEC.md, P1–P7): what a
// standard field control with no feature declared can read of the
// environment's table definitions, how big and how slow each read is, and
// which of the names those reads list FetchXML actually takes. It touches no
// editor and changes nothing: every request is a GET, and the FetchXML ones
// ask for one row. From the browser console:
//
//     const p = window.__pcfCodeEditorProbe
//     p.env()                           P5, P6: the host — page, client URL, language
//     await p.tables()                  P1: the table list four ways, and P5's labels
//     await p.columns("account")        P2: one table's columns, by kind
//     await p.accepts("account")        P2: which kinds FetchXML takes, and four grammar faults
//     await p.relationships("account")  P3: the three kinds in one request
//     await p.options("account")        P4: a choice's options, per metadata type
//     await p.root()                    P6: a root-relative /api/data request (run it in canvas)
//     await p.utils("account")          extra: getEntityMetadata with no Utility declared
//     copy(await p.all())               all of the above, in order, onto the clipboard
//
// The table defaults to the form's own (`contextInfo.entityTypeName`). Run
// `p.all()` straight after a hard reload: P1's first request is the cold one.
// Each answer goes into SPEC.md verbatim, and a wrong one removes the feature
// it names.

import { IInputs } from "./generated/ManifestTypes";

type Context = ComponentFramework.Context<IInputs>;
type Row = Record<string, unknown>;

const PROBE_VERSION = "1.4.9";

/** The skill's rule for a same-origin Web API read: one helper, these headers, no Prefer. */
const HEADERS: Record<string, string> = {
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0"
};

let latest: Context | undefined;
let installed = false;
let requests = 0;
const columnCache = new Map<string, Row[]>();

/** Called from init and every updateView: the probe reads the latest context. */
export function see(context: Context): void {
    latest = context;
    if (installed) {
        return;
    }
    installed = true;
    (window as unknown as { __pcfCodeEditorProbe?: unknown }).__pcfCodeEditorProbe = api;
    console.info(`Code Editor ${PROBE_VERSION} probe: window.__pcfCodeEditorProbe — see SPEC.md P1–P7`);
}

/* ---------------------------------------------------------------- host */

function message(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function round(ms: number): number {
    return Math.round(ms * 10) / 10;
}

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

function apiBase(): string {
    return `${(clientUrl().url ?? "").replace(/\/+$/, "")}/api/data/v9.2/`;
}

function languageId(): number | null {
    const id = latest?.userSettings?.languageId;
    return typeof id === "number" ? id : null;
}

function formTable(): string {
    const info = (latest?.mode as unknown as { contextInfo?: { entityTypeName?: string } } | undefined)?.contextInfo;
    return info?.entityTypeName || "account";
}

function env(): Row {
    const ctx = latest;
    const page = (ctx as unknown as { page?: { getClientUrl?: unknown } } | undefined)?.page;
    const url = clientUrl();
    const info = (ctx?.mode as unknown as { contextInfo?: { entityTypeName?: string; entityId?: string } } | undefined)?.contextInfo;
    const attributes = (ctx?.parameters.code as unknown as { attributes?: { LogicalName?: string; EntityLogicalName?: string } } | undefined)?.attributes;
    const utils = ctx?.utils as unknown as { getEntityMetadata?: unknown } | undefined;
    const client = ctx?.client as unknown as { getClient?: () => string; getFormFactor?: () => number } | undefined;
    return {
        probe: PROBE_VERSION,
        location: `${location.origin}${location.pathname}`,
        page: typeof page,
        getClientUrl: page ? typeof page.getClientUrl : "n/a",
        clientUrl: url.url,
        clientUrlHow: url.how,
        apiBase: apiBase(),
        languageId: languageId(),
        client: safe(() => client?.getClient?.()),
        formFactor: safe(() => client?.getFormFactor?.()),
        boundAttributes: typeof attributes,
        boundColumn: attributes?.LogicalName ?? null,
        contextInfo: info ? { entityTypeName: info.entityTypeName ?? null, entityId: info.entityId ? "present" : "absent" } : null,
        webAPI: typeof ctx?.webAPI,
        utils: typeof utils,
        getEntityMetadata: typeof utils?.getEntityMetadata,
        requestsSoFar: requests
    };
}

function safe<T>(read: () => T): T | string {
    try {
        return read();
    } catch (error) {
        return `threw ${message(error)}`;
    }
}

/* ------------------------------------------------------------- request */

interface Reply {
    path: string;
    first: boolean;
    status: number;
    ms: number;
    bytes: number;
    contentType: string | null;
    cacheControl: string | null;
    body: unknown;
    /** The start of a body that is not JSON (an HTML 404, say). */
    snippet?: string;
    /** A rejected fetch: the network, or a URL the page cannot reach. */
    rejected?: string;
}

async function get(path: string, absolute = false): Promise<Reply> {
    const first = requests === 0;
    requests++;
    const url = absolute ? path : apiBase() + path;
    const started = performance.now();
    let response: Response;
    try {
        response = await fetch(url, { headers: HEADERS, credentials: "same-origin" });
    } catch (error) {
        return { path, first, status: 0, ms: round(performance.now() - started), bytes: 0, contentType: null, cacheControl: null, body: null, rejected: message(error) };
    }
    const text = await response.text();
    const ms = round(performance.now() - started);
    let body: unknown = null;
    try {
        body = text === "" ? null : JSON.parse(text);
    } catch {
        body = null;
    }
    return {
        path,
        first,
        status: response.status,
        ms,
        bytes: new TextEncoder().encode(text).length,
        contentType: response.headers.get("content-type"),
        cacheControl: response.headers.get("cache-control"),
        body,
        snippet: body === null && text !== "" ? text.slice(0, 160) : undefined
    };
}

/** What a reply is, without its body. */
function head(reply: Reply): Row {
    const out: Row = { status: reply.status, ms: reply.ms, bytes: reply.bytes, first: reply.first, contentType: reply.contentType, cacheControl: reply.cacheControl };
    if (reply.rejected) {
        out.rejected = reply.rejected;
    }
    if (reply.snippet) {
        out.snippet = reply.snippet;
    }
    const error = errorOf(reply.body);
    if (error) {
        out.error = error;
    }
    return out;
}

function errorOf(body: unknown): Row | null {
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    return error ? { code: error.code ?? null, message: typeof error.message === "string" ? error.message.slice(0, 300) : null } : null;
}

function rows(reply: Reply): Row[] {
    const value = (reply.body as { value?: unknown } | null)?.value;
    return Array.isArray(value) ? (value as Row[]) : [];
}

/** A Label's text in the user's language, and which language that was. */
function label(value: unknown): { text: string | null; lang: number | null; localized: number } {
    const l = value as { UserLocalizedLabel?: { Label?: string; LanguageCode?: number } | null; LocalizedLabels?: unknown[] } | null | undefined;
    return {
        text: l?.UserLocalizedLabel?.Label ?? null,
        lang: l?.UserLocalizedLabel?.LanguageCode ?? null,
        localized: Array.isArray(l?.LocalizedLabels) ? l.LocalizedLabels.length : 0
    };
}

function count<T>(items: T[], key: (item: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const item of items) {
        const k = key(item);
        out[k] = (out[k] ?? 0) + 1;
    }
    return out;
}

function names(items: Row[], n = 5): unknown[] {
    return items.slice(0, n).map((r) => r.LogicalName);
}

/* ------------------------------------------------------------------ P1 */

async function tables(): Promise<Row> {
    const lcid = languageId();
    const select = "$select=LogicalName,DisplayName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,IsIntersect,IsValidForAdvancedFind";
    const lang = lcid === null ? "" : `&LabelLanguages=${lcid}`;
    const runs: [string, string][] = [
        ["nonPrivateWithLabelLanguages", `EntityDefinitions?${select}&$filter=IsPrivate eq false${lang}`],
        ["nonPrivateAllLanguages", `EntityDefinitions?${select}&$filter=IsPrivate eq false`],
        ["advancedFindWithLabelLanguages", `EntityDefinitions?${select}&$filter=IsValidForAdvancedFind eq true${lang}`],
        ["namesOnly", "EntityDefinitions?$select=LogicalName&$filter=IsPrivate eq false"]
    ];
    const out: Row = { languageId: lcid };
    for (const [name, path] of runs) {
        const reply = await get(path);
        const list = rows(reply);
        const labels = list.map((r) => label(r.DisplayName));
        out[name] = {
            ...head(reply),
            count: list.length,
            intersect: list.filter((r) => r.IsIntersect === true).length,
            advancedFind: list.filter((r) => r.IsValidForAdvancedFind === true).length,
            labels: name === "namesOnly" ? undefined : {
                withUserLabel: labels.filter((l) => l.text !== null).length,
                withoutUserLabel: labels.filter((l) => l.text === null).length,
                languages: count(labels.filter((l) => l.lang !== null), (l) => String(l.lang)),
                localizedLabelsMax: labels.reduce((m, l) => Math.max(m, l.localized), 0),
                sampleWithout: names(list.filter((r) => label(r.DisplayName).text === null))
            },
            sample: list.slice(0, 3).map((r) => ({
                LogicalName: r.LogicalName,
                DisplayName: label(r.DisplayName).text,
                EntitySetName: r.EntitySetName,
                PrimaryIdAttribute: r.PrimaryIdAttribute,
                PrimaryNameAttribute: r.PrimaryNameAttribute,
                IsIntersect: r.IsIntersect,
                IsValidForAdvancedFind: r.IsValidForAdvancedFind
            })),
            account: list.some((r) => r.LogicalName === "account")
        };
    }
    // The first run again: is a warm read cached by the browser, or fetched?
    const again = await get(runs[0][1]);
    out.firstRunAgain = head(again);
    return out;
}

/* ------------------------------------------------------------------ P2 */

async function loadColumns(table: string): Promise<{ reply: Reply; list: Row[] }> {
    const lcid = languageId();
    const reply = await get(`EntityDefinitions(LogicalName='${table}')/Attributes?$select=LogicalName,AttributeType,AttributeTypeName,DisplayName,Description,IsValidForRead,AttributeOf,IsLogical${lcid === null ? "" : `&LabelLanguages=${lcid}`}`);
    const list = rows(reply);
    if (list.length > 0) {
        columnCache.set(table, list);
    }
    return { reply, list };
}

function typeName(r: Row): string {
    const t = r.AttributeTypeName as { Value?: string } | null | undefined;
    return t?.Value ?? "none";
}

async function columns(table = formTable()): Promise<Row> {
    const { reply, list } = await loadColumns(table);
    const shadow = list.filter((r) => typeof r.AttributeOf === "string" && r.AttributeOf !== "");
    const notReadable = list.filter((r) => r.IsValidForRead === false);
    const logical = list.filter((r) => r.IsLogical === true);
    const virtual = list.filter((r) => r.AttributeType === "Virtual");
    const unlabelled = list.filter((r) => label(r.DisplayName).text === null);
    return {
        table,
        ...head(reply),
        count: list.length,
        byType: count(list, (r) => String(r.AttributeType)),
        byTypeName: count(list, typeName),
        shadow: { count: shadow.length, sample: shadow.slice(0, 6).map((r) => `${r.LogicalName} of ${r.AttributeOf}`) },
        notReadable: { count: notReadable.length, sample: names(notReadable, 6) },
        logical: { count: logical.length, sample: names(logical, 6) },
        virtual: { count: virtual.length, sample: virtual.slice(0, 6).map((r) => `${r.LogicalName} (${typeName(r)})`) },
        withoutDisplayName: { count: unlabelled.length, sample: names(unlabelled, 6) },
        descriptions: list.filter((r) => label(r.Description).text !== null).length,
        sample: list.slice(0, 3).map((r) => ({
            LogicalName: r.LogicalName,
            AttributeType: r.AttributeType,
            AttributeTypeName: typeName(r),
            DisplayName: label(r.DisplayName),
            IsValidForRead: r.IsValidForRead,
            AttributeOf: r.AttributeOf,
            IsLogical: r.IsLogical
        }))
    };
}

async function definition(table: string): Promise<{ entitySet: string | null; primaryId: string | null; reply: Reply }> {
    const reply = await get(`EntityDefinitions(LogicalName='${table}')?$select=EntitySetName,PrimaryIdAttribute`);
    const body = reply.body as { EntitySetName?: string; PrimaryIdAttribute?: string } | null;
    return { entitySet: body?.EntitySetName ?? null, primaryId: body?.PrimaryIdAttribute ?? null, reply };
}

async function runFetch(entitySet: string, fetchXml: string): Promise<Row> {
    const reply = await get(`${entitySet}?fetchXml=${encodeURIComponent(fetchXml)}`);
    const out: Row = { status: reply.status, ms: reply.ms };
    const error = errorOf(reply.body);
    if (error) {
        out.error = error;
    }
    if (reply.rejected) {
        out.rejected = reply.rejected;
    }
    if (reply.status === 200) {
        out.rows = rows(reply).length;
    }
    return out;
}

async function accepts(table = formTable()): Promise<Row> {
    const list = columnCache.get(table) ?? (await loadColumns(table)).list;
    const def = await definition(table);
    if (!def.entitySet || !def.primaryId) {
        return { table, definition: head(def.reply), skipped: "no EntitySetName/PrimaryIdAttribute" };
    }
    const plain = (r: Row) => !r.AttributeOf && r.IsValidForRead === true && r.IsLogical !== true;
    const picks: [string, Row[]][] = [
        ["plainString", list.filter((r) => r.AttributeType === "String" && plain(r)).slice(0, 1)],
        ["lookup", list.filter((r) => r.AttributeType === "Lookup" && plain(r)).slice(0, 1)],
        ["shadow", list.filter((r) => typeof r.AttributeOf === "string" && r.AttributeOf !== "").slice(0, 3)],
        ["notReadable", list.filter((r) => r.IsValidForRead === false).slice(0, 2)],
        ["virtual", list.filter((r) => r.AttributeType === "Virtual").slice(0, 2)],
        ["entityName", list.filter((r) => r.AttributeType === "EntityName").slice(0, 1)],
        ["logical", list.filter((r) => r.IsLogical === true).slice(0, 2)],
        ["composite", list.filter((r) => String(r.LogicalName).endsWith("_composite")).slice(0, 1)],
        ["imageOrFile", list.filter((r) => /^(Image|File)Type$/.test(typeName(r))).slice(0, 1)]
    ];
    const out: Row = { table, entitySet: def.entitySet };
    for (const [kind, chosen] of picks) {
        const results: Row[] = [];
        for (const r of chosen) {
            const name = String(r.LogicalName);
            results.push({
                name,
                type: `${r.AttributeType}/${typeName(r)}`,
                asAttribute: await runFetch(def.entitySet, `<fetch top="1"><entity name="${table}"><attribute name="${name}"/></entity></fetch>`),
                inCondition: await runFetch(def.entitySet, `<fetch top="1"><entity name="${table}"><attribute name="${def.primaryId}"/><filter><condition attribute="${name}" operator="not-null"/></filter></entity></fetch>`)
            });
        }
        out[kind] = results.length > 0 ? results : "none on this table";
    }
    // What the server says to the faults 1.5.0 means to mark: a column that
    // does not exist (a warning), and three grammar faults (errors).
    out.refusals = {
        unknownColumn: await runFetch(def.entitySet, `<fetch top="1"><entity name="${table}"><attribute name="nosuchcolumn"/></entity></fetch>`),
        unknownElement: await runFetch(def.entitySet, `<fetch top="1"><entity name="${table}"><atribute name="${def.primaryId}"/></entity></fetch>`),
        unknownAttribute: await runFetch(def.entitySet, `<fetch top="1" nosuch="1"><entity name="${table}"><attribute name="${def.primaryId}"/></entity></fetch>`),
        unknownOperator: await runFetch(def.entitySet, `<fetch top="1"><entity name="${table}"><attribute name="${def.primaryId}"/><filter><condition attribute="${def.primaryId}" operator="equals" value="00000000-0000-0000-0000-000000000000"/></filter></entity></fetch>`),
        misplacedElement: await runFetch(def.entitySet, `<fetch top="1"><entity name="${table}"><condition attribute="${def.primaryId}" operator="not-null"/></entity></fetch>`)
    };
    return out;
}

/* ------------------------------------------------------------------ P3 */

async function relationships(table = formTable()): Promise<Row> {
    const m1 = "ManyToOneRelationships($select=SchemaName,ReferencedEntity,ReferencedAttribute,ReferencingAttribute,ReferencingEntityNavigationPropertyName)";
    const n1 = "OneToManyRelationships($select=SchemaName,ReferencedEntity,ReferencedAttribute,ReferencingEntity,ReferencingAttribute)";
    const mm = "ManyToManyRelationships($select=SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName,Entity1IntersectAttribute,Entity2IntersectAttribute)";
    const reply = await get(`EntityDefinitions(LogicalName='${table}')?$select=LogicalName&$expand=${m1},${n1},${mm}`);
    const body = reply.body as Record<string, unknown> | null;
    const kinds = ["ManyToOneRelationships", "OneToManyRelationships", "ManyToManyRelationships"];
    const out: Row = { table, oneRequest: head(reply) };
    for (const kind of kinds) {
        const list = Array.isArray(body?.[kind]) ? (body?.[kind] as Row[]) : null;
        out[kind] = list === null ? "absent" : { count: list.length, sample: list.slice(0, 2) };
    }
    if (reply.status !== 200) {
        // One request refused: each kind on its own, so P3 says which part was.
        const alone: Row = {};
        for (const [kind, expand] of [["ManyToOneRelationships", m1], ["OneToManyRelationships", n1], ["ManyToManyRelationships", mm]] as [string, string][]) {
            const select = expand.slice(expand.indexOf("(") + 1, -1);
            const r = await get(`EntityDefinitions(LogicalName='${table}')/${kind}?${select}`);
            alone[kind] = { ...head(r), count: rows(r).length };
        }
        out.eachAlone = alone;
    }
    return out;
}

/* ------------------------------------------------------------------ P4 */

async function options(table = formTable()): Promise<Row> {
    const list = columnCache.get(table) ?? (await loadColumns(table)).list;
    const lcid = languageId();
    const lang = lcid === null ? "" : `&LabelLanguages=${lcid}`;
    const first = (prefer: string, test: (r: Row) => boolean) =>
        list.find((r) => r.LogicalName === prefer && test(r)) ?? list.find(test);
    const picks: [string, Row | undefined, string, boolean][] = [
        ["picklist", first("industrycode", (r) => r.AttributeType === "Picklist"), "PicklistAttributeMetadata", false],
        ["state", first("statecode", (r) => r.AttributeType === "State"), "StateAttributeMetadata", false],
        ["status", first("statuscode", (r) => r.AttributeType === "Status"), "StatusAttributeMetadata", false],
        ["boolean", first("donotemail", (r) => r.AttributeType === "Boolean"), "BooleanAttributeMetadata", true],
        ["multiSelect", first("", (r) => typeName(r) === "MultiSelectPicklistType"), "MultiSelectPicklistAttributeMetadata", false]
    ];
    const out: Row = { table };
    for (const [kind, column, cast, isBoolean] of picks) {
        if (!column) {
            out[kind] = "none on this table";
            continue;
        }
        const name = String(column.LogicalName);
        const inner = isBoolean ? "$select=TrueOption,FalseOption" : "$select=Options";
        const base = `EntityDefinitions(LogicalName='${table}')/Attributes(LogicalName='${name}')/Microsoft.Dynamics.CRM.${cast}?$select=LogicalName`;
        let reply = await get(`${base}&$expand=OptionSet(${inner}),GlobalOptionSet(${inner})${lang}`);
        let route = "nested $select";
        if (reply.status === 400) {
            reply = await get(`${base}&$expand=OptionSet,GlobalOptionSet${lang}`);
            route = "plain $expand (nested $select refused)";
        }
        const body = reply.body as { OptionSet?: Row | null; GlobalOptionSet?: Row | null } | null;
        const set = body?.OptionSet ?? body?.GlobalOptionSet ?? null;
        const opts = isBoolean
            ? [set?.TrueOption, set?.FalseOption].filter(Boolean) as Row[]
            : (Array.isArray(set?.Options) ? set?.Options as Row[] : []);
        const sample = opts[0];
        out[kind] = {
            column: name,
            route,
            ...head(reply),
            optionSet: body ? (body.OptionSet ? "OptionSet" : body.GlobalOptionSet ? "GlobalOptionSet only" : "neither") : null,
            count: opts.length,
            firstOption: sample ? {
                keys: Object.keys(sample).sort(),
                Value: sample.Value,
                Label: label(sample.Label),
                State: sample.State,
                DefaultStatus: sample.DefaultStatus
            } : null
        };
    }
    return out;
}

/* ------------------------------------------------------------- P6, extra */

async function root(): Promise<Row> {
    const reply = await get("/api/data/v9.2/EntityDefinitions(LogicalName='account')?$select=LogicalName", true);
    return { origin: location.origin, ...head(reply), logicalName: (reply.body as { LogicalName?: unknown } | null)?.LogicalName ?? null };
}

async function utils(table = formTable()): Promise<Row> {
    const u = latest?.utils as unknown as { getEntityMetadata?: (entity: string, attributes?: string[]) => Promise<unknown> } | undefined;
    if (!u || typeof u.getEntityMetadata !== "function") {
        return { getEntityMetadata: typeof u?.getEntityMetadata };
    }
    const started = performance.now();
    try {
        const md = await u.getEntityMetadata(table, ["statecode", "industrycode"]) as {
            EntitySetName?: unknown;
            Attributes?: { get?: (name: string) => unknown; getAll?: () => unknown[] };
        };
        const state = md.Attributes?.get?.("statecode") as { OptionSet?: unknown; attributeDescriptor?: { OptionSet?: unknown } } | undefined;
        const optionSet = state?.attributeDescriptor?.OptionSet ?? state?.OptionSet;
        return {
            ms: round(performance.now() - started),
            EntitySetName: md.EntitySetName ?? null,
            attributes: md.Attributes?.getAll?.()?.length ?? null,
            statecodeOptionSet: Array.isArray(optionSet) ? `array of ${optionSet.length}` : typeof optionSet === "object" && optionSet !== null ? `object with ${Object.keys(optionSet).length} keys` : typeof optionSet
        };
    } catch (error) {
        return { ms: round(performance.now() - started), threw: message(error) };
    }
}

async function all(table = formTable()): Promise<Row> {
    return {
        env: env(),
        P1_tables: await tables(),
        P2_columns: await columns(table),
        P2_accepts: await accepts(table),
        P3_relationships: await relationships(table),
        P4_options: await options(table),
        P6_root: await root(),
        extra_utils: await utils(table),
        envAfter: { requests }
    };
}

const api = { env, tables, columns, accepts, relationships, options, root, utils, all };
