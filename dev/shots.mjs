/*
 * Retake the screenshots in media/.
 *
 *     npm run build && npm run shots          every state
 *     npm run shots -- schema                 one state
 *
 * Serves the repository on a spare port, points headless Chrome (or Edge) at
 * dev/shots.html once per state, and writes media/<file>. The recipe used to
 * live in SPEC.md as prose, which is how a retake becomes archaeology; here it
 * is the thing that runs. Look at every picture it writes before committing
 * it — this is the only step that sees the control rather than counting its
 * parts.
 *
 * Chrome's own `--screenshot` does the capture, so there is no dependency.
 * `--virtual-time-budget` lets the editor paint and a web-resource schema
 * land before the shot; each state's height is its crop, at 2x.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** state → file, and the window height that crops it. */
const SHOTS = {
    faults: { file: 'screenshot.png', height: 244 },
    dark: { file: 'screenshot-dark.png', height: 200 },
    xml: { file: 'screenshot-xml.png', height: 143 },
    schema: { file: 'screenshot-schema.png', height: 274 },
    // 1.4.0: the list hangs below the editor and the hover above a line —
    // both in the node under <body>, so the crop leaves them room.
    completion: { file: 'screenshot-completion.png', height: 280 }, // Monaco fits the list to the window: less, and it flips above the caret
    hover: { file: 'screenshot-hover.png', height: 225 },
};

const BROWSERS = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
];

const browser = process.env.CHROME || BROWSERS.find((p) => existsSync(p));
if (!browser) {
    console.error('No Chrome or Edge found; set CHROME to its path.');
    process.exit(1);
}
if (!existsSync(join(root, 'out', 'controls', 'CodeEditor', 'bundle.js'))) {
    console.error('No bundle — run npm run build first.');
    process.exit(1);
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const states = wanted.length > 0 ? wanted : Object.keys(SHOTS);
const unknown = states.filter((s) => !SHOTS[s]);
if (unknown.length > 0) {
    console.error('No such state: ' + unknown.join(', ') + '. Known: ' + Object.keys(SHOTS).join(', '));
    process.exit(1);
}

// dev/serve.js, on a port the OS picks, so a running harness is not in the way.
const probe = http.createServer();
await new Promise((resolve) => probe.listen(0, resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));

const server = spawn(process.execPath, [join(root, 'dev', 'serve.js'), '--no-open', '--port', String(port)], { stdio: 'ignore' });
await new Promise((resolve) => setTimeout(resolve, 600));

let failed = 0;
try {
    for (const state of states) {
        const { file, height } = SHOTS[state];
        const out = join(root, 'media', file);
        const result = spawnSync(browser, [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--force-device-scale-factor=2',
            `--window-size=640,${height}`,
            '--virtual-time-budget=4000',
            '--default-background-color=00000000',
            `--screenshot=${out}`,
            `http://localhost:${port}/dev/shots.html?state=${state}`,
        ], { encoding: 'utf8', timeout: 60000 });

        if (result.status === 0 && existsSync(out)) {
            console.log(`  ${state.padEnd(7)} → media/${file}`);
        } else {
            failed += 1;
            console.error(`  ${state.padEnd(7)} failed: ${(result.stderr || result.error || '').toString().trim().split('\n').pop()}`);
        }
    }
} finally {
    server.kill();
}

process.exit(failed === 0 ? 0 : 1);
