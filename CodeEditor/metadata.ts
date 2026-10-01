// The environment's table definitions, read same-origin through the Web API,
// for FetchXML completion, hover and the name checks.
//
// Measured on the Accounts form with the 1.4.9 probe (SPEC.md, P1–P5,
// 2026-10-01), as System Administrator, no feature declared:
//
//   - The table list is one answer, no paging: 860 tables, 486,406 bytes,
//     232 ms cold with `LabelLanguages`. Every metadata answer says
//     `cache-control: no-cache` and a repeat is fetched again, so this file's
//     cache is the only one there is — one per page, shared by every editor,
//     and asked only when something needs it, never at load.
//   - A table's columns: 239 on account in 139 ms. Shadows (`AttributeOf`
//     set) have no label; FetchXML takes them, so they are known names.
//   - The three relationship kinds come in one `$expand`.
//   - A choice's options need a cast per type; every cast took the nested
//     `$select`. A Yes/No answers `TrueOption`/`FalseOption`.
//   - Labels arrive in the user's language under `LabelLanguages`; 86 tables
//     and every shadow column have none.
//   - `utils.getEntityMetadata` throws without the Utility feature declared;
//     these reads need nothing.
//
// A failure is a state, kept for the page's life and never retried per
// keystroke: `denied` (401/403), `notFound` (404 — itself an answer: the
// table does not exist), `failed` (anything else), `offline` (a rejected
// fetch). Takes `fetch` as an argument and imports nothing of Monaco or the
// DOM: `dev/smoke.js` drives it through the template rig's fetch stub.

export type Fetch = (url: string, init: { headers: Record<string, string>; credentials: "same-origin" }) => Promise<{
    status: number;
    ok: boolean;
    json(): Promise<unknown>;
}>;

export interface TableInfo {
    name: string;
    label: string | null;
    entitySet: string | null;
    primaryId: string | null;
    primaryName: string | null;
    intersect: boolean;
}

export interface ColumnInfo {
    name: string;
    /** `AttributeType`: String, Lookup, Picklist, Virtual… */
    type: string;
    /** `AttributeTypeName.Value`: what tells a multi-select from another Virtual. */
    typeName: string;
    label: string | null;
    description: string | null;
    readable: boolean;
    /** The column a shadow belongs to — `accountcategorycodename` → `accountcategorycode`. */
    shadowOf: string | null;
}

/** A join a `link-entity` can make from a table, in FetchXML's own terms. */
export interface LinkInfo {
    kind: "manyToOne" | "oneToMany" | "manyToMany";
    schemaName: string;
    /** The table the link-entity names. */
    table: string;
    /** A column of that table. */
    from: string;
    /** A column of the table it links from. */
    to: string;
    /** A many-to-many goes through its intersect table, which is `table` here. */
    intersect: boolean;
    /** For a many-to-many, the table at the far side of the intersect. */
    through?: string;
}

export interface OptionInfo {
    value: number;
    label: string | null;
}

export type Failure =
    | { state: "denied"; status: number }
    | { state: "notFound"; status: number }
    | { state: "failed"; status: number }
    | { state: "offline" };

export type Load<T> = { state: "loading" } | { state: "ready"; value: T } | Failure;

export type Need =
    | { kind: "tables" }
    | { kind: "columns"; table: string }
    | { kind: "links"; table: string }
    | { kind: "options"; table: string; column: string };

/** What has been read so far; `undefined` is "never asked". */
export interface Snapshot {
    tables(): Load<TableInfo[]> | undefined;
    columns(table: string): Load<ColumnInfo[]> | undefined;
    links(table: string): Load<LinkInfo[]> | undefined;
    options(table: string, column: string): Load<OptionInfo[]> | undefined;
}

export interface Metadata extends Snapshot {
    /** Start every read named that was never asked, and settle when all named have. */
    ensure(needs: Need[]): Promise<void>;
    /** The first refusal or network failure — what the strip names. `notFound` is not one. */
    failure(): Failure | null;
}

/** The skill's rule for a same-origin Web API read: one helper, these headers, no Prefer. */
const HEADERS: Record<string, string> = {
    Accept: "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0"
};

type Row = Record<string, unknown>;

function labelText(label: unknown): string | null {
    const user = (label as { UserLocalizedLabel?: { Label?: unknown } | null } | null | undefined)?.UserLocalizedLabel;
    return typeof user?.Label === "string" && user.Label !== "" ? user.Label : null;
}

function str(value: unknown): string | null {
    return typeof value === "string" && value !== "" ? value : null;
}

