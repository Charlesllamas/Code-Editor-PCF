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
 * file loads those modules through `dev/modules.js`, which transpiles them
 * with the TypeScript already in devDependencies, and drives them directly.
 * The template took that loader from here. What it proves is the decision;
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

const path = require('path');
const { createLoader } = require('./modules');

const root = path.join(__dirname, '..');

/*
 * The shared loader (dev/modules.js, from the template): each decision module
 * transpiled on its own, relative imports routed back through it, and a
 * decision module that imports Monaco refused by name — so the boundary this
 * suite rests on is enforced rather than remembered. `jsonc-parser` and
 * `@cfworker/json-schema` are real dependencies and resolve the ordinary way.
 */
const load = createLoader({ root: path.join(root, 'CodeEditor'), forbid: [[/monaco-editor/, 'Monaco']] });

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

/* ================================================================== schema */

const { resolveSchemaSource, compileSchema, draftOf, readable, decodePointer } = load('schema');
const { Validator } = require('@cfworker/json-schema');

section('schema.ts — what the maker put in the schema box');

check('blank is no schema', resolveSchemaSource('  '), { kind: 'none' });
check('null is no schema', resolveSchemaSource(null), { kind: 'none' });
check('a document is inline', resolveSchemaSource(' {"type":"object"} ').kind, 'inline');
check('a name is a web resource', resolveSchemaSource('new_/schemas/order.json'), { kind: 'webResource', name: 'new_/schemas/order.json' });
check('a leading slash and the folder are forgiven', resolveSchemaSource('/WebResources/new_/order.json'), { kind: 'webResource', name: 'new_/order.json' });
check('a URL is refused, never fetched', resolveSchemaSource('https://example.com/s.json').kind, 'unsupported');
check('a protocol-relative URL too', resolveSchemaSource('//example.com/s.json').kind, 'unsupported');
check('a query string is refused', resolveSchemaSource('new_/s.json?v=2').kind, 'unsupported');
check('climbing out of the folder is refused', resolveSchemaSource('new_/../s.json').kind, 'unsupported');

section('schema.ts — the schema itself');

check('not JSON is named', compileSchema('{"type": }').fault, 'notJson');
check('an array is not a schema', compileSchema('[1]').fault, 'invalidSchema');
check('comments in a schema file are fine', compileSchema('{\n  // orders\n  "type": "object"\n}').ok, true);
const unresolved = compileSchema('{"$ref": "#/$defs/missing"}');
check('an unresolved $ref is the schema\'s fault, found up front', unresolved.fault, 'invalidSchema');
check('…and says which', unresolved.message, 'The schema refers to #/$defs/missing, which it does not contain');
check('a draft-07 schema is read as draft 7', draftOf({ $schema: 'http://json-schema.org/draft-07/schema#' }), '7');
check('draft-04 as 4', draftOf({ $schema: 'http://json-schema.org/draft-04/schema#' }), '4');
check('nothing declared is 2020-12', draftOf({}), '2020-12');

section('schema.ts — the library\'s report, as measured against 4.1.1');

// Canary: the declared-property quirk this module filters. When a release
// fixes it, this fails, and the filter in readable() can go.
const quirk = new Validator({ properties: { id: { type: 'number' } }, additionalProperties: false }, '2020-12', false).validate({ id: 'x' });
check('CANARY: a failing declared property is also reported as additional', quirk.errors.some((u) => u.keyword === 'false' && u.instanceLocation === '#/id'), true);
check('…and readable() drops that, keeping the type fault', readable(quirk.errors).map((f) => f.message), ['Expected a number, found a string']);

const units = (schema, doc) => new Validator(schema, '2020-12', false).validate(doc).errors;
check('a genuinely extra property is named at its key',
    readable(units({ properties: { id: {} }, additionalProperties: false }, { id: 1, zz: 2 })),
    [{ path: ['zz'], message: 'Property "zz" is not allowed', atKey: true }]);
check('anyOf says so once, not once per branch',
    readable(units({ anyOf: [{ type: 'string' }, { type: 'null' }] }, 3)).map((f) => f.message), ['Does not match any of the allowed shapes']);
