// What the control says about a document, in a form any language can render.
//
// The checks are pure modules — `dev/smoke.js` drives them in Node, where
// there is no `context.resources` — so they cannot look a string up. Each
// message they write is therefore a `Worded`: the English, ready to show,
// beside the resx key and the arguments it was built from. `index.ts`
// renders the key in the user's language and falls back to the English
// where a key has no translation; a message the checks pass through rather
// than write (the browser's own XML parser, the schema library's last-resort
// text) has no key and stays as it came.
//
// ENGLISH below is the 1033 resx's text for every key, and `dev/smoke.js`
// asserts the two agree — so the English the suite reads is the English a
// form shows, and neither can drift from the other.

/** An argument: plain text, or a message of its own — "a string or a number". */
export type Arg = string | Said;

export interface Said {
    key: string;
    args: Arg[];
}

/** A message, worded: the English, and what to render it from. */
export interface Worded {
    message: string;
    key?: string;
    args?: Arg[];
}

export const ENGLISH: Record<string, string> = {
    // JSON syntax (validate.ts).
    Json_UnexpectedCharacter: "Unexpected character",
    Json_InvalidNumber: "Invalid number",
    Json_PropertyNameExpected: "Expected a property name in double quotes",
    Json_ValueExpected: "Expected a value",
    Json_ColonExpected: "Expected ':'",
    Json_CommaExpected: "Expected ',' or a closing bracket",
    Json_CloseBraceExpected: "Expected '}'",
    Json_CloseBracketExpected: "Expected ']'",
    Json_EndOfFileExpected: "Unexpected content after the end of the document",
    Json_CommentNotAllowed: "Comments are not allowed in JSON",
    Json_UnterminatedComment: "Unterminated comment",
    Json_UnterminatedString: "Unterminated string",
    Json_UnterminatedNumber: "Unterminated number",
    Json_InvalidUnicode: "Invalid unicode escape",
    Json_InvalidEscape: "Invalid escape character",
    Json_InvalidCharacter: "Invalid character in string",
    Json_TrailingComma: "Trailing comma is not allowed",
    // XML (validate.ts): the browser's own text is passed through; this is the fallback.
    Xml_NotWellFormed: "The document is not well-formed XML",
    // JSON Schema (schema.ts).
    Schema_TypeExpected: "Expected {0}, found {1}",
    Schema_Or: "{0} or {1}",
    Type_string: "a string",
    Type_number: "a number",
    Type_integer: "an integer",
    Type_boolean: "true or false",
    Type_object: "an object",
    Type_array: "an array",
    Type_null: "null",
    Schema_Required: "Missing required property \"{0}\"",
    Schema_OneOf: "Must be one of {0}",
    Schema_Const: "Must be {0}",
    Schema_NoShape: "Does not match any of the allowed shapes",
    Schema_ManyShapes: "Matches more than one of the allowed shapes",
    Schema_NotShape: "Matches a shape that is not allowed",
    Schema_Minimum: "Must be at least {0}",
    Schema_Maximum: "Must be at most {0}",
    Schema_ExclusiveMinimum: "Must be greater than {0}",
    Schema_ExclusiveMaximum: "Must be less than {0}",
    Schema_DependentRequired: "\"{0}\" also needs \"{1}\"",
    Schema_ItemNotAllowed: "This item is not allowed here",
    Schema_PropertyNotAllowed: "Property \"{0}\" is not allowed",
    Schema_PropertyName: "Property name \"{0}\": {1}",
    Schema_NotAnObject: "A schema is an object",
    Schema_UnresolvedRef: "The schema refers to {0}, which it does not contain",
    // FetchXML (fetchValidate.ts).
    Fetch_NotFetch: "A FetchXML query starts with <fetch>",
    Fetch_UnknownElement: "<{0}> is not a FetchXML element — <{1}> takes {2}",
    Fetch_UnknownElementNone: "<{0}> is not a FetchXML element, and <{1}> takes no elements",
    Fetch_Misplaced: "<{0}> cannot go in <{1}> — it takes {2}",
    Fetch_MisplacedNone: "<{0}> cannot go in <{1}>, which takes no elements",
    Fetch_SecondEntity: "A query has one <entity>; join more tables with <link-entity>",
    Fetch_UnknownAttribute: "<{0}> has no \"{1}\" attribute — Dataverse ignores it",
    Fetch_UnknownOperator: "Unknown operator \"{0}\"",
    Fetch_NotInList: "\"{0}\" is not one of {1}",
    Fetch_WholeNumber: "\"{0}\" takes a whole number",
    Fetch_NoAlias: "No link-entity is named or aliased \"{0}\"",
    Fetch_NeedsAttribute: "<{0}> needs a \"{1}\"",
    Fetch_NoTable: "There is no table \"{0}\" in this environment",
    Fetch_NoColumn: "{0} has no column \"{1}\"",
    Fetch_NotReadable: "{0}.{1} is not valid for read — Dataverse refuses it",
    Fetch_NotAnOption: "{0} is not an option of {1}.{2}"
};

export function said(key: string, ...args: Arg[]): Said {
    return { key, args };
}

/**
 * Several messages separated by commas — the "a, b" before "or c". Its key is
 * empty: there is nothing to translate but the items.
 */
export function list(...items: Arg[]): Said {
    return { key: "", args: items };
}

/**
 * Fill a template's `{0}`, `{1}`… — every occurrence, unlike a single
 * `replace` — rendering each argument that is a message of its own first.
 */
export function render(s: Said, lookup: (key: string) => string | null): string {
    if (s.key === "") {
        return s.args.map((a) => (typeof a === "string" ? a : render(a, lookup))).join(", ");
    }
    const template = lookup(s.key) ?? ENGLISH[s.key] ?? s.key;
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const arg = s.args[Number(index)];
        return arg === undefined ? whole : typeof arg === "string" ? arg : render(arg, lookup);
    });
}

/** The English of a message. */
export function english(s: Said): string {
    return render(s, () => null);
}

/** A message the control wrote: its English, and its key and arguments. */
export function worded(key: string, ...args: Arg[]): Worded {
    const s = said(key, ...args);
    return { message: english(s), key: s.key, args: s.args };
}

/** A message passed through as it came: no key, nothing to translate. */
export function raw(message: string): Worded {
    return { message };
}
