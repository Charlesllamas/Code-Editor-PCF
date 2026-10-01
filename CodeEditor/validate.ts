// Validation on the main thread.
//
// Monaco's own language services run in web workers, and PCF serves a control
// as one JavaScript file with no way to ship the worker beside it — so under
// this control they never start, and a malformed document was coloured but not
// flagged (docs/limitations.md, 1.1.0). What this file does instead is the
// half of validation that needs no worker: a strict JSON parse through
// jsonc-parser, which reports every fault with an offset, and an XML parse
// through the browser's DOMParser, which reports the first fault as text.
//
// No Monaco import, deliberately. `dev/smoke.js` drives this file in Node,
// where the bundle cannot load, so everything here takes plain values and
// hands back plain values; `index.ts` turns a Problem into a marker.

import { parse, printParseErrorCode, ParseError, ParseErrorCode } from "jsonc-parser";
import { Arg, worded } from "./messages";

export interface Problem {
    /** 1-based, the way Monaco and people count. */
    line: number;
    column: number;
    /** How many characters the marker covers; at least 1. */
    length: number;
    /** The English; `key` and `args` render it in the user's language (messages.ts). */
    message: string;
    key?: string;
    args?: Arg[];
    /**
     * An error unless it says otherwise. A warning is marked and named but
     * does not count against `isValid` or in `problemCount` — FetchXML's
     * names the environment does not know (1.5.0).
     */
    severity?: "error" | "warning";
}

/** Which languages this file can validate. Anything else gets no markers. */
export function hasValidator(language: string): boolean {
    return language === "json" || language === "xml" || language === "fetchxml";
}

/** Whether a problem counts against the verdict. */
export function isError(problem: Problem): boolean {
    return problem.severity !== "warning";
}

/* ------------------------------------------------------------------ JSON */

// jsonc-parser names its errors after what the parser expected, which reads
// as a stack trace. These are what an author reads — by resx key, the English
// in messages.ts.
const JSON_MESSAGES: Partial<Record<ParseErrorCode, string>> = {
    [ParseErrorCode.InvalidSymbol]: "Json_UnexpectedCharacter",
    [ParseErrorCode.InvalidNumberFormat]: "Json_InvalidNumber",
    [ParseErrorCode.PropertyNameExpected]: "Json_PropertyNameExpected",
    [ParseErrorCode.ValueExpected]: "Json_ValueExpected",
    [ParseErrorCode.ColonExpected]: "Json_ColonExpected",
    [ParseErrorCode.CommaExpected]: "Json_CommaExpected",
    [ParseErrorCode.CloseBraceExpected]: "Json_CloseBraceExpected",
    [ParseErrorCode.CloseBracketExpected]: "Json_CloseBracketExpected",
    [ParseErrorCode.EndOfFileExpected]: "Json_EndOfFileExpected",
    [ParseErrorCode.InvalidCommentToken]: "Json_CommentNotAllowed",
    [ParseErrorCode.UnexpectedEndOfComment]: "Json_UnterminatedComment",
    [ParseErrorCode.UnexpectedEndOfString]: "Json_UnterminatedString",
    [ParseErrorCode.UnexpectedEndOfNumber]: "Json_UnterminatedNumber",
    [ParseErrorCode.InvalidUnicode]: "Json_InvalidUnicode",
    [ParseErrorCode.InvalidEscapeCharacter]: "Json_InvalidEscape",
    [ParseErrorCode.InvalidCharacter]: "Json_InvalidCharacter"
};

/**
 * Strict JSON: no comments, no trailing commas — the column is usually read
 * by an integration that will not forgive either. An empty document is not a
 * fault; an empty column is a normal state.
 */
