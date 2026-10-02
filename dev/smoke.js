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
    [{ path: ['zz'], message: 'Property "zz" is not allowed', key: 'Schema_PropertyNotAllowed', args: ['zz'], atKey: true }]);
check('anyOf says so once, not once per branch',
    readable(units({ anyOf: [{ type: 'string' }, { type: 'null' }] }, 3)).map((f) => f.message), ['Does not match any of the allowed shapes']);
check('oneOf with two matches', readable(units({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 3)).map((f) => f.message), ['Matches more than one of the allowed shapes']);
check('if/then keeps the then fault, not the if wrapper',
    readable(units({ if: { properties: { k: { const: 'a' } } }, then: { required: ['x'] } }, { k: 'a' })).map((f) => f.message), ['Missing required property "x"']);
check('a $ref wrapper disappears behind its fault',
    readable(units({ items: { $ref: '#/$defs/t' }, $defs: { t: { type: 'string' } } }, ['a', 2])),
    [{ path: ['1'], message: 'Expected a string, found a number', key: 'Schema_TypeExpected', args: [{ key: 'Type_string', args: [] }, { key: 'Type_number', args: [] }], atKey: false }]);
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
    check('an invalid inline schema keeps the reason, as a message to render', said({ kind: 'loaded', name: null, load: fromText('{"$ref":"#/x"}') }).args.map((a) => (typeof a === 'string' ? a : load('messages').english(a))), ['The schema refers to #/x, which it does not contain']);

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

/* ========================================================= schema navigation */

const nav = load('schemaNav');

/*
 * One schema exercising what completion and hover walk through: a $ref into
 * $defs, an allOf, a required list, an enum with a default, a deprecated
 * property, a forbidden one, a recursive definition, a Markdown and a plain
 * description.
 */
const ORDER = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['id', 'lines'],
    properties: {
        id: { type: 'string', description: 'The order_id, *as issued*.' },
        status: { title: 'Status', enum: ['open', 'closed', 'void'], default: 'open' },
        lines: { type: 'array', items: { $ref: '#/$defs/line' } },
        priority: { type: 'integer', default: 3 },
        express: { type: 'boolean' },
        legacy: { type: 'string', deprecated: true },
        meta: { $ref: '#/$defs/meta' },
        forbidden: false,
    },
    $defs: {
        line: {
            type: 'object',
            required: ['sku'],
            properties: {
                sku: { type: 'string', markdownDescription: 'Stock **keeping** unit' },
                qty: { type: 'integer', minimum: 1, examples: [1, 10] },
            },
        },
        meta: { allOf: [{ properties: { source: { const: 'web' } } }, { properties: { tags: { type: 'array' } } }] },
        node: { type: 'object', properties: { child: { $ref: '#/$defs/node' }, name: { type: 'string' } } },
    },
};

section('schemaNav.ts — which schemas describe a place');

const typesAt = (root, path) => nav.typesOf(nav.schemasAt(root, path));
check('the root describes the root', typesAt(ORDER, []), ['object']);
check('a property', typesAt(ORDER, ['id']), ['string']);
check('an array item through a $ref into $defs', typesAt(ORDER, ['lines', 0]), ['object']);
check('…and a property inside it', typesAt(ORDER, ['lines', 3, 'qty']), ['integer']);
check('allOf contributes every part', Array.from(nav.declaredProperties(ORDER, nav.schemasAt(ORDER, ['meta'])).keys()).sort(), ['source', 'tags']);
check('a property the schema says nothing about', nav.schemasAt(ORDER, ['nope']), []);
check('a property declared false is not offered', nav.declaredProperties(ORDER, nav.schemasAt(ORDER, [])).has('forbidden'), false);

const NODE = { $ref: '#/$defs/node', $defs: ORDER.$defs };
check('a recursive definition resolves at depth', typesAt(NODE, ['child', 'child', 'child', 'name']), ['string']);
const SELF = { $ref: '#' };
check('a schema that refers to itself terminates', nav.expand(SELF, SELF).length, 1);
check('a $ref to another file resolves to nothing', nav.resolveRef(ORDER, 'other.json#/x'), undefined);
check('a pointer with an escaped slash', nav.resolveRef({ 'a/b': 1 }, '#/a~1b'), 1);

const DRAFT4 = { definitions: { n: { type: 'number' } }, items: [{ $ref: '#/definitions/n' }], additionalItems: { type: 'string' } };
check('draft-04: an items array is a tuple, through definitions', typesAt(DRAFT4, [0]), ['number']);
check('draft-04: additionalItems past the tuple', typesAt(DRAFT4, [3]), ['string']);
const TUPLE = { prefixItems: [{ type: 'boolean' }], items: { type: 'null' } };
check('2020-12: prefixItems, then items', [typesAt(TUPLE, [0]), typesAt(TUPLE, [1])], [['boolean'], ['null']]);
const PATTERNS = { patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false };
check('patternProperties match by name', typesAt(PATTERNS, ['x-trace']), ['string']);
check('…and additionalProperties: false offers nothing else', nav.schemasAt(PATTERNS, ['y']), []);
check('anyOf offers every branch\'s values', nav.allowedValues(nav.schemasAt({ anyOf: [{ const: 'a' }, { const: 'b' }] }, [])), ['a', 'b']);
check('if/then/else offers both outcomes', typesAt({ if: {}, then: { type: 'string' }, else: { type: 'number' } }, []).sort(), ['number', 'string']);
check('true is the empty schema', nav.expand(true, true), [{}]);

check('a plain description is escaped for Markdown', nav.escapeMarkdown('order_id *x*'), 'order\\_id \\*x\\*');
check('documentation: title, then the description', nav.documentation(nav.schemasAt(ORDER, ['status'])), '**Status**');
check('a markdownDescription stays Markdown', nav.documentation(nav.schemasAt(ORDER, ['lines', 0, 'sku'])), 'Stock **keeping** unit');

