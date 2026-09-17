/*
 * Asserts the control's decisions, outside a browser.
 *
 *     npm run smoke
 *
 * **This suite does not load the bundle, and that is the finding it is built
 * on.** Every other repository's `dev/smoke.js` evaluates
 * `out/controls/<Control>/bundle.js` against `dev/dom.js`; this one cannot,
 * because Monaco is a browser application that reads `document`, `window` and
 * `navigator` at module scope — the bundle does not fail to render under the
 * shim, it fails to *load*, on `document.getElementsByTagName` before any
 * control code runs (measured 2026-08-28 against the production bundle).
 * Growing the shim to meet it means writing a browser, which `dom.js` says in
 * its own header it will not do.
 *
 * So the control keeps its decisions in modules that import nothing of
 * Monaco — `languages.ts`, `validate.ts`, `sizing.ts`, `theme.ts` — and
 * `index.ts` is the thin part that turns a decision into a Monaco call. This
 * file transpiles those modules with the TypeScript already in
 * devDependencies and drives them directly. What it proves is the decision;
 * what it cannot prove is that `index.ts` asked the right question, and that
 * half stays with `dev/harness.html` and SPEC.md's *Not verified*.
 *
 * Why not jsdom: a devDependency, a config and a second way to load the
 * bundle, to reach a Monaco that would then need a layout engine to paint.
 * The line between "decision" and "DOM" is worth more than the coverage.
 *
 * No test framework, for the same reason every sibling has none: a handful of
 * assertions and an exit code are what `node` already does.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const src = path.join(root, 'CodeEditor');

/* ------------------------------------------------------------ load a module */

/**
 * Transpile one source file to CommonJS and evaluate it as a module of its
 * own, so `require('./languages')` inside `validate.ts` resolves to the same
 * treatment. `jsonc-parser` is a real dependency and resolves from
 * node_modules the ordinary way.
 */
const cache = new Map();

function load(name) {
    if (cache.has(name)) {
        return cache.get(name).exports;
    }

    const file = path.join(src, name + '.ts');
    const source = fs.readFileSync(file, 'utf8');
    const { outputText, diagnostics } = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true },
        reportDiagnostics: true,
    });

    if (diagnostics && diagnostics.length > 0) {
        throw new Error(name + '.ts: ' + diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    }

    const mod = new Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(src);
    cache.set(name, mod);

    // Relative imports come back through `load`, so a decision module that
    // quietly imported Monaco would fail here rather than pass by accident.
    mod.require = function (request) {
        if (request.startsWith('./')) {
            return load(request.slice(2));
        }
        if (/monaco-editor/.test(request)) {
            throw new Error(name + '.ts imports ' + request + ' — decisions must stay free of Monaco');
        }
        return Module.prototype.require.call(this, request);
    };
    mod._compile(outputText, file);

    return mod.exports;
}

/* ---------------------------------------------------------------- asserts */

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

function section(title) {
    console.log('\n' + title);
}

/* ============================================================== languages */

const { resolveLanguage, displayName, DEFAULT_LANGUAGE } = load('languages');
const KNOWN = ['plaintext', 'json', 'xml', 'sql', 'yaml', 'powerquery', 'msdax', 'markdown',
    'powershell', 'csharp', 'python', 'css', 'html', 'javascript', 'typescript'];

section('languages.ts — what a maker typed, to an id the bundle registered');

check('null is the default, json', resolveLanguage(null, KNOWN), 'json');
check('undefined is the default too', resolveLanguage(undefined, KNOWN), DEFAULT_LANGUAGE);
check('blank is the default (1.1.0 gave plain text)', resolveLanguage('   ', KNOWN), 'json');
check('case and whitespace do not matter', resolveLanguage('  XML ', KNOWN), 'xml');
check('DAX resolves through its alias', resolveLanguage('DAX', KNOWN), 'msdax');
check('"Power Query" with a space', resolveLanguage('Power Query', KNOWN), 'powerquery');
check('T-SQL is sql', resolveLanguage('t-sql', KNOWN), 'sql');
check('C# is csharp', resolveLanguage('C#', KNOWN), 'csharp');
check('an id nobody registered is plain text, not an error', resolveLanguage('nonsense', KNOWN), 'plaintext');
check('a known id the bundle did not register is plain text', resolveLanguage('json', ['plaintext']), 'plaintext');
check('display name for the strip', displayName('powerquery'), 'Power Query M');
check('an unknown id displays as itself', displayName('lua'), 'lua');