export function validateJson(text: string): Problem[] {
    if (text.trim() === "") {
        return [];
    }

    const errors: ParseError[] = [];
    parse(text, errors, { allowTrailingComma: false, disallowComments: true, allowEmptyContent: true });

    // A trailing comma reports "property name expected" and "value expected"
    // at the same offset; one marker per position is what a reader wants.
    const seen = new Set<number>();
    const problems: Problem[] = [];
    for (const error of errors) {
        if (seen.has(error.offset)) {
            continue;
        }
        seen.add(error.offset);
        const at = positionAt(text, error.offset);
        problems.push({
            line: at.line,
            column: at.column,
            length: Math.max(1, error.length),
            // The parser sees a trailing comma as "a value should be here";
            // the author sees a comma that should not.
            ...(isTrailingComma(text, error.offset)
                ? worded("Json_TrailingComma")
                : JSON_MESSAGES[error.error] ? worded(JSON_MESSAGES[error.error] as string) : { message: printParseErrorCode(error.error) })
        });
    }
    return problems;
}

/** A closing bracket at `offset` whose previous non-blank character is a comma. */
function isTrailingComma(text: string, offset: number): boolean {
    const closer = text[offset];
    if (closer !== "}" && closer !== "]") {
        return false;
    }
    let i = offset - 1;
    while (i >= 0 && /\s/.test(text[i])) {
        i--;
    }
    return i >= 0 && text[i] === ",";
}

/* ------------------------------------------------------------------- XML */

/**
 * `DOMParser` reports a fault as a `<parsererror>` element whose text names
 * the line and column — in a different sentence per browser. `parseError`
 * is that text, or `null` for a well-formed document; the caller owns the
 * DOMParser so this stays runnable where there is none.
 */
export function validateXml(text: string, parseError: (text: string) => string | null): Problem[] {
    if (text.trim() === "") {
        return [];
    }
    const message = parseError(text);
    if (message === null) {
        return [];
    }
    return [describeXmlError(message)];
}

/**
 * The three shapes measured, each with the position in a different place:
 *
 *   Chrome  "error on line 3 at column 7: Opening and ending tag mismatch: a line 2 and b"
 *   Firefox "XML Parsing Error: mismatched tag. Expected: </a>.\nLocation: …\nLine Number 3, Column 7:"
 *   Safari  "error on line 3 at column 7: …" (WebKit shares Chrome's libxml2 text)
 *
 * Anything else is marked at 1:1 with the text as it came, which is still a
 * squiggle rather than silence.
 */
export function describeXmlError(message: string): Problem {
    // Chrome wraps libxml2's line in page boilerplate on both sides.
    const flat = message
        .replace(/\s+/g, " ")
        .replace(/This page contains the following errors:\s*/i, "")
        .replace(/\s*Below is a rendering of the page up to the first error\.?.*$/i, "")
        .trim();

    const chrome = /line (\d+) at column (\d+):\s*(.*)$/i.exec(flat);
    if (chrome) {
        return { line: Number(chrome[1]), column: Number(chrome[2]), length: 1, ...tidy(chrome[3]) };
    }

    const firefox = /^(?:XML Parsing Error:\s*)?(.*?)\s*Location:.*?Line Number (\d+), Column (\d+)/i.exec(flat);
    if (firefox) {
        return { line: Number(firefox[2]), column: Number(firefox[3]), length: 1, ...tidy(firefox[1]) };
    }

    return { line: 1, column: 1, length: 1, ...tidy(flat) };
}

/**
 * The browser's own sentence, passed through as it came — there is no key to
 * translate it by — or, where it says nothing, the control's own.
 */
function tidy(message: string): { message: string; key?: string; args?: Arg[] } {
    // libxml2 repeats the whole sentence as a "below is a rendering" block in
    // Chrome; the first sentence is the message.
    const first = message.split(/\.\s|\n/)[0].trim();
    return first === "" ? worded("Xml_NotWellFormed") : { message: first };
}

/* --------------------------------------------------------------- helpers */

/** 1-based line and column of a 0-based offset, counting `\n` only. */
export function positionAt(text: string, offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < clamped; i++) {
        if (text.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, column: clamped - lineStart + 1 };
}