/* ============================================================== completion */

const { complete, valuePlaceholder } = load('complete');
const LABELS = { required: 'required', deprecated: 'deprecated', defaultValue: 'default', allowedValues: 'Allowed values', defaultHeading: 'Default' };

/** A document with `|` where the caret is: the text without it, and the offset. */
function caret(marked) {
    const offset = marked.indexOf('|');
    return [marked.slice(0, offset) + marked.slice(offset + 1), offset];
}
function suggest(marked, root) {
    root = arguments.length > 1 ? root : ORDER; // a default would swallow an explicit undefined
    const [text, offset] = caret(marked);
    return complete(text, offset, root, LABELS);
}
const byName = (list, label) => list.find((s) => s.label === label);
const inOrder = (list) => list.slice().sort((a, b) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0)).map((s) => s.label);

section('complete.ts — where jsonc-parser says the caret is (3.3.1, measured)');

const { getLocation } = require('jsonc-parser');
check('a fresh line in an object is a key position, path [""]', (() => { const l = getLocation('{\n  \n}', 4); return [l.path, l.isAtPropertyKey]; })(), [[''], true]);
check('a key being typed is a "property" node, quotes included', (() => { const l = getLocation('{"pro"}', 4); return [l.previousNode.type, l.previousNode.offset, l.previousNode.length]; })(), ['property', 1, 5]);
check('an array slot after a comma claims to be a key position — the segment says otherwise', (() => { const l = getLocation('{"lines": [ {}, ]}', 15); return [l.path, l.isAtPropertyKey]; })(), [['lines', 1], true]);

section('complete.ts — property names');

const fresh = suggest('{\n  |\n}');
check('every declared property but the forbidden one', fresh.map((s) => s.label).sort(), ['express', 'id', 'legacy', 'lines', 'meta', 'priority', 'status']);
check('required first, deprecated last', inOrder(fresh), ['id', 'lines', 'express', 'meta', 'priority', 'status', 'legacy']);
check('a required property says so, with its type', byName(fresh, 'id').detail, 'string · required');
check('a deprecated one is tagged', [byName(fresh, 'legacy').deprecated, byName(fresh, 'legacy').detail], [true, 'string · deprecated']);
check('a key already in the object is not offered again', suggest('{"id": "a", |}').some((s) => s.label === 'id'), false);
check('…but the key under the caret still is', suggest('{"i|d": "a"}').some((s) => s.label === 'id'), true);
check('a new key typed above an existing one does not hide it (the harness, 2026-09-26)', suggest('{\n  "|"\n  "id": "A-1",\n  "lines": []\n}').map((s) => s.label).sort(), ['express', 'legacy', 'meta', 'priority', 'status']);

check('a string inserts empty quotes with the caret inside', byName(fresh, 'id').insertText, '"id": "$1"');
check('an enum of strings inserts a choice', byName(fresh, 'status').insertText, '"status": ${1|"open","closed","void"|}');
check('a default is the placeholder', byName(fresh, 'priority').insertText, '"priority": ${1:3}');
check('a boolean', byName(fresh, 'express').insertText, '"express": ${1:false}');
check('an array', byName(fresh, 'lines').insertText, '"lines": [$1]');
check('a $ref\'d object', byName(fresh, 'meta').insertText, '"meta": $1');
check('a single allowed value is inserted as itself', valuePlaceholder([{ const: 'web' }]), '"web"');
check('snippet syntax in a default is escaped', valuePlaceholder([{ default: 'a$b}c' }]), '${1:"a\\$b\\}c"}');

const typed = suggest('{"st|"}');
check('inside quotes: the quoted key is replaced whole', [byName(typed, 'status').start, byName(typed, 'status').end], [1, 5]);
check('…and filtered with its quotes', byName(typed, 'status').filterText, '"status"');
check('renaming a key keeps its colon and value', byName(suggest('{"st|": 1}'), 'status').insertText, '"status"');
check('a property that has one after it gets a comma', byName(suggest('{\n  |\n  "id": "a"\n}'), 'status').insertText.endsWith(','), true);
check('a bare word is replaced from its start', (() => { const s = byName(suggest('{ sta| }'), 'status'); return [s.start, s.end]; })(), [2, 5]);

check('inside an array item, the item\'s own properties', suggest('{"lines": [ { | } ]}').map((s) => s.label).sort(), ['qty', 'sku']);
check('…with its own required first', inOrder(suggest('{"lines": [ { | } ]}')), ['sku', 'qty']);
check('a plain description arrives escaped', byName(fresh, 'id').documentation, 'The order\\_id, \\*as issued\\*\\.');

section('complete.ts — values');

const values = suggest('{"status": |}');
check('an enum after the colon', values.map((s) => s.label), ['"open"', '"closed"', '"void"']);
check('the default says so', byName(values, '"open"').detail, 'default');
const inString = suggest('{"status": "o|"}');
check('inside a string value: the string is replaced whole', [byName(inString, '"open"').start, byName(inString, '"open"').end], [11, 14]);
check('examples, where there is no enum', suggest('{"lines": [ { "qty": | } ]}').map((s) => s.label), ['1', '10']);
check('a boolean offers both', suggest('{"express": |}').map((s) => s.label), ['true', 'false']);
check('an array offers an empty one, caret inside', byName(suggest('{"lines": |}'), '[]').insertText, '[$1]');
check('a place the schema says nothing about offers nothing', suggest('{"nope": |}'), []);
check('the root of an empty document offers an object', suggest('|').map((s) => s.label), ['{}']);

section('complete.ts — no schema, no list');

check('false as the schema', suggest('{\n  |\n}', false), []);
check('undefined as the schema', suggest('{\n  |\n}', undefined), []);
check('an empty schema offers no names', suggest('{\n  |\n}', {}), []);

