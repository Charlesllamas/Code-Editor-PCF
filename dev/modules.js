/*
 * Load a control's own TypeScript modules in Node, without the bundle.
 *
 *     const { createLoader } = require('./modules');
 *     const load = createLoader({ root: path.join(__dirname, '..', 'CodeEditor'), forbid: /monaco-editor/ });
 *     const { validateJson } = load('validate');
 *
 * `dev/smoke.js` normally drives the **built bundle**, because webpack, the
 * externals and the manifest all sit between the source and what a host
 * loads. This file is for the case where that cannot work: a bundle carrying
 * a browser application — a Monaco, a map, a charting library — that reads
 * `document` at module scope, so it fails to *load* under `dev/dom.js`, not
 * merely to render. Growing the DOM shim to meet it means writing a browser.
 *
 * The answer that works is a boundary. Keep the control's decisions in
 * modules that import nothing of the library, and let `index.ts` be the thin
 * part that turns a decision into a library call. This loader transpiles
 * those modules one file at a time with the TypeScript already in
 * devDependencies (`ts.transpileModule`: no type check, no bundler, no
 * config) and evaluates each as a CommonJS module of its own.
 *
 * `forbid` is what makes the boundary enforced rather than remembered: a
 * decision module whose import matches throws here, by name. It is tested
 * against every request, relative ones included, so `/components\//` keeps
 * a decision out of the component tree as well as out of a package. Relative
 * imports come back through the loader, so a module one hop away is held to
 * the same rule. Pass a RegExp, or a list of RegExps and `[RegExp, 'what']`
 * pairs when the message should name the thing ("…stay free of React").
 *
 * **Mutation-testing that guard has a trap in it** (pcf-data-table,
 * 2026-09-20). TypeScript elides an import nothing uses, so adding
 * `import * as React from 'react'` to a pure module transpiles to no
 * `require` at all and loads cleanly — which reads exactly like a guard that
 * does not work. Use the import (`export const leak = React;`) and it throws.
 *
 * What passing proves is the decision. What it cannot prove is that the
 * entry point asked the right question — that half belongs to
 * `dev/harness.html` and to SPEC.md's *Not verified*, and the suite's header
 * should say so. pcf-code-editor 1.2.0 ran this way first, for a bundle that
 * cannot load; pcf-data-table 0.6 wrote the same file for modules that simply
 * do not need the bundle (grouping's query text), and its refusals of
 * relative paths and the elision trap came from there.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/**
 * @param {object} options
 * @param {string} options.root        the directory `load(name)` resolves names against
 * @param {RegExp|Array<RegExp|[RegExp, string]>} [options.forbid]  imports a decision module may not make
 * @param {object} [options.compilerOptions]  merged over the CommonJS defaults
 * @returns {(name: string) => any}    load('validate') → validate.ts's exports
 */
function createLoader(options) {
    const ts = require('typescript');
    const root = path.resolve(options.root);
    const rules = [].concat(options.forbid || []).map((rule) => (Array.isArray(rule) ? rule : [rule, null]));
    const cache = new Map();

    const compilerOptions = Object.assign({
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
    }, options.compilerOptions);

    function resolveFile(base) {
        if (/\.tsx?$/.test(base) && fs.existsSync(base)) {
            return base;
        }
        for (const extension of EXTENSIONS) {
            if (fs.existsSync(base + extension)) {
                return base + extension;
            }
        }
        throw new Error('modules.js: no TypeScript module at ' + path.relative(process.cwd(), base));
    }

    function loadFile(file) {
        if (cache.has(file)) {
            return cache.get(file).exports;
        }

        const source = fs.readFileSync(file, 'utf8');
        const output = ts.transpileModule(source, { fileName: file, compilerOptions, reportDiagnostics: true });

        if (output.diagnostics && output.diagnostics.length > 0) {
            throw new Error(path.basename(file) + ': ' + output.diagnostics
                .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
        }

        const mod = new Module(file, module);
        mod.filename = file;
        mod.paths = Module._nodeModulePaths(path.dirname(file));
        // Cached before it runs, so an import cycle gets the partial exports
        // Node would give it rather than recursing.
        cache.set(file, mod);

        mod.require = function (request) {
            for (const [pattern, what] of rules) {
                if (pattern.test(request)) {
                    throw new Error(path.relative(root, file).replace(/\\/g, '/') + ' imports ' + request
                        + ' — a decision module must stay free of ' + (what || 'it') + ' (dev/modules.js, forbid)');
                }
            }
            if (request.startsWith('./') || request.startsWith('../')) {
                return loadFile(resolveFile(path.resolve(path.dirname(file), request)));
            }
            return Module.prototype.require.call(this, request);
        };

        mod._compile(output.outputText, file);
        return mod.exports;
    }

    return function load(name) {
        return loadFile(resolveFile(path.resolve(root, name)));
    };
}

module.exports = { createLoader };
