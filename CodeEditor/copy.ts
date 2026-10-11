/**
 * Put a line of text on the clipboard: the Clipboard API, and
 * `execCommand('copy')` when the browser refuses it.
 *
 * Two paths because one was refused everywhere the 1.6.9 probe asked (SPEC.md,
 * P3): on the form and in the harness, `navigator.clipboard.writeText` threw
 * *NotAllowedError: Write permission denied* from a click and from a keydown
 * alike, in a secure, unframed page whose policy allows `clipboard-write` —
 * the browser's permission, not the host's — and `execCommand('copy')` wrote
 * every time. PCFHub's demo frame refuses the API by its sandbox, and the
 * older command is not gated by it (`pcf-copy-field`'s SPEC). Which path a
 * desktop Edge or Chrome takes is not measured; either way the text lands.
 *
 * Call it from the press itself — a click or a keydown — or both paths refuse.
 */

/** Whether this browser has either way to write the clipboard. */
export function canCopy(doc: Document): boolean {
    const nav = doc.defaultView?.navigator;
    if (typeof nav?.clipboard?.writeText === "function") {
        return true;
    }
    try {
        return typeof doc.queryCommandSupported === "function" && doc.queryCommandSupported("copy");
    } catch {
        return false;
    }
}

/** Copy `text`, and say which path wrote it, or null when neither did. Focus goes back where it was. */
export async function copyText(text: string, doc: Document): Promise<"api" | "exec" | null> {
    const nav = doc.defaultView?.navigator;
    if (typeof nav?.clipboard?.writeText === "function") {
        try {
            await nav.clipboard.writeText(text);
            return "api";
        } catch {
            // Refused: the older command below.
        }
    }
    return copyWithCommand(text, doc) ? "exec" : null;
}

function copyWithCommand(text: string, doc: Document): boolean {
    const back = doc.activeElement as HTMLElement | null;
    // Selectable, so not display:none; off-screen, so nobody sees it.
    const scratch = doc.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.setAttribute("aria-hidden", "true");
    scratch.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    doc.body.append(scratch);
    scratch.select();
    let ok = false;
    try {
        ok = doc.execCommand("copy");
    } catch {
        ok = false;
    }
    scratch.remove();
    // Selecting moved focus into the textarea; a keyboard user goes back to the tree.
    back?.focus();
    return ok;
}