/* ================================================================== hover */

const { hover } = load('hover');
function hoverAt(marked, root) {
    root = arguments.length > 1 ? root : ORDER;
    const [text, offset] = caret(marked);
    return hover(text, offset, root, LABELS);
}

section('hover.ts — what the schema says under the pointer');

const onKey = hoverAt('{"i|d": "a", "lines": []}');
check('on a key: the key is the range', [onKey.offset, onKey.length], [1, 4]);
check('…and the text is the description, the type, required', onKey.markdown, 'The order\\_id, \\*as issued\\*\\.\n\n`string` · required');
check('on a value: its allowed values and default', hoverAt('{"status": "o|pen"}').markdown, '**Status**\n\nAllowed values: `"open"`, `"closed"`, `"void"`\n\nDefault: `"open"`');
check('deprecated says so', hoverAt('{"leg|acy": "x"}').markdown, '`string` · deprecated');
check('inside an array item, through the $ref', hoverAt('{"lines": [ { "s|ku": "x" } ]}').markdown, 'Stock **keeping** unit\n\n`string` · required');
check('a key the schema does not describe has no hover', hoverAt('{"zz|z": 1}'), null);
check('no schema, no hover', hoverAt('{"i|d": 1}', undefined), null);
const many = { enum: Array.from({ length: 14 }, (_, i) => i) };
check('a long enum is cut at ten, and says how many more', hoverAt('|1', many).markdown, 'Allowed values: `0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, … (+4)');

/* =================================================================== clip */

const clip = load('clip');
const VIEW = { top: 0, left: 0, bottom: 800, right: 1000 };

section('clip.ts — whether the caret\'s line can be seen (SPEC.md P1b)');

check('two rectangles that do not meet', clip.intersect({ top: 0, left: 0, bottom: 10, right: 10 }, { top: 20, left: 0, bottom: 30, right: 10 }), null);
const form = clip.visibleArea(VIEW, [{ top: 120, left: 0, bottom: 1400, right: 900 }, { top: 60, left: 20, bottom: 780, right: 880 }]);
check('what survives the viewport and every clip', form, { top: 120, left: 20, bottom: 780, right: 880 });
check('a line inside it is visible', clip.lineVisible(form, { top: 300, bottom: 319 }), true);
check('a line under the header (above the scroll container) is not', clip.lineVisible(form, { top: 100, bottom: 119 }), false);
check('half a line under the header is not either', clip.lineVisible(form, { top: 110, bottom: 129 }), false);
check('a pixel of rounding is forgiven', clip.lineVisible(form, { top: 119.5, bottom: 138 }), true);
check('below the fold is not', clip.lineVisible(form, { top: 790, bottom: 809 }), false);
check('nothing visible at all', clip.lineVisible(clip.visibleArea(VIEW, [{ top: 900, left: 0, bottom: 1000, right: 10 }]), { top: 950, bottom: 960 }), false);

/* ================================================================== echo */

const { EchoGuard } = load('echo');

section('echo.ts — the form\'s own change, or an echo of this control\'s write');

{
    // The editor holds what was typed; the form echoes each keystroke late,
    // the earliest last (as measured), and the editor has lost focus.
    const guard = new EchoGuard();
    ['{"a":1', '{"a":12', '{"a":123'].forEach((v) => guard.wrote(v));
    check('the echo of the latest write is not taken', guard.takes('{"a":123', '{"a":123'), false);
    check('nor a late echo of an earlier keystroke — the blur-inside-the-echo-window case', guard.takes('{"a":12', '{"a":123'), false);
    check('nor the earliest one, whatever its order', guard.takes('{"a":1', '{"a":123'), false);
    check('a value the control never wrote is the form\'s, and is taken', guard.takes('{"set":"by a script"}', '{"a":123'), true);
    check('…and after it, an old write coming back is the form\'s too: the list started again', guard.takes('{"a":12', '{"set":"by a script"}'), true);
}

{
    // PCFHub's demo: the preset's value on every pass, never the output.
    const guard = new EchoGuard();
    check('the first pass is taken', guard.takes('{"preset":true}', ''), true);
    guard.wrote('{"preset":true,"edited":1}');
    check('the host repeating its last value is not news — the hub demo re-renders that way', guard.takes('{"preset":true}', '{"preset":true,"edited":1}'), false);
    check('a different preset is', guard.takes('{"other":true}', '{"preset":true,"edited":1}'), true);
}

{
    const guard = new EchoGuard();
    for (let i = 0; i < 40; i += 1) {
        guard.wrote(`v${i}`);
    }
    check('the list is bounded: a write sixteen back is still an echo, one older is the form\'s', [guard.takes('v24', 'v39'), guard.takes('v23', 'v39')], [false, true]);
}

/* ============================================================ page theme */

const { pageTheme } = load('theme');

section('theme.ts — one theme per page, and who decides it');

check('no controls: light', pageTheme([]), 'vs');
check('auto on a dark app', pageTheme([{ preference: 'auto', isDarkTheme: true }]), 'vs-dark');
check('forced dark beside auto on a light app: dark (the P5 form)', pageTheme([{ preference: 'dark' }, { preference: 'auto', isDarkTheme: false }]), 'vs-dark');
check('…whichever arrived first', pageTheme([{ preference: 'auto', isDarkTheme: false }, { preference: 'dark' }]), 'vs-dark');
check('two forced themes: the last to arrive', pageTheme([{ preference: 'dark' }, { preference: 'Light' }]), 'vs');
check('two autos read the same app', pageTheme([{ preference: null, isDarkTheme: false }, { preference: 'auto', isDarkTheme: false }]), 'vs');

/* ============================================================== registry */

const { schemaRegistry } = load('schemaRegistry');
// fromText is loaded with the schemaLoader sections above.

