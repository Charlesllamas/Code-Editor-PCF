/*
 * Every demo preset, run and measured — in the hub's harness before
 * publishing, or on pcfhub.dev after.
 *
 *     npm run demo-check                    # dev/hub-demo.html: npm run harness -- --no-open --port 8181
 *                                           #   here, and npm run dev:demo-harness in ../pcfhub
 *     npm run demo-check -- --live          # https://pcfhub.dev/components/<slug>, as a visitor sees it
 *     npm run demo-check -- --preset week --width 373 --theme dark
 *
 * For each preset in `pcfhub.json` it picks the preset, waits for the
 * control, and reads inside the sandboxed frame: whether the document
 * overflows its frame (compared exactly — a one-pixel tolerance passed
 * `pcf-number-slider` 0.1.0's arc, which scrolled on the live page), whether
 * the harness reported an error, and what the control threw or logged as an
 * error. A picture of each lands in `out/demo-check/`, which `out/` keeps out
 * of git. Exits non-zero when any preset has a problem.
 *
 * **Why it exists.** The hub's demo is a third host — it changes inputs on a
 * mounted control, narrows it below the window, sizes its frame to the height
 * the control reports — and it corrected five controls a form and the rig had
 * both passed. The checks that found them were scripts in a session's scratch
 * folder, written again each time. The template's file, kept current by
 * `sync-rig.mjs`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');

const root = path.join(__dirname, '..');
const hub = JSON.parse(fs.readFileSync(path.join(root, 'pcfhub.json'), 'utf8'));
const presets = (hub.demo && hub.demo.presets) || [];

function option(name, fallback) {
    const at = process.argv.indexOf(`--${name}`);

    return at === -1 ? fallback : process.argv[at + 1];
}

const live = process.argv.includes('--live');
const only = (option('preset', '') || '').split(',').filter(Boolean);
const width = Number(option('width', 640));
const port = Number(option('port', process.env.PORT || 8181));
const harness = option('harness', 'http://localhost:4174');
const theme = option('theme', 'light');
const out = path.resolve(root, option('out', 'out/demo-check'));
const site = option('site', 'https://pcfhub.dev');

/** Read inside the demo frame: the document against its frame, and what is on screen. */
const MEASURE = `(() => {
    const doc = document.documentElement;
    const body = document.body;
    const first = body && [...body.querySelectorAll('*')].find((n) => n.className && typeof n.className === 'string' && n.getBoundingClientRect().height > 0);
    return {
        scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
        scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight,
        overflowX: doc.scrollWidth > doc.clientWidth,
        overflowY: doc.scrollHeight > doc.clientHeight,
        text: (body ? body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 100),
        firstClass: first ? String(first.className).split(' ')[0] : null,
    };
})()`;

function verdict(measure, errors) {
    const problems = [];

    if (!measure) {
        problems.push('the demo frame never answered');
    } else {
        if (measure.overflowX) {
            problems.push(`overflows sideways: ${measure.scrollWidth} > ${measure.clientWidth}`);
        }

        if (measure.overflowY) {
            problems.push(`overflows its frame: ${measure.scrollHeight} > ${measure.clientHeight}`);
        }

        if (!measure.firstClass && !measure.text) {
            problems.push('nothing rendered');
        }
    }

    return problems.concat(errors);
}

function report(slug, measure, problems, picture) {
    const size = measure ? `${measure.clientWidth}×${measure.clientHeight}` : '—';

    console.log(`  ${problems.length ? 'PROBLEM' : 'ok     '}  ${slug.padEnd(24)} ${size.padEnd(10)} ${path.relative(root, picture)}`);

    for (const problem of problems) {
        console.log(`             ${problem}`);
    }
}

/** The stand-in: dev/hub-demo.html hosting the hub's real harness. */
async function checkLocal(chrome, preset) {
    const query = new URLSearchParams({ preset: preset.slug, width: String(width), harness, theme });

    await chrome.navigate(`http://localhost:${port}/dev/hub-demo.html?${query}`, 1000);

    let ready = false;

    for (let waited = 0; waited < 20000 && !ready; waited += 500) {
        const state = await chrome.evaluate(`({ failed: window.__failed || null, types: (window.__messages || []).map((m) => m.type) })`);

        if (state.failed) {
            return { measure: null, errors: [`the stand-in could not build the manifest: ${state.failed}`] };
        }

        ready = state.types.includes('harness:ready') || state.types.includes('harness:error');
        await sleep(500);
    }

    // One more beat for the first resize and paint.
    await sleep(1200);

    const messages = await chrome.evaluate(`(window.__messages || []).map((m) => ({ type: m.type, level: m.level, message: m.message, phase: m.phase, error: m.error && m.error.message }))`);
    const errors = messages
        .filter((m) => m.type === 'harness:error' || (m.type === 'harness:log' && m.level === 'error'))
        .map((m) => (m.type === 'harness:error' ? `harness:error (${m.phase}): ${m.error}` : `logged an error: ${m.message}`));

    if (!ready) {
        errors.push(`no harness:ready in 20 s — is the harness running at ${harness}?`);
    }

    const measure = (await chrome.hasFrame(new URL(harness).host)) ? await chrome.inFrame(new URL(harness).host, MEASURE) : null;

    return { measure, errors, clip: await chrome.clip('#frame', 0) };
}

