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

export interface Problem {
    /** 1-based, the way Monaco and people count. */
    line: number;
    column: number;
    /** How many characters the marker covers; at least 1. */
    length: number;
    message: string;
}

/** Which languages this file can validate. Anything else gets no markers. */
export function hasValidator(language: string): boolean {
    return language === "json" || language === "xml";
}

/* ------------------------------------------------------------------ JSON */

// jsonc-parser names its errors after what the parser expected, which reads
// as a stack trace. These are what an author reads.
const JSON_MESSAGES: Partial<Record<ParseErrorCode, string>> = {
    [ParseErrorCode.InvalidSymbol]: "Unexpected character",
    [ParseErrorCode.InvalidNumberFormat]: "Invalid number",
    [ParseErrorCode.PropertyNameExpected]: "Expected a property name in double quotes",
    [ParseErrorCode.ValueExpected]: "Expected a value",
    [ParseErrorCode.ColonExpected]: "Expected ':'",
    [ParseErrorCode.CommaExpected]: "Expected ',' or a closing bracket",
    [ParseErrorCode.CloseBraceExpected]: "Expected '}'",
    [ParseErrorCode.CloseBracketExpected]: "Expected ']'",
    [ParseErrorCode.EndOfFileExpected]: "Unexpected content after the end of the document",
    [ParseErrorCode.InvalidCommentToken]: "Comments are not allowed in JSON",
    [ParseErrorCode.UnexpectedEndOfComment]: "Unterminated comment",
    [ParseErrorCode.UnexpectedEndOfString]: "Unterminated string",
    [ParseErrorCode.UnexpectedEndOfNumber]: "Unterminated number",
    [ParseErrorCode.InvalidUnicode]: "Invalid unicode escape",
    [ParseErrorCode.InvalidEscapeCharacter]: "Invalid escape character",
    [ParseErrorCode.InvalidCharacter]: "Invalid character in string"
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
            message: isTrailingComma(text, error.offset)
                ? "Trailing comma is not allowed"
                : JSON_MESSAGES[error.error] ?? printParseErrorCode(error.error)
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
        return { line: Number(chrome[1]), column: Number(chrome[2]), length: 1, message: tidy(chrome[3]) };
    }

    const firefox = /^(?:XML Parsing Error:\s*)?(.*?)\s*Location:.*?Line Number (\d+), Column (\d+)/i.exec(flat);
    if (firefox) {
        return { line: Number(firefox[2]), column: Number(firefox[3]), length: 1, message: tidy(firefox[1]) };
    }

    return { line: 1, column: 1, length: 1, message: tidy(flat) };
}

function tidy(message: string): string {
    // libxml2 repeats the whole sentence as a "below is a rendering" block in
    // Chrome; the first sentence is the message.
    const first = message.split(/\.\s|\n/)[0].trim();
    return first === "" ? "The document is not well-formed XML" : first;
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
