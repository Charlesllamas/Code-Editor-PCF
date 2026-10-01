// FetchXML, as data: which elements go where, the attributes each takes and
// what kind of thing each attribute names, and the condition operators.
//
// Taken from Learn's FetchXml reference (the fetch, entity, attribute,
// all-attributes, order, filter, condition, value and link-entity pages and
// *condition operator values*, read 2026-10-01), with two additions the
// server made itself (SPEC.md, the 1.4.9 probe, P2):
//
//   - `no-attrs` is a valid child of `entity` — the server's own refusal
//     lists it ("valid nodes are filter, order, link-entity, attribute,
//     all-attributes, no-attrs") and the reference pages do not.
//   - `version`, `output-format` and `mapping` on `fetch` are what Advanced
//     Find and saved views write; the server runs an attribute it does not
//     know, so they are listed to keep every saved view from carrying a
//     warning, not because the reference names them.
//
// What the server refuses and what it ignores is the line between an error
// and a warning (fetchValidate.ts); this file only says what FetchXML is.
// The descriptions are English, as the schema messages are.

export type OperandType = "choice" | "datetime" | "hierarchical" | "number" | "owner" | "string" | "uniqueidentifier";

/** How many values an operator takes, and where they go. */
export type Arity = "none" | "one" | "count" | "two" | "many";

export type AttrKind =
    /** A table's logical name. */
    | "table"
    /** A column of the table in scope: the element's own entity or link-entity, or `entityname`'s. */
    | "column"
    /** `link-entity from`: a column of the linked table itself. */
    | "linkedColumn"
    /** `link-entity to`: a column of the table it links from. */
    | "parentColumn"
    /** Declares an alias. */
    | "alias"
    /** Names a link-entity by its alias (or name). */
    | "linkAlias"
    /** Names an attribute's alias. */
    | "attributeAlias"
    | "operator"
    | "enum"
    | "boolean"
    /** A positive whole number. */
    | "number"
    /** A condition's value — a choice's options, where the column is one. */
    | "value"
    | "text";

export interface AttrSpec {
    name: string;
    kind: AttrKind;
    required?: boolean;
    values?: string[];
    description: string;
}

export interface ElementSpec {
    name: string;
    description: string;
    children: string[];
    attributes: AttrSpec[];
    /** Holds text — `<value>`. */
    text?: boolean;
    /** What the completion inserts after the name, as a snippet, when the tag is new. */
    snippet: string;
}

const BOOLEAN = ["true", "false"];

