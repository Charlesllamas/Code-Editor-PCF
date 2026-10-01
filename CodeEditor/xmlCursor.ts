// An XML document read the way somebody half-way through typing it wrote
// it — for completion, hover and the FetchXML checks — and where the caret
// is in it.
//
// `formatXml.ts`'s reader is strict on purpose: it formats only what is
// well-formed, and returns null otherwise. This one never gives up. A tag
// still being typed is ended at the next `<` (so `<attribute name="` on one
// line and `</entity>` on the next is a tag and a close, not one long
// attribute value); an unclosed quote ends there too, or at the line's end; a close tag that
// matches nothing open is set aside; an element never closed runs to the end
// of the document. `formatXml.ts`'s `tagEnd` lets an unclosed quote run to
// the end of the text, which is right for a document that must be whole and
// wrong for the one being typed — hence a scanner of its own.
//
// Offsets in, offsets out. No Monaco import, and no DOM: `dev/smoke.js`
// drives this in Node.

export interface XmlAttr {
    name: string;
    nameStart: number;
    nameEnd: number;
    /** The text between the quotes; null for an attribute typed without `=`. */
    value: string | null;
    /** The value's range, inside the quotes. */
    valueStart: number;
    valueEnd: number;
    /** Whether the closing quote was typed. */
    closed: boolean;
}

export interface XmlElement {
    name: string;
    /** The `<`. */
    start: number;
    nameStart: number;
    nameEnd: number;
    /** Just past the `>` or `/>`; -1 while the tag is still being typed. */
    openEnd: number;
    /** Where the tag's text stops: its `>`, or the `<` that cut it short. */
    tagLimit: number;
    selfClosing: boolean;
    attrs: XmlAttr[];
    /** Index into `elements`, or -1 at the top. */
    parent: number;
    children: number[];
    /** Where the content starts and stops: the close tag's `<`, or the end. */
    contentStart: number;
    contentEnd: number;
    /** Just past the close tag (or the `/>`); `contentEnd` when it was never closed. */
    end: number;
    closed: boolean;
}

export interface XmlCloseTag {
    name: string;
    start: number;
    nameStart: number;
    nameEnd: number;
    /** The element it closed, or -1 when it closed nothing. */
    element: number;
}

/** Comments, CDATA, processing instructions and a DOCTYPE: nowhere to complete. */
export interface XmlOpaque {
    start: number;
    end: number;
}

export interface XmlDoc {
    elements: XmlElement[];
    closes: XmlCloseTag[];
    opaque: XmlOpaque[];
    roots: number[];
}

