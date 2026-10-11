/*
 * The JSON tree's keyboard, pressed for real: `npm run keys`.
 *
 * The suite proves the key map as a function (treeKeys.ts); this proves the
 * control around it — that the scroller has focus after Tree, that a press
 * reaches its listener and moves aria-activedescendant to the row it names,
 * that the window keeps the focused row drawn, that Enter lands in the editor
 * with the node's text selected, and that the strip says where focus is.
 * Real key presses through the DevTools protocol (`dev/keys.js`, the
 * template's), against the harness served on a spare port.
 *
 * Exits 1 on any failure. Needs a build: `npm run build` first.
 */

'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');
const { press, type, focused } = require('./keys');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passed += 1;
        console.log('  ok    ' + label);
    } else {
        failed += 1;
        console.log('  FAIL  ' + label + '\n          got      ' + a + '\n          expected ' + e);
    }
}

/** What the tree says now: the focused row as a screen reader hears it, and the strip. */
const STATE = `(() => {
    const view = document.querySelector('.CodeEditor-tree-view');
    const id = view && view.getAttribute('aria-activedescendant');
    const row = id ? document.getElementById(id) : null;
    const tree = document.querySelector('.CodeEditor-tree');
    return {
        mode: tree && !tree.hidden ? 'tree' : 'other',
        focusOnTree: document.activeElement === view,
        row: row ? row.getAttribute('aria-label') : null,
        level: row ? row.getAttribute('aria-level') : null,
        pos: row ? row.getAttribute('aria-posinset') + '/' + row.getAttribute('aria-setsize') : null,
        expanded: row ? row.getAttribute('aria-expanded') : null,
        selected: row ? row.getAttribute('aria-selected') : null,
        path: (document.querySelector('.CodeEditor-path') || {}).textContent || '',
        drawn: document.querySelectorAll('.CodeEditor-tree-row').length,
        open: document.querySelectorAll('.CodeEditor-tree-row[aria-expanded="true"]').length,
    };
})()`;

async function main() {
    // dev/serve.js on a port the OS picks, as dev/shots.mjs does.
    const spare = http.createServer();
    await new Promise((resolve) => spare.listen(0, resolve));
    const port = spare.address().port;
    await new Promise((resolve) => spare.close(resolve));
    const server = spawn(process.execPath, [path.join(root, 'dev', 'serve.js'), '--no-open', '--port', String(port)], { stdio: 'ignore' });
    await sleep(600);

    const chrome = await launch({ width: 1100, height: 900 });
    const state = () => chrome.evaluate(STATE);
    const click = (selector) => chrome.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const button = (label) => chrome.evaluate(`[...document.querySelectorAll('.CodeEditor-mode')].find((b) => !b.hidden && b.textContent === ${JSON.stringify(label)}).click()`);

    try {
        await chrome.navigate(`http://localhost:${port}/dev/harness.html`, 2000);
        // The inline schema, so the strip has descriptions to show; then the order it passes.
        await chrome.evaluate(`(() => { const s = document.getElementById('harness-schema'); s.value = 'inline'; s.dispatchEvent(new Event('change')); })()`);
        await click('#harness-order');
        await sleep(600);

        console.log('\nOpening');
        await button('Tree');
        await sleep(150);
        let s = await state();
        check('Tree opens the tree and puts the keyboard on it', [s.mode, s.focusOnTree, (await focused(chrome)).role], ['tree', true, 'tree']);
        check('…on the node under the caret: the root, open', [s.row, s.level, s.expanded, s.selected], ['$: 3 keys', '1', 'true', 'true']);

        console.log('\nArrows');
        await press(chrome, 'ArrowDown');
        s = await state();
        check('Down: the first key, one of three, and the strip names it with its description', [s.row, s.pos, s.path], ['id: 1042', '1/3', '$.id — The number the order was issued under.']);
        await press(chrome, 'ArrowDown');
        await press(chrome, 'ArrowRight');
        s = await state();
        check('Right on a closed array opens it, focus stays', [s.row, s.expanded], ['lines: 3 items', 'true']);
        await press(chrome, 'ArrowRight');
        s = await state();
        check('Right on an open one moves into its first child', [s.row, s.level, s.pos, s.path], ['0: 2 keys', '3', '1/3', '$.lines[0]']);
        await press(chrome, 'ArrowRight', { times: 2 });
        s = await state();
        check('…and again, two levels down', [s.row, s.level, s.path.split(' — ')[0]], ['sku: "PCF-001"', '4', '$.lines[0].sku']);
        await press(chrome, 'ArrowLeft');
        s = await state();
        check('Left on a leaf goes to its parent', s.row, '0: 2 keys');
        await press(chrome, 'ArrowLeft');
        s = await state();
        check('Left on an open node closes it', [s.row, s.expanded], ['0: 2 keys', 'false']);
        await press(chrome, '*');
        s = await state();
        check('* opens every sibling that can open: items 0, 1 and 2, beside the root and lines', s.open, 5);

        console.log('\nHome, End, type-ahead');
        await press(chrome, 'End');
        s = await state();
        check('End: the last row', s.row, 'status: "open"');
        await press(chrome, 'Home');
        s = await state();
        check('Home: the root', s.row, '$: 3 keys');
        await type(chrome, 'q');
        s = await state();
        check('q finds the first qty', [s.row, s.path.split(' — ')[0]], ['qty: 2', '$.lines[0].qty']);
        await sleep(600);
        await type(chrome, 'st');
        s = await state();
        check('st, typed together, finds status', s.row, 'status: "open"');

        console.log('\nCopy, Enter, and back');
        await press(chrome, 'c', { modifiers: ['Control'] });
        await sleep(200);
        const announced = await chrome.evaluate(`document.querySelector('.CodeEditor-announce').textContent`);
        check('Ctrl+C copies the path and says so in the strip', announced, 'Copied $.status');
        await press(chrome, 'Enter');
        await sleep(150);
        const selected = await chrome.evaluate(`(() => { const e = window.__harnessInstance._editor; return [e.hasTextFocus(), e.getModel().getValueInRange(e.getSelection())]; })()`);
        check('Enter: back in the editor with the node\'s text selected', selected, [true, '"status": "open"']);
        await button('Tree');
        await sleep(150);
        s = await state();
        check('Tree again opens on the node the caret is in', s.row, 'status: "open"');

        console.log('\nA large document');
        await click('#harness-large');
        await sleep(800);
        await button('Tree');
        await sleep(200);
        await press(chrome, 'ArrowDown', { times: 2 });
        await press(chrome, 'ArrowRight');
        await press(chrome, 'End');
        s = await state();
        check('End on 1 MB of JSON: the last item is focused and drawn', [s.level, s.row !== null, s.drawn < 80], ['3', true, true]);
        const scrolled = await chrome.evaluate(`document.querySelector('.CodeEditor-tree-view').scrollTop > 0`);
        check('…the scroller followed it', scrolled, true);
        await press(chrome, 'Home');
        s = await state();
        check('Home comes back to the root, drawn', [s.row && s.row.startsWith('$:'), s.drawn < 80], [true, true]);

        check('no page errors', chrome.takeProblems(), []);
    } finally {
        await chrome.close();
        server.kill();
    }

    console.log(`\n  ${passed} passed, ${failed} failed — real keys in the harness; a form and a canvas app are SPEC.md's walkthrough`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