export const ELEMENTS: Record<string, ElementSpec> = {
    fetch: {
        name: "fetch",
        description: "The root element of a FetchXML query.",
        children: ["entity"],
        snippet: "fetch>\n\t$0\n</fetch>",
        attributes: [
            { name: "top", kind: "number", description: "How many rows to return, at most 5,000. Not together with `page`, `count` or `returntotalrecordcount`." },
            { name: "count", kind: "number", description: "How many rows a page holds." },
            { name: "page", kind: "number", description: "Which page to return." },
            { name: "paging-cookie", kind: "text", description: "The cookie from the previous page, to fetch the next one efficiently." },
            { name: "returntotalrecordcount", kind: "boolean", values: BOOLEAN, description: "Whether to return the total number of matching rows." },
            { name: "aggregate", kind: "boolean", values: BOOLEAN, description: "Whether the query returns aggregate values." },
            { name: "aggregatelimit", kind: "number", description: "A limit below the standard 50,000-row aggregate limit." },
            { name: "distinct", kind: "boolean", values: BOOLEAN, description: "Whether duplicate rows are left out of the results." },
            { name: "no-lock", kind: "boolean", values: BOOLEAN, description: "A legacy setting to prevent shared locks; no longer necessary." },
            { name: "latematerialize", kind: "boolean", values: BOOLEAN, description: "Breaks a long-running query into smaller parts and reassembles the results." },
            { name: "useraworderby", kind: "boolean", values: BOOLEAN, description: "Sorts choice columns by their number rather than their label." },
            { name: "datasource", kind: "enum", values: ["retained"], description: "`retained` queries long-term retained rows only." },
            { name: "options", kind: "text", values: ["ForceOrder", "DisableRowGoal", "EnableOptimizerHotfixes", "LoopJoin", "MergeJoin", "HashJoin", "NO_PERFORMANCE_SPOOL", "ENABLE_HIST_AMENDMENT_FOR_ASC_KEYS"], description: "SQL Server hints, separated by commas. Only when Microsoft support recommends one." },
            { name: "version", kind: "text", description: "Written by Advanced Find and saved views; Dataverse runs the query without it." },
            { name: "output-format", kind: "text", values: ["xml-platform"], description: "Written by Advanced Find and saved views; Dataverse runs the query without it." },
            { name: "mapping", kind: "text", values: ["logical"], description: "Written by Advanced Find and saved views; Dataverse runs the query without it." }
        ]
    },
    entity: {
        name: "entity",
        description: "The table the query is based on. Only one is allowed.",
        children: ["attribute", "all-attributes", "no-attrs", "order", "filter", "link-entity"],
        snippet: "entity name=\"$1\">\n\t$0\n</entity>",
        attributes: [
            { name: "name", kind: "table", required: true, description: "The logical name of the table." }
        ]
    },
    attribute: {
        name: "attribute",
        description: "A column to return from the entity or link-entity it sits in.",
        children: [],
        snippet: "attribute name=\"$1\" />",
        attributes: [
            { name: "name", kind: "column", required: true, description: "The logical name of the column." },
            { name: "alias", kind: "alias", description: "The name the column is returned under; needed for aggregate values." },
            { name: "aggregate", kind: "enum", values: ["avg", "count", "countcolumn", "max", "min", "sum"], description: "The aggregate function to apply." },
            { name: "groupby", kind: "boolean", values: BOOLEAN, description: "Groups an aggregate query by this column." },
            { name: "dategrouping", kind: "enum", values: ["day", "week", "month", "quarter", "year", "fiscal-period", "fiscal-year"], description: "The part of a date to group by." },
            { name: "distinct", kind: "boolean", values: BOOLEAN, description: "With `countcolumn`, counts unique values only." },
            { name: "usertimezone", kind: "boolean", values: BOOLEAN, description: "`false` groups dates in UTC; otherwise in the user's time zone." },
            { name: "rowaggregate", kind: "enum", values: ["CountChildren"], description: "`CountChildren` includes the number of child records in a hierarchy." }
        ]
    },
    "all-attributes": {
        name: "all-attributes",
        description: "Returns every column with a value. Not recommended for most queries.",
        children: [],
        snippet: "all-attributes />",
        attributes: []
    },
    "no-attrs": {
        name: "no-attrs",
        description: "Returns no columns. The server lists it as a valid child of entity; Learn's reference does not describe it.",
        children: [],
        snippet: "no-attrs />",
        attributes: []
    },
    order: {
        name: "order",
        description: "A sort order for the results.",
        children: [],
        snippet: "order attribute=\"$1\" />",
        attributes: [
            { name: "attribute", kind: "column", required: true, description: "The column to sort by." },
            { name: "alias", kind: "attributeAlias", description: "The alias of the attribute to sort by, in an aggregate query." },
            { name: "descending", kind: "boolean", values: BOOLEAN, description: "Whether to sort in descending order." },
            { name: "entityname", kind: "linkAlias", description: "The alias of a link-entity, so its order is applied first." }
        ]
    },
    filter: {
        name: "filter",
        description: "Conditions on the rows of the entity or link-entity it sits in.",
        children: ["condition", "filter", "link-entity"],
        snippet: "filter type=\"${1|and,or|}\">\n\t$0\n</filter>",
        attributes: [
            { name: "type", kind: "enum", values: ["and", "or"], description: "Whether all (`and`) or any (`or`) of the conditions must be met." },
            { name: "hint", kind: "enum", values: ["union"], description: "The `union` hint, for a performance benefit on some queries." },
            { name: "isquickfindfields", kind: "boolean", values: BOOLEAN, description: "Runs the query as a quick find." },
            { name: "overridequickfindrecordlimitenabled", kind: "boolean", values: BOOLEAN, description: "Applies the quick find record limit." },
            { name: "overridequickfindrecordlimitdisabled", kind: "boolean", values: BOOLEAN, description: "Bypasses the quick find record limit." }
        ]
    },
    condition: {
        name: "condition",
        description: "A condition a row must meet. The operator decides how the value is compared.",
        children: ["value"],
        snippet: "condition attribute=\"$1\" operator=\"$2\" />",
        attributes: [
            { name: "attribute", kind: "column", description: "The column to test." },
            { name: "operator", kind: "operator", required: true, description: "How the column is compared." },
            { name: "value", kind: "value", description: "The value to compare with, for an operator that takes one." },
            { name: "valueof", kind: "column", description: "A column of the same table to compare with instead of a value." },
            { name: "entityname", kind: "linkAlias", description: "The link-entity (its alias, or its name) the condition applies to, after an outer join." }
        ]
    },
    value: {
        name: "value",
        description: "One of the values for an operator that takes several, such as `in` or `between`.",
        children: [],
        text: true,
        snippet: "value>$1</value>",
        attributes: []
    },
    "link-entity": {
        name: "link-entity",
        description: "Joins a related table, to return its columns or to filter on them.",
        children: ["attribute", "all-attributes", "order", "filter", "link-entity"],
        snippet: "link-entity name=\"$1\">\n\t$0\n</link-entity>",
        attributes: [
            { name: "name", kind: "table", required: true, description: "The logical name of the related table." },
            { name: "from", kind: "linkedColumn", description: "The column of the related table that matches `to`. The opposite of QueryExpression's LinkFromAttributeName." },
            { name: "to", kind: "parentColumn", description: "The column of the table it links from that matches `from`." },
            { name: "alias", kind: "alias", description: "The name the related table goes by in the results and in `entityname`." },
            { name: "link-type", kind: "enum", values: ["inner", "outer", "any", "not any", "all", "not all", "exists", "in", "matchfirstrowusingcrossapply"], description: "The kind of join. `inner` unless set." },
            { name: "intersect", kind: "boolean", values: BOOLEAN, description: "Marks a join through an intersect table that returns no columns." }
        ]
    }
};

