/*
 * Real key presses, sent to headless Chrome over the DevTools protocol — the
 * keyboard half of what `dev/cdp.js` already does for the mouse and the page.
 *
 * **Why this exists.** `dev/dom.js` models no `keydown` and no bubbling, so the
 * suite can drive a key map only as a pure function (state, key) → state. That
 * proves the map; it does not prove that the control listens on the element
 * that has focus, that a press reaches it through a parent, that focus is
 * where `aria-activedescendant` says it is, or that the browser's own default
 * action for the key was stopped. A press through the protocol is a press: the
 * browser routes it to the focused element in whatever frame holds focus,
 * bubbles it, and runs the default action when nobody prevents it.
 *
 *     const { launch } = require('./cdp');
 *     const { press, type, focused } = require('./keys');
 *     const chrome = await launch({ width: 1280, height: 900 });
 *     await chrome.navigate('http://localhost:8080/dev/harness.html');
 *     await chrome.evaluate(`document.querySelector('[role=tree]').focus()`);
 *     await press(chrome, 'ArrowDown');
 *     await press(chrome, 'c', { modifiers: ['Control'] });
 *     await type(chrome, 'na');
 *     const now = await focused(chrome);   // role, id, aria-activedescendant, …
 *
 * **What it does not do.** It does not focus anything: put focus where a user
 * would — a click, a Tab, or `element.focus()` — first. A key pressed with
 * focus on `<body>` goes to the page, which is a test of nothing. And a host's
 * own shortcuts are not here: a form, a canvas player and the hub's demo each
 * take some keys before a control sees them, which only the host can show.
 */

'use strict';

const { sleep } = require('./cdp');

/** Modifier names → the protocol's bit mask. */
const MODIFIERS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Command: 4, Shift: 8 };

/**
 * The named keys: what a browser reports for each — `key`, `code`, the legacy
 * `keyCode` (`windowsVirtualKeyCode` here) — and the text it types, if any.
 */
const NAMED = {
    ArrowUp: { code: 'ArrowUp', keyCode: 38 },
    ArrowDown: { code: 'ArrowDown', keyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
    ArrowRight: { code: 'ArrowRight', keyCode: 39 },
    Home: { code: 'Home', keyCode: 36 },
    End: { code: 'End', keyCode: 35 },
    PageUp: { code: 'PageUp', keyCode: 33 },
    PageDown: { code: 'PageDown', keyCode: 34 },
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { code: 'Tab', keyCode: 9 },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
    Delete: { code: 'Delete', keyCode: 46 },
    F2: { code: 'F2', keyCode: 113 },
    ' ': { code: 'Space', keyCode: 32, text: ' ' },
    Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    // The keypad's, which is what a press of * reports on most layouts' own key too.
    '*': { code: 'NumpadMultiply', keyCode: 106, text: '*' },
};

/** A key's full description: a named key from the table, or one printable character. */
function describe(key) {
    const named = NAMED[key];

    if (named) {
        return { key: named.key || key, code: named.code, keyCode: named.keyCode, text: named.text };
    }

    if ([...key].length !== 1) {
        throw new Error(`keys.js does not know the key "${key}". Name one of ${Object.keys(NAMED).join(', ')}, or one character.`);
    }

    const upper = key.toUpperCase();

    if (/^[A-Z]$/.test(upper)) {
        return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key };
    }

    if (/^[0-9]$/.test(key)) {
        return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key };
    }

    // Punctuation and anything else: the character is what a listener reads;
    // `code` depends on the layout, so it is left empty rather than guessed.
    return { key, code: '', keyCode: 0, text: key };
}

/**
 * Press and release `key` — `'ArrowDown'`, `'Enter'`, `'*'`, `'a'`.
 *
 * - `modifiers`: `['Control']`, `['Shift']`, … held for the press. With
 *   Control, Alt or Meta held the key types nothing, as on a real keyboard.
 * - `times`: presses in a row.
 * - `wait`: ms after each press, for a render that follows it (default 50 —
 *   a key handler is synchronous, a React commit or a requestAnimationFrame
 *   is not).
 * - `sessionId`: an out-of-process frame's session. The page's own session
 *   is right for almost everything: the browser sends a key to whichever
 *   frame holds focus.
 */
async function press(chrome, key, options = {}) {
    const { modifiers = [], times = 1, wait = 50, sessionId } = options;
    const mask = modifiers.reduce((bits, name) => {
        if (!(name in MODIFIERS)) {
            throw new Error(`keys.js does not know the modifier "${name}". Use ${Object.keys(MODIFIERS).join(', ')}.`);
        }

        return bits | MODIFIERS[name];
    }, 0);
    const described = describe(key);
    // Shift alone still types (it chose the character); the others turn the key into a shortcut.
    const text = mask & (MODIFIERS.Alt | MODIFIERS.Control | MODIFIERS.Meta) ? undefined : described.text;
    const base = {
        key: described.key,
        code: described.code,
        windowsVirtualKeyCode: described.keyCode,
        nativeVirtualKeyCode: described.keyCode,
        modifiers: mask,
    };
    const send = (params) => (sessionId ? chrome.send('Input.dispatchKeyEvent', params, sessionId) : chrome.send('Input.dispatchKeyEvent', params));

    for (let i = 0; i < times; i += 1) {
        // A key that types is `keyDown` with its text (keydown, keypress, input);
        // one that does not is `rawKeyDown` (keydown only) — Chrome's own split.
        await send({ ...base, type: text ? 'keyDown' : 'rawKeyDown', ...(text ? { text, unmodifiedText: text } : {}) });
        await send({ ...base, type: 'keyUp' });

        if (wait > 0) {
            await sleep(wait);
        }
    }
}

/** Type `text` one character at a time, as presses — what a type-ahead or a text box hears. */
async function type(chrome, text, options = {}) {
    for (const character of text) {
        await press(chrome, character, options);
    }
}

/**
 * Where focus is, and what it points at: the focused element's tag, `role`,
 * `id` and accessible label, and — when it names one with
 * `aria-activedescendant` — that element's `id`, `role`, text and its
 * `aria-expanded`, `aria-selected`, `aria-level`, `aria-setsize` and
 * `aria-posinset`. A same-origin frame that holds focus is followed into.
 *
 * `frame`: the URL fragment of an out-of-process frame to read inside (the
 * hub's demo), passed to `chrome.inFrame`.
 */
async function focused(chrome, options = {}) {
    const expression = `(() => {
        let doc = document;
        let el = doc.activeElement;
        while (el && el.tagName === 'IFRAME') {
            try { doc = el.contentDocument; el = doc.activeElement; } catch (e) { break; }
        }
        if (!el) return null;
        const aria = (node, name) => node.getAttribute(name);
        const pointed = aria(el, 'aria-activedescendant');
        const active = pointed ? doc.getElementById(pointed) : null;
        return {
            tag: el.tagName.toLowerCase(),
            role: aria(el, 'role'),
            id: el.id || null,
            label: aria(el, 'aria-label'),
            activedescendant: pointed,
            active: active ? {
                id: active.id,
                role: aria(active, 'role'),
                text: (active.textContent || '').trim().slice(0, 200),
                expanded: aria(active, 'aria-expanded'),
                selected: aria(active, 'aria-selected'),
                level: aria(active, 'aria-level'),
                setsize: aria(active, 'aria-setsize'),
                posinset: aria(active, 'aria-posinset'),
            } : null,
        };
    })()`;

    return options.frame ? chrome.inFrame(options.frame, expression) : chrome.evaluate(expression);
}

module.exports = { press, type, focused, describe };
