/*
 * Serves the repository so `dev/harness.html` can load the built bundle.
 *
 *     npm run build && npm run harness
 *
 * **Why this exists when the harness is a plain HTML file.** Opening it over
 * `file://` mostly works and then stops: `fetch` of a `demo/*.json` fixture is
 * blocked as a cross-origin request to a `null` origin, and any module script
 * is refused outright. Both failures arrive as an empty control with a console
 * error about CORS, which reads as a broken control rather than as a missing
 * server. Over `http://` neither happens.
 *
 * It serves the repository **root**, not `dev/`, because the harness reaches
 * out of its own directory for the two things that matter: `../out/controls/…`
 * for the bundle `npm run build` wrote, and `../demo/…` for a dataset fixture.
 *
 * No dependency, deliberately. `dev/` has none and this is not the place to
 * start — `node:http` serves static files in about forty lines, and an
 * `http-server` devDependency would be one more thing `npm ci` fetches in CI
 * for a file CI never opens.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const page = path.join(__dirname, 'harness.html');

/*
 * Every shape scaffolds a harness page, so a missing one means somebody removed
 * it. Say that rather than serving a 404 the browser explains badly.
 */
if (!fs.existsSync(page)) {
    console.error(
        '\n  No dev/harness.html in this repository.\n\n'
        + '  Every shape ships one, so this repository dropped it. `npm start` and\n'
        + '  `npm run smoke` both still work; restore the page from the template if\n'
        + '  you want the switches back.\n',
    );
    process.exit(1);
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

const args = process.argv.slice(2);
const at = args.indexOf('--port');
const wanted = Number(at !== -1 ? args[at + 1] : process.env.PORT) || 8181;
const shouldOpen = !args.includes('--no-open');

const server = http.createServer((request, response) => {
    /*
     * Parsed rather than string-sliced, and that is the security-relevant
     * line in this file.
     *
     * `URL` applies the standard's own path normalisation, which resolves
     * `..` segments **and** their percent-encoded spellings — `%2e%2e` is a
     * double-dot segment by the spec, so `/%2e%2e/%2e%2e/package.json`
     * arrives here as `/package.json`. A hand-rolled `request.url.split('?')`
     * would hand `path.join` a `..` to act on. Do not simplify this away.
     *
     * The guard below is the second line rather than the first.
     */
    const url = new URL(request.url, 'http://localhost');
    const requested = url.pathname === '/' ? '/dev/harness.html' : url.pathname;
    const file = path.join(root, decodeURIComponent(requested));

    /*
     * Nothing outside the repository, whatever survived normalisation above.
     *
     * This server binds to localhost and lives for the length of one session,
     * but a static server that will serve `../../.ssh/id_rsa` on request is
     * not a thing to leave lying in a template — and `decodeURIComponent` runs
     * *after* the normalisation, so a doubly-encoded segment is the kind of
     * thing this is here to stop.
     */
    if (!file.startsWith(root + path.sep) && file !== root) {
        response.writeHead(403).end('Outside the repository.');

        return;
    }

    fs.readFile(file, (error, content) => {
        if (error) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end(
                `Not found: ${requested}\n\n`
                + 'If this is the control bundle, run `npm run build` first.\n',
            );

            return;
        }

        response.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            // The whole point of this server is that a rebuild shows up on
            // reload. A cached bundle is the harness lying about the code.
            'Cache-Control': 'no-store',
        });
        response.end(content);
    });
});

/*
 * Take the next free port rather than failing.
 *
 * A harness left running in another terminal is the normal reason this port is
 * taken, and exiting with EADDRINUSE sends somebody hunting for a process when
 * the answer is "use 8182". Ten is enough to find one and few enough to stop.
 */
let port = wanted;

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && port < wanted + 10) {
        port += 1;
        server.listen(port, '127.0.0.1');

        return;
    }

    console.error(`\n  ${error.message}\n`);
    process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/dev/harness.html`;

    console.log(`\n  Harness on ${url}`);
    console.log('  Rebuild with `npm run build`, then reload. Ctrl+C to stop.\n');

    if (shouldOpen) {
        open(url);
    }
});

/**
 * Open the default browser, and shrug if that is not possible.
 *
 * A headless machine, a container, an SSH session: the URL is printed above
 * either way, so a failure here is not worth a message of its own.
 */
function open(url) {
    const command =
        process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '', url]]
            : process.platform === 'darwin'
                ? ['open', [url]]
                : ['xdg-open', [url]];

    try {
        spawn(command[0], command[1], { stdio: 'ignore', detached: true }).unref();
    } catch {
        // Printed above; nothing else to do.
    }
}