/** The cast segment for a choice's options, by its kind. */
function castOf(column: ColumnInfo): string | null {
    if (column.typeName === "MultiSelectPicklistType") {
        return "MultiSelectPicklist";
    }
    return ["Picklist", "State", "Status", "Boolean"].includes(column.type) ? column.type : null;
}

export function needKey(need: Need): string {
    switch (need.kind) {
        case "tables": return "tables";
        case "columns": return `columns:${need.table}`;
        case "links": return `links:${need.table}`;
        case "options": return `options:${need.table}.${need.column}`;
    }
}

class Store implements Metadata {
    private readonly states = new Map<string, Load<unknown>>();
    private readonly pending = new Map<string, Promise<void>>();
    private firstFailure: Failure | null = null;

    constructor(private readonly base: string, private readonly languageId: number | null, private readonly fetchFn: Fetch) {}

    tables(): Load<TableInfo[]> | undefined {
        return this.states.get("tables") as Load<TableInfo[]> | undefined;
    }

    columns(table: string): Load<ColumnInfo[]> | undefined {
        return this.states.get(`columns:${table}`) as Load<ColumnInfo[]> | undefined;
    }

    links(table: string): Load<LinkInfo[]> | undefined {
        return this.states.get(`links:${table}`) as Load<LinkInfo[]> | undefined;
    }

    options(table: string, column: string): Load<OptionInfo[]> | undefined {
        return this.states.get(`options:${table}.${column}`) as Load<OptionInfo[]> | undefined;
    }

    failure(): Failure | null {
        return this.firstFailure;
    }

    ensure(needs: Need[]): Promise<void> {
        return Promise.all(needs.map((need) => this.start(need))).then(() => undefined);
    }

    private start(need: Need): Promise<void> {
        const key = needKey(need);
        const running = this.pending.get(key);
        if (running) {
            return running;
        }
        const settled = this.states.get(key);
        if (settled && settled.state !== "loading") {
            return Promise.resolve();
        }
        this.states.set(key, { state: "loading" });
        const promise = this.read(need).then(
            (value) => {
                this.states.set(key, { state: "ready", value });
            },
            (failure: Failure) => {
                this.states.set(key, failure);
                if (failure.state !== "notFound" && this.firstFailure === null) {
                    this.firstFailure = failure;
                }
            }
        ).then(() => {
            this.pending.delete(key);
        });
        this.pending.set(key, promise);
        return promise;
    }

    private async get(path: string): Promise<unknown> {
        const languages = this.languageId === null ? "" : `${path.includes("?") ? "&" : "?"}LabelLanguages=${this.languageId}`;
        let response: Awaited<ReturnType<Fetch>>;
        try {
            response = await this.fetchFn(`${this.base}/api/data/v9.2/${path}${languages}`, { headers: HEADERS, credentials: "same-origin" });
        } catch {
            throw { state: "offline" } as Failure;
        }
        if (response.status === 401 || response.status === 403) {
            throw { state: "denied", status: response.status } as Failure;
        }
        if (response.status === 404) {
            throw { state: "notFound", status: 404 } as Failure;
        }
        if (!response.ok) {
            throw { state: "failed", status: response.status } as Failure;
        }
        try {
            return await response.json();
        } catch {
            throw { state: "failed", status: response.status } as Failure;
        }
    }

