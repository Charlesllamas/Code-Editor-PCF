/*
 * Headless Chrome, driven over the DevTools protocol with Node's own
 * `WebSocket` — no dependency. What `dev/shots.js` photographs with and
 * `dev/demo-check.js` drives the hub's demo with.
 *
 * **Why the protocol and not `--screenshot` on the command line.** The states
 * worth a picture are reached by doing something — ticking rows, dragging an
 * edge, picking a preset — and a demo's control lives in a sandboxed frame the
 * page around it cannot reach into. The protocol does both: it evaluates in
 * the page, and in any frame, out-of-process or not.
 *
 * **Why it is here at all.** Five controls carried a copy of this, each taken
 * from the last and pointed somewhere new (`pcf-row-commands` → Kanban → File
 * Preview → Number Slider), and the copies drifted: one waited 1.5 s for a
 * paint, one 4 s, one picked a fixed debugging port that collided with the
 * next. And the desktop app's preview pane hands back a blank picture while
 * the pane is hidden. So the engine is the template's and `sync-rig.mjs`
 * keeps it current; what a repository writes is its recipes.
 *
 *     const { launch } = require('./cdp');
 *     const chrome = await launch({ width: 1280, height: 900, scale: 2 });
 *     await chrome.navigate('http://localhost:8080/dev/harness.html');
 *     const png = await chrome.capture(await chrome.clip('#root'));
 *     await chrome.close();
 *
 * `CHROME` names the browser where it is not in a usual place.
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CANDIDATES = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The browser to drive: `CHROME`, else the first usual install found, else `null`. */
function findChrome() {
    if (process.env.CHROME) {
        return process.env.CHROME;
    }

    return CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * The port Chrome chose. `--remote-debugging-port=0` lets the OS pick a free
 * one and Chrome writes it to `DevToolsActivePort` in the profile — so two
 * scripts, or a script and a stale browser, never fight over a fixed number.
 */
async function activePort(profile) {
    const file = path.join(profile, 'DevToolsActivePort');

    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (fs.existsSync(file)) {
            const port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);

            if (port > 0) {
                return port;
            }
        }

        await sleep(100);
    }

    throw new Error('Chrome started but never said which port it is listening on.');
}

function connect(url) {
    const socket = new WebSocket(url);
    const waiting = new Map();
    const listeners = [];
    let next = 0;

    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);

        if (message.id !== undefined && waiting.has(message.id)) {
            const pending = waiting.get(message.id);

            waiting.delete(message.id);
            message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);

            return;
        }

        if (message.method) {
            listeners.forEach((listener) => listener(message));
        }
    });

    return new Promise((resolve, reject) => {
        socket.addEventListener('error', () => reject(new Error(`Could not reach Chrome at ${url}.`)));
        socket.addEventListener('open', () =>
            resolve({
                send(method, params = {}, sessionId) {
                    next += 1;
                    socket.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));

                    return new Promise((ok, fail) => waiting.set(next, { resolve: ok, reject: fail }));
                },
                on(listener) {
                    listeners.push(listener);
                },
                close() {
                    socket.close();
                },
            }),
        );
    });
}

/**
 * Start a headless browser with one page, and hand back what drives it.
 *
 * Every `evaluate` takes an expression, awaits a promise, and returns the
 * value by value — so return plain data, and throw for a failure: a thrown
 * error comes back here as an `Error` with the page's message.
 *
 * Frames: a sandboxed or cross-site `<iframe>` runs out of process and is its
 * own target; a same-site one is a context inside the page. `inFrame(match)`
 * finds either by a substring of the frame's URL and evaluates there.
 */