section('schemaRegistry.ts, schemaLoader.ts — a schema filed per editor');

check('a loaded schema carries the parsed document for completion', fromText('{"type":"object"} // a comment').schema, { type: 'object' });
schemaRegistry.set('inmemory://model/1', { schema: ORDER, labels: LABELS });
schemaRegistry.set('inmemory://model/2', { schema: { type: 'object' }, labels: LABELS });
check('two editors, two schemas (SPEC.md P5)', [schemaRegistry.get('inmemory://model/1').schema === ORDER, schemaRegistry.get('inmemory://model/2').schema.type], [true, 'object']);
schemaRegistry.delete('inmemory://model/1');
schemaRegistry.delete('inmemory://model/2');
check('destroy leaves nothing behind', [schemaRegistry.size, schemaRegistry.get('inmemory://model/1')], [0, undefined]);

/* ============================================================ FetchXML (1.5.0) */

/*
 * FetchXML completion, hover and checks — pure modules, driven here with a
 * snapshot built by hand, and metadata.ts driven through the template rig's
 * fetch stub (dev/host.js), which answers the table-definition reads in the
 * shapes the 1.4.9 probe measured on the form (SPEC.md P1–P5).
 */

const { scanXml, placeAt } = load('xmlCursor');
const { ELEMENTS, OPERATORS, operatorOf } = load('fetchGrammar');
const { fetchComplete } = load('fetchComplete');
const { fetchHover } = load('fetchHover');
const { fetchValidate } = load('fetchValidate');
const { fetchRegistry } = load('fetchRegistry');
const { metadataFor, forgetMetadata } = load('metadata');
const { isError } = load('validate');
const rigHost = require('./host');
const rigFixture = require('./fixture');

/** `|` marks the caret. */
function caretAt(src) {
    const offset = src.indexOf('|');
    return { text: src.slice(0, offset) + src.slice(offset + 1), offset };
}

const FETCH_LABELS = {
    required: 'required', deprecated: 'deprecated', relationship: 'relationship {0}', manyToMany: 'many-to-many, through to {0}',
    allowedValues: 'Allowed values',
    takes: { none: 'Takes no value.', one: 'Takes one value.', count: 'Takes a number.', two: 'Takes two values.', many: 'Takes a list.' },
    notReadable: 'Not valid for read.', shadowOf: 'The name of {0}.'
};

const COL = (name, type, label, extra = {}) => Object.assign({ name, type, typeName: type + 'Type', label, description: null, readable: true, shadowOf: null }, extra);
const ACCOUNT = [
    COL('accountid', 'Uniqueidentifier', 'Account'),
    COL('accountnumber', 'String', 'Account Number'),
    COL('createdon', 'DateTime', 'Created On'),
    COL('industrycode', 'Picklist', 'Industry'),
    COL('isprivate', 'Boolean', 'Is Private', { readable: false }),
    COL('name', 'String', 'Account Name', { description: 'Type the company name.' }),
    COL('primarycontactid', 'Lookup', 'Primary Contact'),
    COL('primarycontactidname', 'Virtual', null, { typeName: 'VirtualType', shadowOf: 'primarycontactid' }),
    COL('revenue', 'Money', 'Annual Revenue'),
    COL('statecode', 'State', 'Status')
];
const CONTACT = [COL('contactid', 'Uniqueidentifier', 'Contact'), COL('fullname', 'String', 'Full Name')];

/** A Snapshot from plain data: absent is "never asked", a string a failure state. */
function snapshotOf(data) {
    const wrap = (v) => (v === undefined ? undefined : typeof v === 'string' ? { state: v, status: 404 } : { state: 'ready', value: v });
    return {
        tables: () => wrap(data.tables),
        columns: (t) => wrap((data.columns || {})[t]),
        links: (t) => wrap((data.links || {})[t]),
        options: (t, c) => wrap((data.options || {})[t + '.' + c])
    };
}

const FULL = snapshotOf({
    tables: [{ name: 'account', label: 'Account', entitySet: 'accounts', primaryId: 'accountid', primaryName: 'name', intersect: false }, { name: 'contact', label: 'Contact', entitySet: 'contacts', primaryId: 'contactid', primaryName: 'fullname', intersect: false }],
    columns: { account: ACCOUNT, contact: CONTACT, nosuchtable: 'notFound' },
    links: { account: [
        { kind: 'manyToOne', schemaName: 'account_primary_contact', table: 'contact', from: 'contactid', to: 'primarycontactid', intersect: false },
        { kind: 'manyToMany', schemaName: 'cll_account_tag', table: 'cll_account_tag', from: 'accountid', to: 'accountid', intersect: true, through: 'cll_tag' }
    ] },
    options: { 'account.industrycode': [{ value: 1, label: 'Accounting' }, { value: 2, label: 'Agriculture' }] }
});
const EMPTY = snapshotOf({});

const fetchAt = (src, snapshot = FULL) => {
    const c = caretAt(src);
    return fetchComplete(c.text, c.offset, snapshot, FETCH_LABELS);
};
const labelsOf = (answer) => answer.suggestions.slice().sort((a, b) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0)).map((s) => s.label);
const ENTITY = (inner) => `<fetch>\n  <entity name="account">\n    ${inner}\n  </entity>\n</fetch>`;

section('xmlCursor.ts — a document half-way through being typed');