const NAME = /[^\s<>/="']/;

export function scanXml(text: string): XmlDoc {
    const doc: XmlDoc = { elements: [], closes: [], opaque: [], roots: [] };
    const stack: number[] = [];
    let i = 0;

    const opaque = (open: string, close: string): boolean => {
        if (!text.startsWith(open, i)) {
            return false;
        }
        const end = text.indexOf(close, i + open.length);
        const stop = end === -1 ? text.length : end + close.length;
        doc.opaque.push({ start: i, end: stop });
        i = stop;
        return true;
    };

    while (i < text.length) {
        if (text[i] !== "<") {
            const next = text.indexOf("<", i);
            i = next === -1 ? text.length : next;
            continue;
        }
        if (opaque("<!--", "-->") || opaque("<![CDATA[", "]]>") || opaque("<?", "?>") || opaque("<!", ">")) {
            continue;
        }

        if (text[i + 1] === "/") {
            let j = i + 2;
            while (j < text.length && NAME.test(text[j])) {
                j++;
            }
            const name = text.slice(i + 2, j);
            const gt = text.indexOf(">", j);
            const lt = text.indexOf("<", j);
            const end = gt !== -1 && (lt === -1 || gt < lt) ? gt + 1 : (lt === -1 ? text.length : lt);
            // The innermost open element of that name, closing everything inside it.
            let match = -1;
            for (let s = stack.length - 1; s >= 0; s--) {
                if (doc.elements[stack[s]].name === name) {
                    match = s;
                    break;
                }
            }
            const closedIndex = match === -1 ? -1 : stack[match];
            if (match !== -1) {
                // Anything still open inside it ends here too, unclosed.
                for (let s = match; s < stack.length; s++) {
                    doc.elements[stack[s]].contentEnd = i;
                    doc.elements[stack[s]].end = i;
                }
                const element = doc.elements[closedIndex];
                element.closed = true;
                element.end = end;
                stack.length = match;
            }
            doc.closes.push({ name, start: i, nameStart: i + 2, nameEnd: j, element: closedIndex });
            i = end;
            continue;
        }

        // An opening tag, perhaps still being typed.
        let j = i + 1;
        while (j < text.length && NAME.test(text[j])) {
            j++;
        }
        const index = doc.elements.length;
        const parent = stack.length > 0 ? stack[stack.length - 1] : -1;
        const element: XmlElement = {
            name: text.slice(i + 1, j),
            start: i,
            nameStart: i + 1,
            nameEnd: j,
            openEnd: -1,
            tagLimit: text.length,
            selfClosing: false,
            attrs: [],
            parent,
            children: [],
            contentStart: text.length,
            contentEnd: text.length,
            end: text.length,
            closed: false
        };
        doc.elements.push(element);
        if (parent === -1) {
            doc.roots.push(index);
        } else {
            doc.elements[parent].children.push(index);
        }

        // Attributes, until the tag ends or the next tag begins.
        while (j < text.length) {
            const c = text[j];
            if (c === ">") {
                element.openEnd = j + 1;
                element.tagLimit = j;
                break;
            }
            if (c === "/" && text[j + 1] === ">") {
                element.openEnd = j + 2;
                element.tagLimit = j;
                element.selfClosing = true;
                break;
            }
            if (c === "<") {
                element.tagLimit = j;
                break;
            }
            if (!NAME.test(c)) {
                j++;
                continue;
            }
            const nameStart = j;
            while (j < text.length && NAME.test(text[j])) {
                j++;
            }
            const attr: XmlAttr = { name: text.slice(nameStart, j), nameStart, nameEnd: j, value: null, valueStart: j, valueEnd: j, closed: false };
            let k = j;
            while (k < text.length && /\s/.test(text[k])) {
                k++;
            }
            if (text[k] === "=") {
                k++;
                while (k < text.length && /\s/.test(text[k])) {
                    k++;
                }
                const quote = text[k];
                if (quote === "\"" || quote === "'") {
                    const close = text.indexOf(quote, k + 1);
                    const cut = text.indexOf("<", k + 1);
                    const closed = close !== -1 && (cut === -1 || close < cut);
                    // Unclosed, the value is the one being typed: it stops at
                    // the line's end as well as at the next tag.
                    const line = text.slice(k + 1).search(/[\r\n]/);
                    const open = Math.min(cut === -1 ? text.length : cut, line === -1 ? text.length : k + 1 + line);
                    const end = closed ? close : open;
                    attr.valueStart = k + 1;
                    attr.valueEnd = end;
                    attr.value = text.slice(k + 1, end);
                    attr.closed = closed;
                    j = closed ? close + 1 : end;
                } else {
                    // `name=` and nothing yet: the value starts where the caret will be.
                    attr.valueStart = k;
                    attr.valueEnd = k;
                    attr.value = "";
                    j = k;
                }
            }
            element.attrs.push(attr);
        }
        if (element.openEnd === -1 && j >= text.length) {
            element.tagLimit = text.length;
        }

        if (element.openEnd !== -1 && !element.selfClosing) {
            element.contentStart = element.openEnd;
            stack.push(index);
        } else if (element.openEnd === -1) {
            // Still being typed: it holds nothing yet, and what follows stays
            // its parent's — or a half-typed tag would adopt its siblings.
            element.contentStart = element.tagLimit;
            element.contentEnd = element.tagLimit;
            element.end = element.tagLimit;
        } else {
            element.closed = true;
            element.contentStart = element.openEnd;
            element.contentEnd = element.openEnd;
            element.end = element.openEnd;
        }
        i = element.openEnd !== -1 ? element.openEnd : element.tagLimit;
    }
    return doc;
}

/* ----------------------------------------------------------------- caret */

export type Place =
    /** In a tag's name. `start`–`end` is the whole name; `parent` is where the element sits. */
    | { kind: "elementName"; element: number; parent: number; start: number; end: number; tagHasMore: boolean }
    /** In a close tag's name, or just after `</`. `open` is the element it should close. */
    | { kind: "closeTag"; open: number; start: number; end: number }
    /** Inside a tag, where an attribute name goes. `start`–`end` is the name under the caret, if any. */
    | { kind: "attributeName"; element: number; attr: number; start: number; end: number }
    /** Inside an attribute's quotes. */
    | { kind: "attributeValue"; element: number; attr: number; start: number; end: number; closed: boolean }
    /** In an element's content. */
    | { kind: "text"; element: number; start: number; end: number }
    | { kind: "none" };

export function placeAt(doc: XmlDoc, text: string, offset: number): Place {
    if (doc.opaque.some((o) => offset > o.start && offset < o.end)) {
        return { kind: "none" };
    }

    for (const close of doc.closes) {
        if (offset >= close.nameStart && offset <= close.nameEnd) {
            return { kind: "closeTag", open: openAt(doc, close.start), start: close.nameStart, end: close.nameEnd };
        }
    }

    // The tag the caret is inside, innermost last — tags do not nest, so at most one.
    for (let index = 0; index < doc.elements.length; index++) {
        const e = doc.elements[index];
        const limit = e.tagLimit;
        if (offset <= e.start || offset > limit) {
            continue;
        }
        if (offset <= e.nameEnd) {
            return { kind: "elementName", element: index, parent: e.parent, start: e.nameStart, end: e.nameEnd, tagHasMore: e.attrs.length > 0 || e.openEnd !== -1 };
        }
        for (let a = 0; a < e.attrs.length; a++) {
            const attr = e.attrs[a];
            if (attr.value !== null && offset >= attr.valueStart && offset <= attr.valueEnd && (attr.valueStart < attr.valueEnd || text[attr.valueStart - 1] === "\"" || text[attr.valueStart - 1] === "'")) {
                return { kind: "attributeValue", element: index, attr: a, start: attr.valueStart, end: attr.valueEnd, closed: attr.closed };
            }
            if (offset >= attr.nameStart && offset <= attr.nameEnd) {
                return { kind: "attributeName", element: index, attr: a, start: attr.nameStart, end: attr.nameEnd };
            }
        }
        // Between attributes, or just before the `>`: a new one goes here.
        return { kind: "attributeName", element: index, attr: -1, start: offset, end: offset };
    }

    // A `</` with nothing after it yet reads as a close of nothing above;
    // a lone `<` is an element with an empty name, handled as a tag.
    const content = innermostContent(doc, offset);
    return content === -1 ? { kind: "none" } : { kind: "text", element: content, start: offset, end: offset };
}

/** The innermost element whose content holds `offset`, or -1. */
export function innermostContent(doc: XmlDoc, offset: number): number {
    let found = -1;
    for (let index = 0; index < doc.elements.length; index++) {
        const e = doc.elements[index];
        if (offset >= e.contentStart && offset <= e.contentEnd && !e.selfClosing && e.openEnd !== -1) {
            found = index;
        }
    }
    return found;
}

/** The element still open at `offset` — what a `</` there should close. */
function openAt(doc: XmlDoc, offset: number): number {
    let found = -1;
    for (let index = 0; index < doc.elements.length; index++) {
        const e = doc.elements[index];
        if (!e.selfClosing && e.openEnd !== -1 && e.contentStart <= offset && offset <= e.contentEnd) {
            found = index;
        }
    }
    return found;
}

/** An element's attribute by name, or undefined. */
export function attrOf(element: XmlElement, name: string): XmlAttr | undefined {
    return element.attrs.find((a) => a.name === name);
}

/** The text an element holds, outside its child tags — what a `<value>` says. */
export function textOf(doc: XmlDoc, text: string, index: number): string {
    const e = doc.elements[index];
    if (e.selfClosing || e.contentStart >= e.contentEnd) {
        return "";
    }
    let out = "";
    let at = e.contentStart;
    for (const child of e.children) {
        out += text.slice(at, doc.elements[child].start);
        at = doc.elements[child].end;
    }
    out += text.slice(at, e.contentEnd);
    return out;
}
