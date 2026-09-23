// Format Document for XML, with no DOM and no Monaco.
//
// Re-indentation only, and only where whitespace cannot be content. The
// documents this control holds are FetchXML, ribbon definitions, Word
// template parts and integration payloads, and each of them has somewhere a
// text node where a space is data. So the rule is structural rather than
// clever:
//
//   - An element whose children are elements, comments and processing
//     instructions (with whitespace between them) is laid out one child per
//     line, indented.
//   - An element holding any text or CDATA — text-only or mixed — is written
//     back exactly as it was, from its opening `<` to its closing `>`.
//   - So is anything under `xml:space="preserve"`.
//   - Tags are never rewritten: attribute order, quoting and line breaks
//     inside a tag stay the author's.
//
// A document that does not read as well-formed here is not formatted at all
// (`formatXml` returns null); the caller has already shown why through
// `validateXml`. `dev/smoke.js` asserts that formatting twice changes nothing
// and that every document keeps its tree.

export interface XmlFormatOptions {
    tabSize: number;
    insertSpaces: boolean;
    eol?: string;
}

export type XmlNode =
    | { type: "element"; name: string; open: string; close: string; children: XmlNode[]; start: number; end: number; preserve: boolean }
    | { type: "text" | "cdata" | "comment" | "pi" | "doctype"; raw: string };

/** The document as a list of top-level nodes, or null where it is not well-formed. */
export function readXml(text: string): XmlNode[] | null {
    const root: XmlNode[] = [];
    const stack: Extract<XmlNode, { type: "element" }>[] = [];
    const push = (node: XmlNode) => (stack.length > 0 ? stack[stack.length - 1].children : root).push(node);

    let i = 0;
    while (i < text.length) {
        if (text[i] !== "<") {
            const next = text.indexOf("<", i);
            const end = next === -1 ? text.length : next;
            push({ type: "text", raw: text.slice(i, end) });
            i = end;
            continue;
        }

        if (text.startsWith("<!--", i)) {
            const end = text.indexOf("-->", i + 4);
            if (end === -1) {
                return null;
            }
            push({ type: "comment", raw: text.slice(i, end + 3) });
            i = end + 3;
        } else if (text.startsWith("<![CDATA[", i)) {
            const end = text.indexOf("]]>", i + 9);
            if (end === -1) {
                return null;
            }
            push({ type: "cdata", raw: text.slice(i, end + 3) });
            i = end + 3;
        } else if (text.startsWith("<?", i)) {
            const end = text.indexOf("?>", i + 2);
            if (end === -1) {
                return null;
            }
            push({ type: "pi", raw: text.slice(i, end + 2) });
            i = end + 2;
        } else if (text.startsWith("<!", i)) {
            // DOCTYPE, with an internal subset in brackets that may hold '>'.
            let depth = 0;
            let j = i + 2;
            for (; j < text.length; j++) {
                const c = text[j];
                if (c === "[") {
                    depth++;
                } else if (c === "]") {
                    depth--;
                } else if (c === ">" && depth <= 0) {
                    break;
                }
            }
            if (j >= text.length) {
                return null;
            }
            push({ type: "doctype", raw: text.slice(i, j + 1) });
            i = j + 1;
        } else if (text[i + 1] === "/") {
            const end = text.indexOf(">", i);
            if (end === -1) {
                return null;
            }
            const name = text.slice(i + 2, end).trim();
            const open = stack.pop();
            if (!open || open.name !== name) {
                return null;
            }
            open.close = text.slice(i, end + 1);
            open.end = end + 1;
            i = end + 1;
        } else {
            const end = tagEnd(text, i);
            if (end === -1) {
                return null;
            }
            const tag = text.slice(i, end + 1);
            const name = /^<([^\s/>]+)/.exec(tag)?.[1];
            if (!name) {
                return null;
            }
            const inherited = stack.length > 0 && stack[stack.length - 1].preserve;
            const preserve = inherited || /\sxml:space\s*=\s*["']preserve["']/.test(tag);
            const element = { type: "element" as const, name, open: tag, close: "", children: [], start: i, end: end + 1, preserve };
            push(element);
            if (!tag.endsWith("/>")) {
                stack.push(element);
            }
            i = end + 1;
        }
    }

    return stack.length === 0 ? root : null;
}

/** The `>` closing the tag that opens at `start`, skipping quoted attribute values. */
function tagEnd(text: string, start: number): number {
    let quote: string | null = null;
    for (let j = start + 1; j < text.length; j++) {
        const c = text[j];
        if (quote) {
            if (c === quote) {
                quote = null;
            }
        } else if (c === "\"" || c === "'") {
            quote = c;
        } else if (c === ">") {
            return j;
        } else if (c === "<") {
            return -1;
        }
    }
    return -1;
}

/**
 * The formatted document, or null when it cannot be formatted safely. An
 * unchanged document comes back unchanged, so the caller can compare.
 */
export function formatXml(text: string, options: XmlFormatOptions): string | null {
    const nodes = readXml(text);
    if (!nodes) {
        return null;
    }
    const eol = options.eol ?? (text.includes("\r\n") ? "\r\n" : "\n");
    const unit = options.insertSpaces ? " ".repeat(Math.max(1, options.tabSize)) : "\t";

    const lines: string[] = [];
    const write = (list: XmlNode[], depth: number) => {
        for (const node of list) {
            if (node.type === "text") {
                // Only reached for whitespace between structural nodes: a
                // parent holding real text is written verbatim instead.
                if (node.raw.trim() !== "") {
                    lines.push(unit.repeat(depth) + node.raw.trim());
                }
                continue;
            }
            if (node.type !== "element") {
                lines.push(unit.repeat(depth) + node.raw);
                continue;
            }
            if (node.close === "") {
                lines.push(unit.repeat(depth) + node.open);
            } else if (isVerbatim(node)) {
                lines.push(unit.repeat(depth) + text.slice(node.start, node.end));
            } else {
                lines.push(unit.repeat(depth) + node.open);
                write(node.children, depth + 1);
                lines.push(unit.repeat(depth) + node.close);
            }
        }
    };
    write(nodes, 0);

    return lines.join(eol) + (/\r?\n\s*$/.test(text) ? eol : "");
}

/**
 * An element written back as it was: it holds text or CDATA somewhere among
 * its own children, sits under xml:space="preserve", or has no children at
 * all (`<a></a>` and `<a> </a>` both stay as they are).
 */
function isVerbatim(node: Extract<XmlNode, { type: "element" }>): boolean {
    if (node.preserve || node.children.length === 0) {
        return true;
    }
    const structural = node.children.filter((c) => !(c.type === "text" && c.raw.trim() === ""));
    if (structural.length === 0) {
        return true;
    }
    return node.children.some((c) => c.type === "cdata" || (c.type === "text" && c.raw.trim() !== ""));
}