{
    const where = (src) => {
        const c = caretAt(src);
        const doc = scanXml(c.text);
        const p = placeAt(doc, c.text, c.offset);
        const name = (i) => (i >= 0 ? doc.elements[i].name : null);
        return [p.kind, name(p.element !== undefined ? p.element : p.open), p.parent === undefined ? undefined : name(p.parent), p.start === undefined ? undefined : c.text.slice(p.start, p.end)];
    };
    check('a lone < under entity is an element name, with entity as its parent', where(ENTITY('<|')), ['elementName', '', 'entity', '']);
    check("an unclosed value stops at the line's end, not at the next tag", where(ENTITY('<attribute name="na|')), ['attributeValue', 'attribute', undefined, 'na']);
    check('between an attribute and /> a new attribute goes', where(ENTITY('<attribute name="name" |/>')), ['attributeName', 'attribute', undefined, '']);
    check('in a close tag: the element it should close', where('<fetch><entity name="a"></|'), ['closeTag', 'entity', undefined, '']);
    check('inside a comment, nowhere', where('<fetch><!-- <attri|bute --></fetch>')[0], 'none');
    const doc = scanXml('<fetch><entity name="a"><attribute name="x" <filter></filter></entity></fetch>');
    const filter = doc.elements.find((e) => e.name === 'filter');
    check('a tag still being typed does not adopt the siblings after it', doc.elements[filter.parent].name, 'entity');
    const open = scanXml('<fetch><entity name="a"><link-entity name="b"><attribute name="x"/></entity></fetch>');
    check('an element a mismatched close cuts off ends there, unclosed', open.elements.map((e) => e.name + (e.closed ? '' : '*')), ['fetch', 'entity', 'link-entity*', 'attribute']);
}

section('fetchGrammar.ts — FetchXML as data (Learn, 2026-10-01, plus what the server said)');

check('every child an element names is an element', Object.values(ELEMENTS).flatMap((e) => e.children).filter((c) => !ELEMENTS[c]), []);
check('every enum and boolean attribute lists its values', Object.values(ELEMENTS).flatMap((e) => e.attributes).filter((a) => (a.kind === 'enum' || a.kind === 'boolean') && !(a.values && a.values.length)).map((a) => a.name), []);
check('no-attrs is a child of entity — the server listed it, Learn does not (P2)', ELEMENTS.entity.children.includes('no-attrs'), true);
check('operators are unique, and neq is the deprecated one', [new Set(OPERATORS.map((o) => o.name)).size === OPERATORS.length, OPERATORS.filter((o) => o.deprecated).map((o) => o.name)], [true, ['neq']]);
check('between takes two values, in takes a list, null none', ['between', 'in', 'null', 'last-x-days'].map((n) => operatorOf(n).arity), ['two', 'many', 'none', 'count']);

section('fetchComplete.ts — elements and attributes, from the grammar');

check('< under entity: its children, in the reference order', labelsOf(fetchAt(ENTITY('<|'))), ['attribute', 'all-attributes', 'no-attrs', 'order', 'filter', 'link-entity']);
check('< at the top: fetch', labelsOf(fetchAt('<|')), ['fetch']);
check('under a fetch that has its entity: not a second one', labelsOf(fetchAt('<fetch>\n  <entity name="account"/>\n  <|\n</fetch>')), []);
{
    const fresh = fetchAt(ENTITY('<|')).suggestions.find((s) => s.label === 'attribute');
    const renamed = fetchAt(ENTITY('<attr|ibute name="name"/>')).suggestions.find((s) => s.label === 'attribute');
    check('a new tag gets its snippet; renaming an existing one changes the name alone', [fresh.insertText, fresh.snippet, renamed.insertText, renamed.snippet], ['attribute name="$1" />', true, 'attribute', false]);
}
{
    const attrs = fetchAt(ENTITY('<attribute alias="a" |/>'));
    const name = attrs.suggestions.find((s) => s.label === 'name');
    check('attribute names: required first, the ones present left out', labelsOf(attrs).slice(0, 3), ['name', 'aggregate', 'groupby']);
    check('…and taking one opens the list inside its quotes', [name.insertText, name.detail, name.retrigger, attrs.suggestions.some((s) => s.label === 'alias')], ['name="$1"', 'required', true, false]);
}
check('a closing tag: the element still open', fetchAt('<fetch><entity name="account"></|').suggestions.map((s) => s.insertText), ['entity>']);
check('an unknown element offers no attributes', fetchAt(ENTITY('<nosuch |/>')).suggestions, []);

section('fetchComplete.ts — names from the table definitions');