/* ================================================================ validate */

const { validateJson, validateXml, describeXmlError, positionAt, hasValidator } = load('validate');

section('validate.ts — JSON, strictly, with a position');

check('an empty column is not a fault', validateJson(''), []);
check('whitespace only is not a fault', validateJson('  \n\t'), []);
check('a valid document', validateJson('{"a": [1, 2, {"b": null}], "c": "d"}'), []);
check('a bare scalar is valid JSON', validateJson('42'), []);

const trailing = validateJson('{\n  "a": 1,\n}');
check('a trailing comma is one problem, not two', trailing.length, 1);
check('…at the closing brace', [trailing[0].line, trailing[0].column], [3, 1]);
check('…named for a reader', trailing[0].message, 'Trailing comma is not allowed');
check('a trailing comma in an array too', validateJson('[1, 2,\n]')[0].message, 'Trailing comma is not allowed');
check('a bracket without a comma before it keeps the parser message', validateJson('{"a": }')[0].message, 'Expected a value');

const missingColon = validateJson('{"a" 1}');
check('a missing colon, where the value starts', [missingColon[0].line, missingColon[0].column, missingColon[0].message], [1, 6, "Expected ':'"]);

const comment = validateJson('{\n  // note\n  "a": 1\n}');
check('a comment is a fault in strict JSON', comment.length, 1);
check('…on line 2', [comment[0].line, comment[0].column], [2, 3]);
check('…and says so', comment[0].message, 'Comments are not allowed in JSON');

const unterminated = validateJson('{"a": "oops}');
check('an unterminated string', unterminated[0].message, 'Unterminated string');

const single = validateJson("{'a': 1}");
check('single quotes are not JSON', single.length > 0, true);

const trailingContent = validateJson('{"a": 1} {"b": 2}');
check('content after the document', trailingContent[0].message, 'Unexpected content after the end of the document');
check('…at the second brace', [trailingContent[0].line, trailingContent[0].column], [1, 10]);

const crlf = validateJson('{\r\n  "a": 1,\r\n  "b": \r\n}');
check('CRLF line endings still count lines', crlf[0].line, 4);

check('marker length is at least 1', validateJson('{').every((p) => p.length >= 1), true);

section('validate.ts — XML, through whichever parser the browser has');

const wellFormed = () => null;
check('an empty column is not a fault', validateXml('', wellFormed), []);
check('a well-formed document asks the parser and gets nothing', validateXml('<a/>', wellFormed), []);
check('the parser is not asked for whitespace', validateXml('  ', () => { throw new Error('asked'); }), []);

const chromeText = 'This page contains the following errors:error on line 3 at column 7: Opening and ending tag mismatch: a line 2 and b\nBelow is a rendering of the page up to the first error.';
check('Chrome and Safari: "on line N at column M"', describeXmlError(chromeText), { line: 3, column: 7, length: 1, message: 'Opening and ending tag mismatch: a line 2 and b' });

const firefoxText = 'XML Parsing Error: mismatched tag. Expected: </a>.\nLocation: https://example/\nLine Number 3, Column 7:';
check('Firefox: "Line Number N, Column M"', describeXmlError(firefoxText), { line: 3, column: 7, length: 1, message: 'mismatched tag' });

check('anything else lands at 1:1 with its text', describeXmlError('not well-formed'), { line: 1, column: 1, length: 1, message: 'not well-formed' });
check('an empty message still says something', describeXmlError('').message, 'The document is not well-formed XML');
check('validateXml wraps the description', validateXml('<a><b></a>', () => chromeText)[0].line, 3);