async function launch(options = {}) {
    const chromePath = options.chrome || findChrome();

    if (!chromePath) {
        throw new Error('No Chrome or Edge found. Set CHROME to the browser\'s path.');
    }

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf-cdp-'));
    const browser = spawn(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
    ], { stdio: 'ignore' });

    let closed = false;

    const shutdown = () => {
        if (!closed) {
            closed = true;
            browser.kill();
        }
    };

    try {
        const port = await activePort(profile);
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        const cdp = await connect(version.webSocketDebuggerUrl);

        const frameTargets = new Map();
        const contexts = new Map();
        const problems = [];

        cdp.on((message) => {
            if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'iframe') {
                frameTargets.set(message.params.sessionId, message.params.targetInfo);
                // A frame target starts paused only if asked to; enable what reading it needs.
                cdp.send('Runtime.enable', {}, message.params.sessionId).catch(() => {});
            } else if (message.method === 'Target.detachedFromTarget') {
                frameTargets.delete(message.params.sessionId);
            } else if (message.method === 'Target.targetInfoChanged') {
                for (const [sessionId, info] of frameTargets) {
                    if (info.targetId === message.params.targetInfo.targetId) {
                        frameTargets.set(sessionId, message.params.targetInfo);
                    }
                }
            } else if (message.method === 'Runtime.executionContextCreated') {
                const context = message.params.context;

                if (context.auxData && context.auxData.isDefault) {
                    contexts.set(`${message.sessionId || ''}|${context.auxData.frameId}`, context.id);
                }
            } else if (message.method === 'Runtime.exceptionThrown') {
                const details = message.params.exceptionDetails;

                problems.push({ kind: 'exception', where: message.sessionId ? 'frame' : 'page', text: (details.exception && details.exception.description) || details.text });
            } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
                const text = message.params.args.map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || '')).join(' ');

                problems.push({ kind: 'console.error', where: message.sessionId ? 'frame' : 'page', text });
            }
        });

        await cdp.send('Target.setDiscoverTargets', { discover: true });

        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, page);
        await cdp.send('Page.enable', {}, page);
        await cdp.send('Runtime.enable', {}, page);

        const metrics = { width: options.width || 1280, height: options.height || 900, scale: options.scale || 1 };

        const viewport = async (width = metrics.width, height = metrics.height, scale = metrics.scale) => {
            Object.assign(metrics, { width, height, scale });
            await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, page);
        };

        await viewport();

        const run = async (expression, sessionId, contextId) => {
            const result = await cdp.send('Runtime.evaluate', {
                expression,
                awaitPromise: true,
                returnByValue: true,
                ...(contextId !== undefined ? { contextId } : {}),
            }, sessionId);

            if (result.exceptionDetails) {
                const details = result.exceptionDetails;

                throw new Error((details.exception && details.exception.description) || details.text);
            }

            return result.result.value;
        };

        /** The frame whose URL contains `match`: an out-of-process target, else a context in the page. */
        const findFrame = async (match) => {
            for (const [sessionId, info] of frameTargets) {
                if (!match || (info.url || '').includes(match)) {
                    return { sessionId };
                }
            }

            const { frameTree } = await cdp.send('Page.getFrameTree', {}, page);
            const walk = (node) => {
                if (node.frame.parentId && (!match || (node.frame.url || '').includes(match))) {
                    return node.frame.id;
                }

                for (const child of node.childFrames || []) {
                    const found = walk(child);

                    if (found) {
                        return found;
                    }
                }

                return null;
            };
            const frameId = walk(frameTree);
            const contextId = frameId ? contexts.get(`${page}|${frameId}`) : undefined;

            return contextId !== undefined ? { sessionId: page, contextId } : null;
        };

        return {
            /** Raw protocol access, on the page unless a session is named. */
            send: (method, params = {}, sessionId = page) => cdp.send(method, params, sessionId),

            /** Exceptions and `console.error` lines seen since the last `takeProblems()`, from the page and its frames. */
            takeProblems() {
                return problems.splice(0, problems.length);
            },

            viewport,

            /** Navigate and give the page `wait` ms to settle — a fetch of the strings, one paint. */
            async navigate(url, wait = 1500) {
                contexts.clear();
                await cdp.send('Page.navigate', { url }, page);
                await sleep(wait);
            },

            evaluate: (expression) => run(expression, page),

            /** Evaluate inside the first frame whose URL contains `match`; throws when there is none. */
            async inFrame(match, expression) {
                const frame = await findFrame(match);

                if (!frame) {
                    throw new Error(`No frame whose URL contains "${match}".`);
                }

                return run(expression, frame.sessionId, frame.contextId);
            },

            /** Whether such a frame exists yet. */
            async hasFrame(match) {
                return (await findFrame(match)) !== null;
            },

            /**
             * The rectangle that frames every element `selectors` matches,
             * padded, in page coordinates — what `capture` takes. Throws when
             * nothing matches: a recipe framing nothing is a broken recipe,
             * not an empty picture.
             */
            async clip(selectors, pad = 12) {
                const list = Array.isArray(selectors) ? selectors.join(',') : selectors;

                return run(`(() => {
                    const boxes = [...document.querySelectorAll(${JSON.stringify(list)})]
                        .map((node) => node.getBoundingClientRect())
                        .filter((box) => box.width > 0 && box.height > 0);
                    if (boxes.length === 0) throw new Error('Nothing on the page matches ${list.replace(/'/g, '')}.');
                    const left = Math.min(...boxes.map((b) => b.left)), top = Math.min(...boxes.map((b) => b.top));
                    const right = Math.max(...boxes.map((b) => b.right)), bottom = Math.max(...boxes.map((b) => b.bottom));
                    return {
                        x: Math.max(0, left + window.scrollX - ${pad}), y: Math.max(0, top + window.scrollY - ${pad}),
                        width: Math.ceil(right - left + ${pad * 2}), height: Math.ceil(bottom - top + ${pad * 2}), scale: 1,
                    };
                })()`, page);
            },

            /**
             * A PNG of `clip` (or the viewport), at the viewport's device
             * scale. Beyond the viewport by default, so a tall card is whole.
             *
             * **An out-of-process frame needs `{ beyond: false }`**, and to be
             * scrolled into view first: with `captureBeyondViewport` its area
             * comes back blank while the page around it paints (measured on the
             * hub's live demo, 4 Oct 2026). The clip stays in page coordinates
             * either way — `clip()`'s — which is what the protocol takes.
             */
            async capture(clip, options = {}) {
                const beyond = options.beyond !== false;
                const shot = await cdp.send('Page.captureScreenshot', {
                    format: 'png',
                    ...(clip ? { clip, captureBeyondViewport: beyond } : {}),
                }, page);

                return Buffer.from(shot.data, 'base64');
            },

            scale: () => metrics.scale,

            async close() {
                try {
                    cdp.close();
                } finally {
                    shutdown();
                    // The profile is Chrome's to release; give it a moment, and leave it if it is still held.
                    await sleep(300);
                    try {
                        fs.rmSync(profile, { recursive: true, force: true });
                    } catch {
                        // Held by a process that has not exited yet — the OS temp folder collects it.
                    }
                }
            },
        };
    } catch (error) {
        shutdown();
        throw error;
    }
}