{
    const cold = fetchAt(ENTITY('<attribute name="|"/>'), EMPTY);
    check('columns not read yet: nothing offered, and the columns asked for', [cold.suggestions.length, cold.needs], [0, [{ kind: 'columns', table: 'account' }]]);
    const warm = fetchAt(ENTITY('<attribute name="|"/>'));
    const name = warm.suggestions.find((s) => s.label === 'name');
    check("read: the table's columns, without the shadow or the one not valid for read (P2)", [warm.needs, warm.suggestions.some((s) => s.label === 'primarycontactidname'), warm.suggestions.some((s) => s.label === 'isprivate'), warm.suggestions.length], [[], false, false, 8]);
    check('…with the display name to read and to filter by', [name.detail, name.filterText, name.insertText], ['Account Name · String', 'name Account Name', 'name']);
    check('no reader at all (canvas, the demo): no list and nothing asked', fetchAt(ENTITY('<attribute name="|"/>'), null), { suggestions: [], needs: [] });
}
check('inside a link-entity: the linked table\'s columns', labelsOf(fetchAt(ENTITY('<link-entity name="contact">\n      <attribute name="|"/>\n    </link-entity>'))), ['contactid', 'fullname']);
check('from is the linked table\'s, to the table it links from', [labelsOf(fetchAt(ENTITY('<link-entity name="contact" from="|"/>'))), labelsOf(fetchAt(ENTITY('<link-entity name="contact" from="contactid" to="|"/>'))).length], [['contactid', 'fullname'], 8]);
check('a condition with entityname: the aliased link-entity\'s table', labelsOf(fetchAt(ENTITY('<link-entity name="contact" alias="c"/>\n    <filter><condition entityname="c" attribute="|"/></filter>'))), ['contactid', 'fullname']);
check('entityname offers the link-entities by alias, else by name', labelsOf(fetchAt(ENTITY('<link-entity name="contact" alias="c"/><link-entity name="lead"/>\n    <filter><condition entityname="|"/></filter>'))), ['c', 'lead']);
{
    const closed = fetchAt(ENTITY('<link-entity name="|">\n    </link-entity>'));
    const join = closed.suggestions.find((s) => s.kind === 'relationship' && s.label === 'contact');
    const m2m = closed.suggestions.find((s) => s.kind === 'relationship' && s.label === 'cll_account_tag');
    check('a link-entity name: the joins first, each filling from and to inside the quotes already typed', [labelsOf(closed)[0], join.insertText, join.detail], ['cll_account_tag', 'contact" from="contactid" to="primarycontactid', 'relationship account_primary_contact']);
    check('…a many-to-many goes through its intersect table', [m2m.insertText, m2m.detail], ['cll_account_tag" from="accountid" to="accountid" intersect="true', 'many-to-many, through to cll_tag']);
    const open = fetchAt(ENTITY('<link-entity name="|'));
    check('…and closes the quote itself when it was not typed', open.suggestions.find((s) => s.label === 'contact' && s.kind === 'relationship').insertText, 'contact" from="contactid" to="primarycontactid"');
    check('…but where from or to is already there, the name alone', fetchAt(ENTITY('<link-entity name="|" from="contactid"/>')).suggestions.filter((s) => s.kind === 'relationship').map((s) => s.insertText), ['contact', 'cll_account_tag']);
    check('…and the plain tables after the joins', closed.suggestions.filter((s) => s.kind === 'table').map((s) => s.label), ['account', 'contact']);
}
check('the table list not read yet is asked for', fetchAt('<fetch><entity name="|"/></fetch>', EMPTY).needs, [{ kind: 'tables' }]);
{
    const rank = (column, op) => fetchAt(ENTITY(`<filter><condition attribute="${column}" operator="|"/></filter>`)).suggestions.find((s) => s.label === op).sortText[0];
    check('operators ranked by the column\'s type, never filtered out', [rank('createdon', 'last-x-days'), rank('createdon', 'like'), rank('name', 'like'), rank('name', 'neq')], ['0', '1', '0', '2']);
}
{
    const cold = fetchAt(ENTITY('<filter><condition attribute="industrycode" operator="eq" value="|"/></filter>'), snapshotOf({ columns: { account: ACCOUNT } }));
    check("a choice's value: its options asked for", cold.needs, [{ kind: 'options', table: 'account', column: 'industrycode' }]);
    const warm = fetchAt(ENTITY('<filter><condition attribute="industrycode" operator="eq" value="|"/></filter>'));
    check('…then offered by label, inserting the number', warm.suggestions.map((s) => [s.label, s.insertText]), [['Accounting', '1'], ['Agriculture', '2']]);
    check('…in a <value> as well', fetchAt(ENTITY('<filter><condition attribute="industrycode" operator="in"><value>|</value></condition></filter>')).suggestions.map((s) => s.insertText), ['1', '2']);
    check('a column that is not a choice offers no values', fetchAt(ENTITY('<filter><condition attribute="name" operator="eq" value="|"/></filter>')).suggestions, []);
}

section('fetchHover.ts — what a name means');

{
    const hoverAt = (src, snapshot = FULL) => {
        const c = caretAt(src);
        return fetchHover(c.text, c.offset, snapshot, FETCH_LABELS);
    };
    check('an element: its description', hoverAt(ENTITY('<link-en|tity name="contact"/>')).answer.markdown, ELEMENTS['link-entity'].description);
    check('an operator: what it does and what it takes', hoverAt(ENTITY('<filter><condition attribute="createdon" operator="last-x-d|ays" value="7"/></filter>')).answer.markdown.split('\n\n').slice(0, 2), ['In the last x days\\.', 'Takes a number\\.']);
    check('a column: its display name, where it lives and its type', hoverAt(ENTITY('<attribute name="na|me"/>')).answer.markdown.split('\n\n').slice(0, 3), ['**Account Name** `account.name`', '`String`', 'Type the company name\\.']);
    check('a shadow column says whose name it is', hoverAt(ENTITY('<attribute name="primarycontactid|name"/>')).answer.markdown.includes('The name of primarycontactid\\.'), true);
    check('columns not read yet: no hover, and the columns asked for', hoverAt(ENTITY('<attribute name="na|me"/>'), EMPTY), { answer: null, needs: [{ kind: 'columns', table: 'account' }] });
    check("a choice's number: its label", hoverAt(ENTITY('<filter><condition attribute="industrycode" operator="eq" value="|1"/></filter>')).answer.markdown, '**Accounting** `1`');
}

section('fetchValidate.ts — errors where the server refuses, warnings for the rest (P2)');