check('only json and xml have a validator', ['json', 'xml', 'yaml', 'plaintext'].map(hasValidator), [true, true, false, false]);

section('validate.ts — positions');
check('offset 0 is 1:1', positionAt('abc', 0), { line: 1, column: 1 });
check('after a newline', positionAt('ab\ncd', 3), { line: 2, column: 1 });
check('past the end clamps', positionAt('ab', 10), { line: 1, column: 3 });

/* ================================================================== sizing */

const { resolveHeight, resolveWidth, FALLBACK_HEIGHT, MIN_FIT_HEIGHT, STATUS_BAR_HEIGHT } = load('sizing');

section('sizing.ts — whose height wins');

const off = { allocated: -1, preferred: null, fitContent: false, contentHeight: 300 };
check('nobody says: 500, as 1.1.0 did', resolveHeight(off), FALLBACK_HEIGHT);
check('a form allocating nothing reports -1, and 0 means the same', resolveHeight({ ...off, allocated: 0 }), FALLBACK_HEIGHT);
check('the host wins when it allocates', resolveHeight({ ...off, allocated: 260 }), 260);
check('the host wins over the maker', resolveHeight({ ...off, allocated: 260, preferred: 800 }), 260);
check('the host wins over fitContent', resolveHeight({ ...off, allocated: 260, fitContent: true, contentHeight: 900 }), 260);
check('the maker\'s number when the host has none', resolveHeight({ ...off, preferred: 320 }), 320);
check('a zero or negative height is blank', [resolveHeight({ ...off, preferred: 0 }), resolveHeight({ ...off, preferred: -5 })], [FALLBACK_HEIGHT, FALLBACK_HEIGHT]);
check('fitContent: the document plus the strip', resolveHeight({ ...off, fitContent: true, contentHeight: 190 }), 190 + STATUS_BAR_HEIGHT);
check('fitContent: never below the floor', resolveHeight({ ...off, fitContent: true, contentHeight: 19 }), MIN_FIT_HEIGHT);
check('fitContent: never above the maker\'s number', resolveHeight({ ...off, fitContent: true, contentHeight: 5000, preferred: 400 }), 400);
check('fitContent: never above 500 when the maker said nothing', resolveHeight({ ...off, fitContent: true, contentHeight: 5000 }), FALLBACK_HEIGHT);
check('fitContent with a ceiling under the floor: the ceiling', resolveHeight({ ...off, fitContent: true, contentHeight: 5000, preferred: 60 }), 60);
check('fitContent before the editor exists: the maker\'s number', resolveHeight({ ...off, fitContent: true, contentHeight: null, preferred: 320 }), 320);
check('fractional content heights round up', resolveHeight({ ...off, fitContent: true, contentHeight: 190.2 }), 191 + STATUS_BAR_HEIGHT);

check('width: allocated when the platform answered', resolveWidth(640, 100), 640);
check('width: measured when it did not', resolveWidth(-1, 480), 480);
check('width: never negative', resolveWidth(-1, -3), 0);

/* =================================================================== theme */

const { resolveTheme } = load('theme');

section('theme.ts — auto follows the app, never the operating system');

check('auto on a dark app', resolveTheme('auto', true), 'vs-dark');
check('auto on a light app', resolveTheme('auto', false), 'vs');
check('auto where the host publishes nothing (canvas) is light', resolveTheme('auto', undefined), 'vs');
check('the maker never touched it: auto', resolveTheme(null, true), 'vs-dark');
check('undefined too', resolveTheme(undefined, undefined), 'vs');
check('dark forced on a light app', resolveTheme('dark', false), 'vs-dark');
check('light forced on a dark app', resolveTheme('light', true), 'vs');
check('a canvas formula with odd casing', resolveTheme(' Dark ', false), 'vs-dark');
check('a value outside the enum behaves as auto', resolveTheme('sepia', true), 'vs-dark');

/* ================================================================= verdict */

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