export interface OperatorSpec {
    name: string;
    description: string;
    types: OperandType[];
    arity: Arity;
    deprecated?: boolean;
}

const D: OperandType[] = ["datetime"];
const ALL: OperandType[] = ["choice", "datetime", "hierarchical", "number", "owner", "string", "uniqueidentifier"];

function op(name: string, types: OperandType[], arity: Arity, description: string, deprecated = false): OperatorSpec {
    return { name, types, arity, description, deprecated };
}

export const OPERATORS: OperatorSpec[] = [
    op("eq", ALL, "one", "Equal to the value."),
    op("ne", ALL, "one", "Not equal to the value."),
    op("neq", ALL, "one", "Deprecated: use `ne`.", true),
    op("null", ALL, "none", "Has no value."),
    op("not-null", ALL, "none", "Has a value."),
    op("in", ["choice", "number", "owner", "string", "uniqueidentifier"], "many", "One of the listed values, each in a `<value>`."),
    op("not-in", ["number"], "many", "None of the listed values, each in a `<value>`."),
    op("gt", ["number", "datetime", "string"], "one", "Greater than the value."),
    op("ge", ["number", "datetime", "string"], "one", "Greater than or equal to the value."),
    op("lt", ["number", "datetime", "string"], "one", "Less than the value."),
    op("le", ["number", "datetime", "string"], "one", "Less than or equal to the value."),
    op("between", ["number", "datetime"], "two", "Between two values, each in a `<value>`."),
    op("not-between", ["number", "datetime"], "two", "Not between two values, each in a `<value>`."),
    op("like", ["string"], "one", "Matches the pattern; `%` is any run of characters."),
    op("not-like", ["string"], "one", "Does not match the pattern."),
    op("begins-with", ["string"], "one", "Starts with the value."),
    op("not-begin-with", ["string"], "one", "Does not start with the value."),
    op("ends-with", ["string"], "one", "Ends with the value."),
    op("not-end-with", ["string"], "one", "Does not end with the value."),
    op("contain-values", ["choice"], "many", "A multi-select choice holding any of the listed values."),
    op("not-contain-values", ["choice"], "many", "A multi-select choice holding none of the listed values."),
    op("on", D, "one", "On the date."),
    op("on-or-before", D, "one", "On or before the date."),
    op("on-or-after", D, "one", "On or after the date."),
    op("yesterday", D, "none", "Yesterday."),
    op("today", D, "none", "Today."),
    op("tomorrow", D, "none", "Tomorrow."),
    op("last-seven-days", D, "none", "In the last seven days, today included."),
    op("next-seven-days", D, "none", "In the next seven days."),
    op("last-week", D, "none", "Last week, Sunday to Saturday."),
    op("this-week", D, "none", "This week."),
    op("next-week", D, "none", "Next week."),
    op("last-month", D, "none", "Last month."),
    op("this-month", D, "none", "This month."),
    op("next-month", D, "none", "Next month."),
    op("last-year", D, "none", "Last year."),
    op("this-year", D, "none", "This year."),
    op("next-year", D, "none", "Next year."),
    op("last-x-hours", D, "count", "In the last x hours. Not on a date-only column."),
    op("next-x-hours", D, "count", "In the next x hours. Not on a date-only column."),
    op("last-x-days", D, "count", "In the last x days."),
    op("next-x-days", D, "count", "In the next x days."),
    op("last-x-weeks", D, "count", "In the last x weeks."),
    op("next-x-weeks", D, "count", "In the next x weeks."),
    op("last-x-months", D, "count", "In the last x months."),
    op("next-x-months", D, "count", "In the next x months."),
    op("last-x-years", D, "count", "In the last x years."),
    op("next-x-years", D, "count", "In the next x years."),
    op("olderthan-x-minutes", D, "count", "Older than x minutes. Not on a date-only column."),
    op("olderthan-x-hours", D, "count", "Older than x hours. Not on a date-only column."),
    op("olderthan-x-days", D, "count", "Older than x days."),
    op("olderthan-x-weeks", D, "count", "Older than x weeks."),
    op("olderthan-x-months", D, "count", "Older than x months."),
    op("olderthan-x-years", D, "count", "Older than x years."),
    op("this-fiscal-year", D, "none", "In the current fiscal year."),
    op("this-fiscal-period", D, "none", "In the current fiscal period."),
    op("last-fiscal-year", D, "none", "In the previous fiscal year."),
    op("last-fiscal-period", D, "none", "In the previous fiscal period."),
    op("next-fiscal-year", D, "none", "In the next fiscal year."),
    op("next-fiscal-period", D, "none", "In the next fiscal period."),
    op("last-x-fiscal-years", D, "count", "In the last x fiscal years."),
    op("last-x-fiscal-periods", D, "count", "In the last x fiscal periods."),
    op("next-x-fiscal-years", D, "count", "In the next x fiscal years."),
    op("next-x-fiscal-periods", D, "count", "In the next x fiscal periods."),
    op("in-fiscal-year", D, "one", "In the fiscal year given as the value."),
    op("in-fiscal-period", D, "one", "In the fiscal period given as the value, of any year."),
    op("in-fiscal-period-and-year", D, "two", "In the fiscal period and year, each in a `<value>`."),
    op("in-or-before-fiscal-period-and-year", D, "two", "In or before the fiscal period and year, each in a `<value>`."),
    op("in-or-after-fiscal-period-and-year", D, "two", "In or after the fiscal period and year, each in a `<value>`."),
    op("eq-userid", ["uniqueidentifier"], "none", "The current user."),
    op("ne-userid", ["uniqueidentifier"], "none", "Not the current user."),
    op("eq-businessid", ["uniqueidentifier"], "none", "The current user's business unit."),
    op("ne-businessid", ["uniqueidentifier"], "none", "Not the current user's business unit."),
    op("eq-userteams", ["owner"], "none", "Owned by a team the current user is in."),
    op("eq-useroruserteams", ["owner"], "none", "Owned by the current user or a team they are in."),
    op("eq-useroruserhierarchy", ["hierarchical"], "none", "The current user or their reporting hierarchy, under hierarchical security."),
    op("eq-useroruserhierarchyandteams", ["hierarchical"], "none", "The current user, their teams, or their reporting hierarchy and its teams."),
    op("eq-userlanguage", ["number"], "none", "The current user's language."),
    op("above", ["hierarchical"], "one", "Every record above the given one in its hierarchy."),
    op("eq-or-above", ["hierarchical"], "one", "The given record and every record above it."),
    op("under", ["hierarchical"], "one", "Every record below the given one in its hierarchy."),
    op("eq-or-under", ["hierarchical"], "one", "The given record and every record below it."),
    op("not-under", ["hierarchical"], "one", "Every record not below the given one.")
];