check('oneOf with two matches', readable(units({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 3)).map((f) => f.message), ['Matches more than one of the allowed shapes']);
check('if/then keeps the then fault, not the if wrapper',
    readable(units({ if: { properties: { k: { const: 'a' } } }, then: { required: ['x'] } }, { k: 'a' })).map((f) => f.message), ['Missing required property "x"']);
check('a $ref wrapper disappears behind its fault',
    readable(units({ items: { $ref: '#/$defs/t' }, $defs: { t: { type: 'string' } } }, ['a', 2])),
    [{ path: ['1'], message: 'Expected a string, found a number', atKey: false }]);
check('items: false names the item', readable(units({ prefixItems: [{}], items: false }, [1, 2])).map((f) => f.message), ['This item is not allowed here']);
check('a property name failing its pattern is marked at the key',
    readable(units({ propertyNames: { pattern: '^[a-z]+$' } }, { Ab: 1 }))[0].atKey, true);
check('two expected types read as a list', readable(units({ type: ['string', 'null'] }, 3))[0].message, 'Expected a string or null, found a number');
check('enum lists the values', readable(units({ enum: ['a', 'b'] }, 'c'))[0].message, 'Must be one of "a", "b"');
check('a long enum is cut at six', readable(units({ enum: [1, 2, 3, 4, 5, 6, 7] }, 0))[0].message, 'Must be one of 1, 2, 3, 4, 5, 6, …');
check('an object property named "1" is still a property',
    readable(units({ properties: { a: {} }, additionalProperties: false }, { 1: true }))[0].message, 'Property "1" is not allowed');
check('range keywords state the rule, not the arithmetic',
    [[{ minimum: 1 }, 0], [{ maximum: 1 }, 2], [{ exclusiveMinimum: 1 }, 1], [{ exclusiveMaximum: 1.5 }, 2]].map(([s, d]) => readable(units(s, d))[0].message),
    ['Must be at least 1', 'Must be at most 1', 'Must be greater than 1', 'Must be less than 1.5']);
check('everything else keeps the library\'s sentence, tidied', readable(units({ minLength: 2 }, 'a'))[0].message, 'String is too short (1 < 2)');
check('pointers decode ~1, ~0 and percent-encoding', decodePointer('#/a~1b/c%20d/~0x/0'), ['a/b', 'c d', '~x', '0']);
check('the root pointer is the empty path', decodePointer('#'), []);

section('schema.ts — faults, positioned in the document');

const order = compileSchema(JSON.stringify({
    type: 'object',
    required: ['id', 'lines'],
    properties: {
        id: { type: 'number' },
        lines: { type: 'array', items: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' }, qty: { type: 'integer', minimum: 1 } } } },
        status: { enum: ['open', 'closed'] }
    },
    additionalProperties: false
}));
check('the order schema compiles', order.ok, true);

const orderDoc = '{\n  "id": "A-1",\n  "lines": [\n    { "sku": "x", "qty": 0 },\n    { "qty": 2 }\n  ],\n  "status": "void",\n  "note": 1\n}';
const orderFaults = order.validate(orderDoc);
check('one fault per real problem, in document order', orderFaults.map((p) => [p.line, p.column, p.message]), [
    [2, 9, 'Expected a number, found a string'],
    [4, 26, 'Must be at least 1'],
    [5, 5, 'Missing required property "sku"'],
    [7, 13, 'Must be one of "open", "closed"'],
    [8, 3, 'Property "note" is not allowed']
]);
check('a scalar is marked across its whole value', orderFaults[0].length, '"A-1"'.length);
check('a key-level fault covers the key with its quotes', orderFaults[4].length, '"note"'.length);
check('a missing property marks the object\'s opening brace, one character', [orderFaults[2].column, orderFaults[2].length], [5, 1]);

const missingRoot = order.validate('{\n  "id": 1\n}');
check('a missing property on the root marks the root brace', missingRoot.map((p) => [p.line, p.column, p.length]), [[1, 1, 1]]);

const wrongLines = order.validate('{ "id": 1, "lines": {\n  "a": 1\n} }');
check('a container in the wrong shape is marked at its key, on one line', wrongLines.map((p) => [p.line, p.column, p.length, p.message]), [[1, 12, 7, 'Expected an array, found an object']]);

check('a document that does not parse gets no schema faults', order.validate('{ "id": "A-1", }'), []);
check('an empty column gets none either', order.validate(''), []);
check('a valid document gets none', order.validate('{"id": 1, "lines": [{"sku": "a"}]}'), []);

const crlfOrder = order.validate('{\r\n  "id": 1,\r\n  "lines": [],\r\n  "note": 2\r\n}');
check('CRLF documents count lines the same', crlfOrder.map((p) => [p.line, p.column]), [[4, 3]]);

const boolSchema = compileSchema('false');
check('a false schema refuses everything, at the root', boolSchema.ok && boolSchema.validate('1').length, 1);

/* ============================================================ schemaLoader */

const { loadWebResourceSchema, webResourceUrl, fromText, schemaStatusText, schemaWithholdsVerdict } = load('schemaLoader');

section('schemaLoader.ts — a web resource, as the form answered it (SPEC.md P1–P2b)');

check('the client URL is the base, trailing slash or not', webResourceUrl('cll_/probe/order.schema.json', 'https://org.crm.dynamics.com/'), 'https://org.crm.dynamics.com/WebResources/cll_/probe/order.schema.json');
check('no client URL: root-relative, which P1 measured working too', webResourceUrl('cll_/a.json', null), '/WebResources/cll_/a.json');
check('each segment is encoded, the slashes are not', webResourceUrl('cll_/my schemas/a#1.json', ''), '/WebResources/cll_/my%20schemas/a%231.json');

/** A fetch that answers from a table and records what it was asked. */
function stubFetch(table) {
    const asked = [];
    const fn = (url, init) => {
        asked.push({ url, init });
        const answer = table[url];
        if (answer === 'offline') {
            return Promise.reject(new TypeError('Failed to fetch'));
        }
        const { status, body } = answer || { status: 404, body: '' };
        return Promise.resolve({ status, ok: status >= 200 && status < 300, text: () => Promise.resolve(body) });
    };
    fn.asked = asked;
    return fn;
}

const ORDER_SCHEMA = '{"type":"object","required":["id"],"properties":{"id":{"type":"number"}}}';
const base = 'https://org.crm.dynamics.com/WebResources/';
const loaderFetch = stubFetch({
    [base + 'cll_/order.json']: { status: 200, body: ORDER_SCHEMA },
    [base + 'cll_/script.json']: { status: 200, body: 'function x() {}' },
    [base + 'cll_/bad.json']: { status: 200, body: '{"$ref": "#/nope"}' },
    [base + 'cll_/secret.json']: { status: 403, body: '' },
    [base + 'cll_/boom.json']: { status: 500, body: '' },
    [base + 'cll_/net.json']: 'offline',
});

async function loaderChecks() {
    const ready = await loadWebResourceSchema('cll_/order.json', 'https://org.crm.dynamics.com', loaderFetch);
    check('200 with a schema: ready, and it validates', [ready.state, ready.validate('{"id": "x"}').map((p) => p.message)], ['ready', ['Expected a number, found a string']]);
    check('asked same-origin, and revalidated — cache-control: private lets the browser keep an old copy (P2b)', loaderFetch.asked[0].init, { credentials: 'same-origin', cache: 'no-cache' });
    check('a 404 is not found — the body is empty, the status is all there is (P2)', (await loadWebResourceSchema('cll_/missing.json', 'https://org.crm.dynamics.com', loaderFetch)).state, 'notFound');
    check('a 403 is denied, not missing', await loadWebResourceSchema('cll_/secret.json', 'https://org.crm.dynamics.com', loaderFetch), { state: 'denied', status: 403 });
    check('any other failure keeps its status', await loadWebResourceSchema('cll_/boom.json', 'https://org.crm.dynamics.com', loaderFetch), { state: 'failed', status: 500 });
    check('a rejected fetch is offline, and nothing throws', await loadWebResourceSchema('cll_/net.json', 'https://org.crm.dynamics.com', loaderFetch), { state: 'offline' });
    check('a Script web resource holding script is not JSON', (await loadWebResourceSchema('cll_/script.json', 'https://org.crm.dynamics.com', loaderFetch)).state, 'notJson');
    const bad = await loadWebResourceSchema('cll_/bad.json', 'https://org.crm.dynamics.com', loaderFetch);
    check('a schema that cannot resolve its own $ref says so', [bad.state, bad.message], ['invalidSchema', 'The schema refers to #/nope, which it does not contain']);
    check('an inline schema takes the same path, minus the fetch', fromText(ORDER_SCHEMA).state, 'ready');

    section('schemaLoader.ts — what the strip says, per state');

    const said = (status) => schemaStatusText(status);
    check('no schema: nothing', said({ kind: 'none' }), null);
    check('a URL: refused, as a fault', said({ kind: 'unsupported' }), { key: 'Status_SchemaUnsupported', args: [], failed: true });
    check('loading names the resource', said({ kind: 'loading', name: 'cll_/a.json' }), { key: 'Status_SchemaLoading', args: ['cll_/a.json'], failed: false });
    check('ready names it', said({ kind: 'loaded', name: 'cll_/a.json', load: ready }).key, 'Status_SchemaReady');
    check('an inline schema is not given a name it does not have', said({ kind: 'loaded', name: null, load: fromText(ORDER_SCHEMA) }), { key: 'Status_SchemaInline', args: [], failed: false });
    check('not found says to check the name and the publish', said({ kind: 'loaded', name: 'cll_/m.json', load: { state: 'notFound' } }), { key: 'Status_SchemaNotFound', args: ['cll_/m.json'], failed: true });
    check('a failure carries its status', said({ kind: 'loaded', name: 'cll_/b.json', load: { state: 'failed', status: 500 } }).args, ['cll_/b.json', '500']);
    check('inline and not JSON has its own sentence', said({ kind: 'loaded', name: null, load: fromText('{"a":') }).key, 'Status_SchemaInlineNotJson');
    check('an invalid inline schema keeps the reason', said({ kind: 'loaded', name: null, load: fromText('{"$ref":"#/x"}') }).args, ['The schema refers to #/x, which it does not contain']);

    section('schemaLoader.ts — isValid fails closed while the schema is not in force');

    const withholds = (status) => schemaWithholdsVerdict(status);
    check('no schema asked for: nothing withheld', withholds({ kind: 'none' }), false);
    check('in force: nothing withheld', withholds({ kind: 'loaded', name: 'a', load: ready }), false);
    check('loading, missing, offline, broken, refused: all withhold "valid"', [
        { kind: 'loading', name: 'a' },
        { kind: 'loaded', name: 'a', load: { state: 'notFound' } },
        { kind: 'loaded', name: 'a', load: { state: 'offline' } },
        { kind: 'loaded', name: null, load: fromText('{"a":') },
        { kind: 'unsupported' },
    ].map(withholds), [true, true, true, true, true]);

    const resx = (lcid) => require('fs').readFileSync(path.join(root, 'CodeEditor', 'strings', 'CodeEditor.' + lcid + '.resx'), 'utf8');
    const keys = ['Status_SchemaUnsupported', 'Status_SchemaLoading', 'Status_SchemaReady', 'Status_SchemaInline', 'Status_SchemaNotFound', 'Status_SchemaDenied',
        'Status_SchemaFailed', 'Status_SchemaOffline', 'Status_SchemaNotJson', 'Status_SchemaInlineNotJson', 'Status_SchemaInvalid', 'Status_SchemaInlineInvalid'];
    check('every key the strip can ask for is in both languages', ['1033', '3082'].map((l) => keys.filter((k) => !resx(l).includes('name="' + k + '"'))), [[], []]);
}

/* =============================================================== formatXml */

const { formatXml, readXml } = load('formatXml');
const TWO = { tabSize: 2, insertSpaces: true, eol: '\n' };

/** The tree with whitespace-only text dropped: what formatting must not change. */
function shape(text) {
    const walk = (nodes) => nodes
        .filter((n) => !(n.type === 'text' && n.raw.trim() === ''))
        .map((n) => n.type === 'element' ? { e: n.open, c: walk(n.children), x: n.close } : { [n.type]: n.raw });
    const nodes = readXml(text);
    return nodes ? JSON.stringify(walk(nodes)) : null;
}

section('formatXml.ts — re-indentation, and nothing else');

const fetchXml = '<fetch top="5"><entity name="account"><attribute name="name"/>\n<filter type="and"><condition attribute="statecode" operator="eq" value="0"/></filter>\n<!-- recent first --><order attribute="createdon" descending="true"/></entity></fetch>';
const fetchFormatted = formatXml(fetchXml, TWO);
check('FetchXML lays out one element per line', fetchFormatted, [
    '<fetch top="5">',
    '  <entity name="account">',
    '    <attribute name="name"/>',
    '    <filter type="and">',
    '      <condition attribute="statecode" operator="eq" value="0"/>',
    '    </filter>',
    '    <!-- recent first -->',
    '    <order attribute="createdon" descending="true"/>',
    '  </entity>',
    '</fetch>'
].join('\n'));
check('…keeps its tree', shape(fetchFormatted), shape(fetchXml));
check('formatting twice changes nothing', formatXml(fetchFormatted, TWO), fetchFormatted);

const mixed = '<doc><p>Hello <b>big</b>  world</p><q>  spaced  </q></doc>';
const mixedFormatted = formatXml(mixed, TWO);
check('mixed content and text are written back exactly', mixedFormatted, '<doc>\n  <p>Hello <b>big</b>  world</p>\n  <q>  spaced  </q>\n</doc>');

const preserve = '<a><pre xml:space="preserve">\n  <b/>\n</pre><c><d/></c></a>';
check('xml:space="preserve" is left alone, and only there', formatXml(preserve, TWO), '<a>\n  <pre xml:space="preserve">\n  <b/>\n</pre>\n  <c>\n    <d/>\n  </c>\n</a>');

const cdata = '<a><s><![CDATA[ x < y ]]></s></a>';
check('CDATA is content: its element stays as written', formatXml(cdata, TWO), '<a>\n  <s><![CDATA[ x < y ]]></s>\n</a>');

const prolog = '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE r [<!ENTITY e "v">]><r><x a="1 > 0"/></r>\n';
check('prolog, DOCTYPE with a subset, and a > inside an attribute', formatXml(prolog, TWO), '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE r [<!ENTITY e "v">]>\n<r>\n  <x a="1 > 0"/>\n</r>\n');

check('tabs when the editor indents with tabs', formatXml('<a><b/></a>', { tabSize: 4, insertSpaces: false, eol: '\n' }), '<a>\n\t<b/>\n</a>');
check('CRLF documents stay CRLF', formatXml('<a>\r\n<b/></a>', { tabSize: 2, insertSpaces: true }), '<a>\r\n  <b/>\r\n</a>');
check('an empty element keeps its inside as it was', formatXml('<a><b> </b><c></c></a>', TWO), '<a>\n  <b> </b>\n  <c></c>\n</a>');
check('a tag spanning lines is not rewritten', formatXml('<a><b\n   x="1"/></a>', TWO), '<a>\n  <b\n   x="1"/>\n</a>');

check('mismatched tags: not formatted', formatXml('<a><b></a>', TWO), null);
check('an unclosed element: not formatted', formatXml('<a><b/>', TWO), null);
check('an unterminated comment: not formatted', formatXml('<a><!-- x </a>', TWO), null);

const ribbon = '<RibbonDiffXml><CustomActions><CustomAction Id="a.b" Location="Mscrm.Form.account.MainTab.Save.Controls._children" Sequence="10"><CommandUIDefinition><Button Id="a.b.btn" Command="a.cmd" LabelText="$LocLabels:a.label" TemplateAlias="o1"/></CommandUIDefinition></CustomAction></CustomActions><Templates><RibbonTemplates Id="Mscrm.Templates"/></Templates><CommandDefinitions/><RuleDefinitions><TabDisplayRules/><DisplayRules/><EnableRules/></RuleDefinitions><LocLabels><LocLabel Id="a.label"><Titles><Title description="Go" languagecode="1033"/></Titles></LocLabel></LocLabels></RibbonDiffXml>';
const ribbonFormatted = formatXml(ribbon, TWO);
check('a ribbon definition keeps its tree', shape(ribbonFormatted), shape(ribbon));
check('…and is stable', formatXml(ribbonFormatted, TWO), ribbonFormatted);

/* ================================================================= verdict */

loaderChecks().then(verdict, (error) => {
    check('the asynchronous checks ran to the end', String(error && error.stack || error), '');
    verdict();
});

function verdict() {
    console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
    process.exit(failed === 0 ? 0 : 1);
}