/** The published page: pick the preset the way a visitor does, from the Preset list. */
async function checkLive(chrome, preset, first) {
    if (first) {
        await chrome.navigate(`${site}/components/${hub.slug}`, 6000);
        // The hub mounts the demo frame only once its section is in view.
        await chrome.evaluate(`(() => { const h = [...document.querySelectorAll('h2,h3')].find((e) => /^demo$/i.test(e.textContent.trim())); if (h) h.scrollIntoView(); return !!h; })()`);
        await sleep(8000);
    }

    const picked = await chrome.evaluate(`(async () => {
        const button = document.querySelector('button[aria-label="Preset"]');
        if (!button) return 'no Preset list on the page';
        button.click();
        await new Promise((r) => setTimeout(r, 400));
        const options = [...document.querySelectorAll('[role=option]')].filter((o) => o.offsetParent);
        const match = options.find((o) => o.textContent.trim() === ${JSON.stringify(preset.name)});
        if (!match) { document.body.click(); return 'no preset named ' + ${JSON.stringify(preset.name)} + ' — the page lists: ' + options.map((o) => o.textContent.trim()).join(' | '); }
        match.click();
        return 'ok';
    })()`);

    if (picked !== 'ok') {
        return { measure: null, errors: [picked] };
    }

    await sleep(4000);

    const src = await chrome.evaluate(`(() => { const f = document.querySelector('iframe'); if (!f) return null; f.scrollIntoView({ block: 'center' }); return f.src; })()`);

    if (!src) {
        return { measure: null, errors: ['no demo frame on the page'] };
    }

    await sleep(800);

    const host = new URL(src).host;
    const measure = (await chrome.hasFrame(host)) ? await chrome.inFrame(host, MEASURE) : null;

    return { measure, errors: [], clip: await chrome.clip('iframe', 0) };
}

(async () => {
    const chosen = presets.filter((p) => only.length === 0 || only.includes(p.slug));

    if (chosen.length === 0) {
        console.error(`\n  No presets${only.length ? ` named ${only.join(', ')}` : ''} in pcfhub.json.\n`);
        process.exit(1);
    }

    if (!live) {
        try {
            await fetch(`http://localhost:${port}/dev/hub-demo.html`);
        } catch {
            console.error(`\n  Nothing is being served at http://localhost:${port}. Run npm run harness -- --no-open --port ${port} first,`
                + `\n  and npm run dev:demo-harness in ../pcfhub for the harness itself (or --live for pcfhub.dev).\n`);
            process.exit(1);
        }
    }

    fs.mkdirSync(out, { recursive: true });

    const chrome = await launch({ width: Math.max(1280, width + 200), height: 1000 });
    let bad = 0;

    console.log(`\n  ${hub.slug} — ${live ? `${site}/components/${hub.slug}` : `dev/hub-demo.html in ${harness}`}, ${chosen.length} preset(s)\n`);

    try {
        for (let i = 0; i < chosen.length; i += 1) {
            const preset = chosen[i];
            const picture = path.join(out, `${preset.slug}${live ? '-live' : ''}.png`);
            let result;

            chrome.takeProblems();

            try {
                result = live ? await checkLive(chrome, preset, i === 0) : await checkLocal(chrome, preset);
            } catch (error) {
                result = { measure: null, errors: [error.message.split('\n')[0]] };
            }

            const thrown = chrome.takeProblems()
                .filter((p) => p.where === 'frame')
                .map((p) => `${p.kind} in the frame: ${p.text.split('\n')[0]}`);

            if (result.clip) {
                // The demo frame is out of process: never captured beyond the viewport, or it is blank.
                fs.writeFileSync(picture, await chrome.capture(result.clip, { beyond: false }));
            }

            const problems = verdict(result.measure, result.errors.concat(thrown));

            bad += problems.length ? 1 : 0;
            report(preset.slug, result.measure, problems, picture);
        }
    } finally {
        await chrome.close();
    }

    console.log(`\n  ${chosen.length - bad} of ${chosen.length} presets clean${bad ? '' : '.'}\n`);
    process.exit(bad ? 1 : 0);
})().catch((error) => {
    console.error(`\n  ${error.message}\n`);
    process.exit(1);
});