const OPERATOR_BY_NAME = new Map(OPERATORS.map((o) => [o.name, o]));

export function operatorOf(name: string): OperatorSpec | undefined {
    return OPERATOR_BY_NAME.get(name);
}

export function elementOf(name: string): ElementSpec | undefined {
    return Object.prototype.hasOwnProperty.call(ELEMENTS, name) ? ELEMENTS[name] : undefined;
}

export function attributeOf(element: string, attribute: string): AttrSpec | undefined {
    return elementOf(element)?.attributes.find((a) => a.name === attribute);
}

/**
 * The operand type of a column, from its metadata: what decides which
 * operators are ranked first for it. A lookup is a unique identifier — and
 * possibly hierarchical, which its metadata does not say, so the
 * hierarchical operators are ranked with it too.
 */
export function operandTypes(attributeType: string, typeName: string): OperandType[] {
    if (typeName === "MultiSelectPicklistType") {
        return ["choice"];
    }
    switch (attributeType) {
        case "Picklist":
        case "State":
        case "Status":
        case "Boolean":
            return ["choice"];
        case "DateTime":
            return ["datetime"];
        case "Integer":
        case "BigInt":
        case "Decimal":
        case "Double":
        case "Money":
            return ["number"];
        case "String":
        case "Memo":
        case "EntityName":
            return ["string"];
        case "Owner":
            return ["owner", "uniqueidentifier"];
        case "Lookup":
        case "Customer":
            return ["uniqueidentifier", "hierarchical"];
        case "Uniqueidentifier":
            return ["uniqueidentifier"];
        default:
            return [];
    }
}

/** Whether a column's values are a choice's options — what `value` completes from. */
export function isChoice(attributeType: string, typeName: string): boolean {
    return operandTypes(attributeType, typeName)[0] === "choice";
}