{
    const problems = (src, snapshot = FULL) => fetchValidate(src, snapshot).problems.map((p) => [p.severity, p.message]);
    check('a clean query: nothing', problems(ENTITY('<attribute name="name"/>\n    <filter type="and"><condition attribute="createdon" operator="last-x-days" value="7"/></filter>')), []);
    check('an element FetchXML does not have is an error — the server refuses it (0x8004111c)', problems(ENTITY('<atribute name="name"/>')), [['error', '<atribute> is not a FetchXML element — <entity> takes <attribute>, <all-attributes>, <no-attrs>, <order>, <filter>, <link-entity>']]);
    check('so is an element its parent does not take', problems(ENTITY('<condition attribute="name" operator="null"/>'))[0][0], 'error');
    check('and an operator the server does not know (0x80041120)', problems(ENTITY('<filter><condition attribute="name" operator="equals" value="x"/></filter>')), [['error', 'Unknown operator "equals"']]);
    check('an attribute FetchXML does not have is a warning — the server runs it', problems('<fetch nosuch="1"><entity name="account"><attribute name="name"/></entity></fetch>'), [['warning', '<fetch> has no "nosuch" attribute — Dataverse ignores it']]);
    check('Advanced Find\'s own attributes are not warned about', problems('<fetch version="1.0" output-format="xml-platform" mapping="logical"><entity name="account"><attribute name="name"/></entity></fetch>'), []);
    check('a value outside a fixed list, a missing name and a second entity: warnings', problems('<fetch><entity name="account"><link-entity name="contact" link-type="innr"/></entity><entity/></fetch>').map((p) => p[0]), ['warning', 'warning', 'warning']);
    check('a column the table does not have: a warning naming both', problems(ENTITY('<attribute name="nmae"/>')), [['warning', 'account has no column "nmae"']]);
    check('a shadow is a name the server takes: no warning; one not valid for read: a warning', problems(ENTITY('<attribute name="primarycontactidname"/><attribute name="isprivate"/>')), [['warning', 'account.isprivate is not valid for read — Dataverse refuses it']]);
    check('a table the environment does not have: a warning', problems('<fetch><entity name="nosuchtable"/></fetch>'), [['warning', 'There is no table "nosuchtable" in this environment']]);
    check("a value that is not one of the choice's options: a warning", problems(ENTITY('<filter><condition attribute="industrycode" operator="in"><value>1</value><value>99</value></condition></filter>')), [['warning', '99 is not an option of account.industrycode']]);
    check('an entityname that names no link-entity: a warning', problems(ENTITY('<filter><condition entityname="zz" attribute="name" operator="null"/></filter>')).map((p) => p[1]), ['No link-entity is named or aliased "zz"']);
    check('metadata not read yet: names unchecked, and the columns asked for', fetchValidate(ENTITY('<attribute name="nmae"/>'), EMPTY), { problems: [], needs: [{ kind: 'columns', table: 'account' }] });
    check('warnings never count against the verdict', fetchValidate(ENTITY('<attribute name="nmae"/>'), FULL).problems.filter(isError).length, 0);
}

section('fetchRegistry.ts — one entry per editor');

fetchRegistry.set('inmemory://model/7', { metadata: null, labels: FETCH_LABELS });
check('filed and taken back', [fetchRegistry.get('inmemory://model/7').metadata, (fetchRegistry.delete('inmemory://model/7'), fetchRegistry.size)], [null, 0]);