/**
 * Take every picture in `recipes`, into `media/` beside `dev/`.
 *
 * A recipe is `{ name, purpose, page, query, width, frame, act, wait }`:
 *
 *   name     the file in media/
 *   purpose  one line, printed beside the size — what the picture is for
 *   page     the page under the repository root (`dev/preview.html`)
 *   query    its query string, without the `?` — the switches that arrange the state
 *   width    the viewport's CSS width (default 1280)
 *   frame    the selector, or list, whose union is the picture (default `body`)
 *   act      script run in the page after it settles, before the picture — an
 *            `await` is allowed — for a state reached by doing something
 *   wait     ms to settle after navigating (default 1500)
 *
 * Returns how many failed; the caller exits non-zero on any.
 */
async function shoot(recipes, options = {}) {
    const root = options.root || path.join(__dirname, '..');
    const media = options.media || path.join(root, 'media');
    const base = options.base || `http://localhost:${options.port || process.env.PORT || 8080}`;
    const only = options.only && options.only.length ? options.only : null;

    try {
        await fetch(`${base}/`);
    } catch {
        throw new Error(`Nothing is being served at ${base}. Run npm run harness -- --no-open --port ${new URL(base).port} first.`);
    }

    const chrome = await launch({ scale: options.scale || 2, height: options.height || 1400 });
    let failed = 0;

    try {
        for (const recipe of recipes) {
            if (only && !only.some((name) => recipe.name.includes(name))) {
                continue;
            }

            try {
                await chrome.viewport(recipe.width || options.width || 1280, recipe.height || options.height || 1400, options.scale || 2);
                await chrome.navigate(`${base}/${recipe.page || 'dev/preview.html'}${recipe.query ? `?${recipe.query}` : ''}`, recipe.wait || options.wait || 1500);

                if (recipe.act) {
                    await chrome.evaluate(`(async () => { ${recipe.act} })()`);
                    await sleep(recipe.settle || 600);
                }

                const clip = await chrome.clip(recipe.frame || 'body', recipe.pad === undefined ? 12 : recipe.pad);
                const png = await chrome.capture(clip);
                const scale = chrome.scale();

                fs.writeFileSync(path.join(media, recipe.name), png);
                console.log(`  ${recipe.name.padEnd(30)} ${Math.round(clip.width * scale)}×${Math.round(clip.height * scale)}  ${recipe.purpose || ''}`);

                for (const problem of chrome.takeProblems()) {
                    console.log(`      ${problem.kind} (${problem.where}): ${problem.text.split('\n')[0]}`);
                }
            } catch (error) {
                failed += 1;
                console.log(`  ${recipe.name.padEnd(30)} FAILED  ${error.message.split('\n')[0]}`);
            }
        }
    } finally {
        await chrome.close();
    }

    return failed;
}

module.exports = { findChrome, launch, shoot, sleep };