    private async read(need: Need): Promise<unknown> {
        switch (need.kind) {
            case "tables": {
                const body = await this.get("EntityDefinitions?$select=LogicalName,DisplayName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute,IsIntersect&$filter=IsPrivate eq false");
                return rowsOf(body).map((r): TableInfo => ({
                    name: String(r.LogicalName),
                    label: labelText(r.DisplayName),
                    entitySet: str(r.EntitySetName),
                    primaryId: str(r.PrimaryIdAttribute),
                    primaryName: str(r.PrimaryNameAttribute),
                    intersect: r.IsIntersect === true
                })).sort((a, b) => a.name.localeCompare(b.name));
            }
            case "columns": {
                const body = await this.get(`EntityDefinitions(LogicalName='${need.table}')/Attributes?$select=LogicalName,AttributeType,AttributeTypeName,DisplayName,Description,IsValidForRead,AttributeOf`);
                return rowsOf(body).map((r): ColumnInfo => ({
                    name: String(r.LogicalName),
                    type: String(r.AttributeType ?? ""),
                    typeName: str((r.AttributeTypeName as { Value?: unknown } | null | undefined)?.Value) ?? `${String(r.AttributeType ?? "")}Type`,
                    label: labelText(r.DisplayName),
                    description: labelText(r.Description),
                    readable: r.IsValidForRead !== false,
                    shadowOf: str(r.AttributeOf)
                })).sort((a, b) => a.name.localeCompare(b.name));
            }
            case "links": {
                const body = await this.get(`EntityDefinitions(LogicalName='${need.table}')?$select=LogicalName,PrimaryIdAttribute`
                    + "&$expand=ManyToOneRelationships($select=SchemaName,ReferencedEntity,ReferencedAttribute,ReferencingAttribute)"
                    + ",OneToManyRelationships($select=SchemaName,ReferencedAttribute,ReferencingEntity,ReferencingAttribute)"
                    + ",ManyToManyRelationships($select=SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName,Entity1IntersectAttribute,Entity2IntersectAttribute)");
                return linksOf(need.table, body as Row);
            }
            case "options": {
                await this.start({ kind: "columns", table: need.table });
                const columns = this.columns(need.table);
                const column = columns?.state === "ready" ? columns.value.find((c) => c.name === need.column) : undefined;
                const cast = column ? castOf(column) : null;
                if (!column || !cast) {
                    throw { state: "notFound", status: 404 } as Failure;
                }
                const inner = cast === "Boolean" ? "$select=TrueOption,FalseOption" : "$select=Options";
                const body = await this.get(`EntityDefinitions(LogicalName='${need.table}')/Attributes(LogicalName='${need.column}')/Microsoft.Dynamics.CRM.${cast}AttributeMetadata?$select=LogicalName&$expand=OptionSet(${inner}),GlobalOptionSet(${inner})`) as Row;
                const set = (body.OptionSet ?? body.GlobalOptionSet ?? null) as Row | null;
                const raw = cast === "Boolean"
                    ? [set?.TrueOption, set?.FalseOption]
                    : (Array.isArray(set?.Options) ? set?.Options as unknown[] : []);
                return raw.filter((o): o is Row => typeof o === "object" && o !== null)
                    .map((o): OptionInfo => ({ value: Number(o.Value), label: labelText(o.Label) }))
                    .filter((o) => Number.isFinite(o.value));
            }
        }
    }
}

function rowsOf(body: unknown): Row[] {
    const value = (body as { value?: unknown } | null)?.value;
    if (!Array.isArray(value)) {
        throw { state: "failed", status: 200 } as Failure;
    }
    return value.filter((r): r is Row => typeof r === "object" && r !== null);
}

/** The relationships of `table`, as the joins a link-entity under it can make. */
export function linksOf(table: string, body: Row): LinkInfo[] {
    const list = (key: string): Row[] => (Array.isArray(body[key]) ? (body[key] as unknown[]).filter((r): r is Row => typeof r === "object" && r !== null) : []);
    const primaryId = str(body.PrimaryIdAttribute) ?? `${table}id`;
    const out: LinkInfo[] = [];
    for (const r of list("ManyToOneRelationships")) {
        // `table` holds the lookup: link to the table it points at.
        out.push({ kind: "manyToOne", schemaName: String(r.SchemaName), table: String(r.ReferencedEntity), from: String(r.ReferencedAttribute), to: String(r.ReferencingAttribute), intersect: false });
    }
    for (const r of list("OneToManyRelationships")) {
        // Another table's lookup points at `table`: link to the rows that point here.
        out.push({ kind: "oneToMany", schemaName: String(r.SchemaName), table: String(r.ReferencingEntity), from: String(r.ReferencingAttribute), to: str(r.ReferencedAttribute) ?? primaryId, intersect: false });
    }
    for (const r of list("ManyToManyRelationships")) {
        // Through the intersect table, from this side's column of it.
        const first = r.Entity1LogicalName === table;
        out.push({
            kind: "manyToMany",
            schemaName: String(r.SchemaName),
            table: String(r.IntersectEntityName),
            from: String(first ? r.Entity1IntersectAttribute : r.Entity2IntersectAttribute),
            to: primaryId,
            intersect: true,
            through: String(first ? r.Entity2LogicalName : r.Entity1LogicalName)
        });
    }
    return out;
}

/* ----------------------------------------------------------- the cache */

const stores = new Map<string, Store>();

/**
 * The page's reader for one organisation and language. Every editor on the
 * page shares it: two FetchXML editors read the table list once.
 */
export function metadataFor(clientUrl: string, languageId: number | null, fetchFn: Fetch): Metadata {
    const base = clientUrl.replace(/\/+$/, "");
    const key = `${base}|${languageId ?? ""}`;
    let store = stores.get(key);
    if (!store) {
        store = new Store(base, languageId, fetchFn);
        stores.set(key, store);
    }
    return store;
}

/** For the suite: forget every reader, as a page reload does. */
export function forgetMetadata(): void {
    stores.clear();
}