{
    // Every key index.ts can ask for, read off the source, in both languages.
    const source = require('fs').readFileSync(path.join(root, 'CodeEditor', 'index.ts'), 'utf8');
    const keys = [...new Set([...source.matchAll(/this\.text\("([A-Za-z_]+)"/g), ...source.matchAll(/key: "([A-Za-z_]+)"/g), ...source.matchAll(/said\("([A-Za-z_]+)"/g)].map((m) => m[1]))];
    const resx = (lcid) => require('fs').readFileSync(path.join(root, 'CodeEditor', 'strings', 'CodeEditor.' + lcid + '.resx'), 'utf8');
    check('every key index.ts asks for is in both languages (' + keys.length + ')', ['1033', '3082'].map((l) => keys.filter((k) => !resx(l).includes('name="' + k + '"'))), [[], []]);
}

section('messages.ts — every message in the resx, in both languages');

{
    const { ENGLISH, render, said: sayIt, english } = load('messages');
    const read = (lcid) => {
        const xml = require('fs').readFileSync(path.join(root, 'CodeEditor', 'strings', 'CodeEditor.' + lcid + '.resx'), 'utf8');
        const out = {};
        for (const m of xml.matchAll(/<data name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g)) {
            out[m[1]] = m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        }
        return out;
    };
    const en = read('1033');
    const es = read('3082');
    const keys = Object.keys(ENGLISH);
    check('every message key is in the 1033 resx, word for word as the checks write it (' + keys.length + ')', keys.filter((k) => en[k] !== ENGLISH[k]), []);
    const holes = (t) => (t.match(/\{\d+\}/g) || []).sort().join();
    check('…and in the 3082 resx, translated, with the same placeholders', keys.concat(['Status_Position']).filter((k) => !es[k] || es[k] === en[k] && /[a-z]{4}/.test(en[k]) && !/^(null|true o false)$/.test(es[k]) || holes(es[k]) !== holes(en[k])), []);

    // Every key a check produces is one the resx has: run each kind of fault.
    const produced = [
        ...validateJson('{"a": 1,}'), ...validateJson('{"a" 1}'), ...validateJson('{ // c\n}'),
        ...compileSchema('{"type":"object","required":["id"],"properties":{"n":{"type":["string","null"]},"q":{"minimum":1},"s":{"enum":["a"]}},"additionalProperties":false}').validate('{"n":3,"q":0,"s":"b","zz":1}'),
        ...fetchValidate(ENTITY('<atribute name="x"/><condition attribute="name" operator="null"/><attribute name="nmae" nosuch="1"/><filter><condition attribute="name" operator="equals"/></filter>'), FULL).problems,
        ...fetchValidate('<fetch><entity name="nosuchtable"/></fetch>', FULL).problems
    ];
    check('every key the checks produce is in the resx', [...new Set(produced.map((p) => p.key))].filter((k) => !k || !en[k] || !es[k]), []);
    check('…and its English is the message the suite reads', produced.filter((p) => english({ key: p.key, args: p.args || [] }) !== p.message).map((p) => p.message), []);

    const spanish = (key) => es[key] || null;
    const typeFault = produced.find((p) => p.key === 'Schema_TypeExpected');
    check('rendered from the 3082 resx, a fault reads in Spanish — the type list and its "or" too', render({ key: typeFault.key, args: typeFault.args }, spanish), 'Se esperaba una cadena o null, se encontró un número');
    check('…a FetchXML fault', render({ key: 'Fetch_UnknownElement', args: ['atribute', 'entity', '<attribute>'] }, spanish), '<atribute> no es un elemento de FetchXML: <entity> admite <attribute>');
    check('…the strip\'s position', render(sayIt('Status_Position', '5', '6', 'x'), spanish), 'Lín. 5, col. 6: x');
    check('a key with no translation falls back to the English', render(sayIt('Json_ValueExpected'), () => null), 'Expected a value');
    check('a placeholder used twice is filled twice', render({ key: 'x', args: ['a'] }, () => '{0} and {0}'), 'a and a');
}

/*
 * metadata.ts against the rig — the reads in the measured shapes, the cache,
 * and the failures as states.
 */
async function metadataChecks() {
    section('metadata.ts — the table definitions, through the rig (P1–P5)');

    forgetMetadata();
    const ctx = rigHost.createContext({ fixture: rigFixture, clientUrl: rigHost.nextClientUrl() });
    const url = ctx.page.getClientUrl();
    const asked = [];
    const counted = (u, init) => {
        asked.push(u);
        return fetch(u, init);
    };
    const md = metadataFor(url, 1033, counted);
    check('one reader per organisation and language, shared by every editor', metadataFor(url + '/', 1033, counted) === md, true);

    await Promise.all([md.ensure([{ kind: 'tables' }]), md.ensure([{ kind: 'tables' }])]);
    const tables = md.tables();
    check('the table list: read once however many ask, with LabelLanguages', [asked.length, /LabelLanguages=1033$/.test(asked[0]), /\$filter=IsPrivate eq false/.test(asked[0])], [1, true, true]);
    check('…every non-private table, its label, the intersect flagged', [tables.state, tables.value.map((t) => t.name), tables.value[0].label, tables.value.find((t) => t.name === 'cll_account_tag').intersect], ['ready', ['account', 'cll_account_tag', 'cll_tag', 'contact'], 'Account', true]);

    await md.ensure([{ kind: 'columns', table: 'account' }]);
    const cols = md.columns('account').value;
    const col = (n) => cols.find((c) => c.name === n);
    check("a table's columns: the shadow, the unreadable one and the multi-select as measured", [col('primarycontactidname').shadowOf, col('primarycontactidname').label, col('isprivate').readable, col('cll_classification').typeName], ['primarycontactid', null, false, 'MultiSelectPicklistType']);

    await md.ensure([{ kind: 'links', table: 'account' }]);
    const links = md.links('account').value;
    const link = (kind, table) => links.find((l) => l.kind === kind && l.table === table);
    check('a lookup on the table: link to what it points at, from its key to the lookup', [link('manyToOne', 'contact').from, link('manyToOne', 'contact').to], ['contactid', 'primarycontactid']);
    check('a lookup pointing at the table: link to its rows, from the lookup to the key', [link('oneToMany', 'account').from, link('oneToMany', 'account').to], ['parentaccountid', 'accountid']);
    check('a many-to-many: through the intersect table, from its column to the key', [link('manyToMany', 'cll_account_tag').from, link('manyToMany', 'cll_account_tag').to, link('manyToMany', 'cll_account_tag').through], ['accountid', 'accountid', 'cll_tag']);

    await md.ensure([{ kind: 'options', table: 'account', column: 'industrycode' }, { kind: 'options', table: 'account', column: 'donotemail' }, { kind: 'options', table: 'account', column: 'statecode' }]);
    check("a choice's options through its cast; a Yes/No's true option first", [md.options('account', 'industrycode').value.length, md.options('account', 'donotemail').value, md.options('account', 'statecode').value[1]], [3, [{ value: 1, label: 'Do Not Allow' }, { value: 0, label: 'Allow' }], { value: 1, label: 'Inactive' }]);

    await md.ensure([{ kind: 'columns', table: 'nosuchtable' }]);
    check('a table that is not there is an answer, not a failure', [md.columns('nosuchtable').state, md.failure()], ['notFound', null]);

    const end = fetchAt(ENTITY('<attribute name="|"/>'), md);
    check('completion reads the reader as its snapshot', end.suggestions.some((s) => s.label === 'name') && end.needs.length === 0, true);

    const refusedCtx = rigHost.createContext({ fixture: rigFixture, clientUrl: rigHost.nextClientUrl(), metadataStatus: 403 });
    const refusedAsked = [];
    const refused = metadataFor(refusedCtx.page.getClientUrl(), 1033, (u, init) => { refusedAsked.push(u); return fetch(u, init); });
    await refused.ensure([{ kind: 'tables' }]);
    await refused.ensure([{ kind: 'tables' }]);
    check('a refusal is kept as a state and never asked again', [refused.tables().state, refused.failure().state, refusedAsked.length], ['denied', 'denied', 1]);

    const offlineCtx = rigHost.createContext({ fixture: rigFixture, clientUrl: rigHost.nextClientUrl(), metadataStatus: 0 });
    const offline = metadataFor(offlineCtx.page.getClientUrl(), 1033, (u, init) => fetch(u, init));
    await offline.ensure([{ kind: 'columns', table: 'account' }]);
    check('offline is a state too, and what the strip names', [offline.columns('account').state, offline.failure()], ['offline', { state: 'offline' }]);

    check('a canvas host has no context.page, so the control makes no reader and asks nothing', rigHost.createContext({ fixture: rigFixture, host: 'canvas' }).page, undefined);
}

/* ================================================================= verdict */

loaderChecks().then(metadataChecks).then(verdict, (error) => {
    check('the asynchronous checks ran to the end', String(error && error.stack || error), '');
    verdict();
});

function verdict() {
    console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
    process.exit(failed === 0 ? 0 : 1);
}
