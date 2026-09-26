/*
 * The driver: wires the switches on `harness.html` to a real instance of the
 * control, and models the one part of the platform that surprises people — the
 * round trip.
 *
 * Loaded before the control bundle, because the bundle registers itself the
 * moment it loads and needs somewhere to register. The page calls
 * `window.__harnessStart()` once the bundle has run.
 *
 * Read `harness.html` first — it says what this is for and what it is not.
 */

(function () {
    'use strict';

    /* ------------------------------------------------------------- fixture */

    var BROKEN = [
        '{',
        '  "publisher": "PCFHub",',
        '  "controls": [',
        '    { "name": "CodeEditor", "language": "json" },',
        '  ],',
        '  "notes": "a trailing comma above, and a comment below"',
        '  // not JSON',
        '}',
    ].join('\n');

    var SAMPLE = [
        '{',
        '  "publisher": "PCFHub",',
        '  "controls": [',
        '    { "name": "CodeEditor", "language": "json", "readOnly": false },',
        '    { "name": "Sparkline", "language": "xml", "readOnly": true }',
        '  ],',
        '  "notes": "Edited in a code component, saved to a multiline text column."',
        '}',
    ].join('\n');

    /*
     * The probe's schema and document (SPEC.md, P5): five faults, one per
     * rule the strip has to word — a type, a minimum, a missing property, an
     * enum, and a property the schema does not allow.
     */
    // The titles, descriptions and default are 1.4.0's: completion and hover
    // read them. None of them changes what validates.
    var ORDER_SCHEMA = JSON.stringify({
        type: 'object',
        required: ['id', 'lines'],
        properties: {
            id: { type: 'number', title: 'Order number', description: 'The number the order was issued under.' },
            lines: {
                type: 'array',
                description: 'One entry per product ordered.',
                items: {
                    type: 'object',
                    required: ['sku'],
                    properties: {
                        sku: { type: 'string', markdownDescription: 'The **stock keeping unit**, as printed on the label.' },
                        qty: { type: 'integer', minimum: 1, default: 1, description: 'How many; at least one.' },
                    },
                },
            },
            status: { enum: ['open', 'closed'], default: 'open', description: 'Where the order is in its life.' },
        },
        additionalProperties: false,
    }, null, 2);

    var ORDER = [
        '{',
        '  "id": "A-1",',
        '  "lines": [',
        '    { "sku": "x", "qty": 0 },',
        '    { "qty": 2 }',
        '  ],',
        '  "status": "void",',
        '  "note": 1',
        '}',
    ].join('\n');

    /**
     * What each schema switch hands the control as `schema`, and how the
     * web-resource fetch answers — as measured on a form (SPEC.md P1–P2b): a
     * published resource is 200 `text/jscript`, a missing one a 404 with an
     * empty body, and a rejected fetch is the network.
     */
    var SCHEMAS = {
        none: { raw: null },
        webResource: { raw: 'cll_/probe/order.schema.json', answer: { status: 200, body: ORDER_SCHEMA } },
        missing: { raw: 'cll_/probe/missing.json', answer: { status: 404, body: '' } },
        offline: { raw: 'cll_/probe/order.schema.json', answer: 'offline' },
        slow: { raw: 'cll_/probe/order.schema.json', answer: 'never' },
        inline: { raw: ORDER_SCHEMA },
        url: { raw: 'https://example.com/order.schema.json' },
    };

    /*
     * The page's own fetch, wrapped so a request for a web resource is
     * answered by the switch above and everything else (the .resx) goes
     * through. Installed once; the switch is read per request.
     */
    var realFetch = window.fetch.bind(window);
    window.fetch = function (url, init) {
        var path = String(url);
        if (path.indexOf('/WebResources/') === -1) {
            return realFetch(url, init);
        }
        var answer = SCHEMAS[document.getElementById('harness-schema').value].answer || { status: 404, body: '' };
        if (answer === 'offline') {
            return Promise.reject(new TypeError('Failed to fetch'));
        }
        if (answer === 'never') {
            return new Promise(function () {});
        }
        return new Promise(function (resolve) {
            window.setTimeout(function () {
                resolve(new Response(answer.body, { status: answer.status, headers: { 'content-type': answer.status === 200 ? 'text/jscript' : 'text/html; charset=utf-8' } }));
            }, 150);
        });
    };

    /**
     * `parameter.security`, and the shape matters.
     *
     * `undefined` on a column with no field-level security profile, which is
     * the common case — and absence is what unguarded code breaks on. The
     * control reads `secured.editable`, so a stub that always supplied an
     * object would hide the branch that matters.
     */
    var SECURITY = {
        none: undefined,
        'read-only': { readable: true, editable: false },
    };

    /* ------------------------------------------------------- host plumbing */

    var STRINGS = {};

    var registered = null;
    var instance = null;
    var container = null;
    var notifications = 0;

    /** The platform's copy of the column, which is not the control's copy. */
    var columnValue = SAMPLE;

    /*
     * **Two arguments, not three.** `pcf-scripts` emits
     * `registerControl('Namespace.Control', ctor)` — the namespace and the
     * constructor name arrive already joined into one string.
     */
    window.ComponentFramework = window.ComponentFramework || {};
    window.ComponentFramework.registerControl = function (fullName, ctor) {
        registered = ctor;
    };

    function options() {
        var pref = document.getElementById('harness-pref-height').value;
        return {
            language: document.getElementById('harness-language').value,
            security: document.getElementById('harness-security').value,
            disabled: document.getElementById('harness-disabled').checked,
            width: Number(document.getElementById('harness-width').value) || 720,
            // -1 is what a model-driven form reports when it allocates nothing.
            height: document.getElementById('harness-allocates').checked
                ? (Number(document.getElementById('harness-height').value) || 320)
                : -1,
            theme: document.getElementById('harness-theme').value,
            appTheme: document.getElementById('harness-app-theme').value,
            // null is the blank property; the platform never hands down 0 for it.
            prefHeight: pref === '' ? null : Number(pref),
            fitContent: document.getElementById('harness-fit').checked,
            validation: document.getElementById('harness-validation').value,
            schema: document.getElementById('harness-schema').value,
        };
    }

    function buildContext(o) {
        return {
            parameters: {
                code: {
                    raw: columnValue,
                    type: 'Multiple',
                    security: SECURITY[o.security],
                },
                language: { raw: o.language, type: 'SingleLine.Text' },
                theme: { raw: o.theme, type: 'Enum' },
                height: { raw: o.prefHeight, type: 'Whole.None' },
                fitContent: { raw: o.fitContent, type: 'TwoOptions' },
                validation: { raw: o.validation, type: 'Enum' },
                schema: { raw: SCHEMAS[o.schema].raw, type: 'SingleLine.Text' },
            },

            /*
             * Present on a model-driven form (SPEC.md P1) though absent from a
             * field control's typings. The page's own origin, so the control's
             * web-resource fetch lands on the stub above.
             */
            page: { getClientUrl: function () { return location.origin; } },

            /*
             * Withheld unless the app publishes one. A canvas app and the
             * classic model-driven look hand down no `fluentDesignLanguage`
             * at all, and `theme: auto` has to mean *light* there rather
             * than throw -- which a stub that always supplied the object
             * would never show.
             */
            fluentDesignLanguage: o.appTheme === 'none'
                ? undefined
                : { isDarkTheme: o.appTheme === 'dark', tokenTheme: {}, brand: {} },

            mode: {
                isVisible: true,
                isControlDisabled: o.disabled,
                label: 'Configuration',

                /*
                 * Recorded rather than delivered. The platform sends
                 * `allocatedWidth` only to a control that asked, and asking is
                 * this call — so "did it ask" is worth showing, while the size
                 * itself comes from the boxes above.
                 */
                trackContainerResize: function () {
                    document.getElementById('harness-status').dataset.tracked = 'yes';
                },
                setFullScreen: function () {},

                allocatedWidth: o.width,
                allocatedHeight: o.height,
            },

            /*
             * The real English strings, read from the .resx the platform packs,
             * so the strip reads as it will on a form. A key the file does not
             * carry comes back as the key -- which is also what the platform
             * does, and is how a missing translation shows itself.
             */
            resources: {
                getString: function (key) {
                    return Object.prototype.hasOwnProperty.call(STRINGS, key) ? STRINGS[key] : key;
                },
            },

            userSettings: { isRTL: false, languageId: 1033 },

            updatedProperties: [],
        };
    }

    /* ------------------------------------------------------------ rendering */

    /*
     * What the platform does after a control says its outputs changed: it reads
     * `getOutputs()`, keeps the answer as the column's new value, and comes back
     * through `updateView` with it.
     *
     * Deferred rather than immediate, because the platform is asynchronous and
     * because calling back synchronously from inside the control's own handler
     * would re-enter it mid-update — a shape the platform never produces, so a
     * bug found that way would not be a real one.
     *
     * **`undefined` means "no change".** The assignment below is guarded on the
     * key being present rather than on the value being truthy, so a cleared
     * column is distinguishable from an untouched one.
     */
    function notifyOutputChanged() {
        notifications += 1;

        window.setTimeout(function () {
            var outputs = instance.getOutputs ? instance.getOutputs() : {};

            if (Object.prototype.hasOwnProperty.call(outputs, 'code') && outputs.code !== undefined) {
                columnValue = outputs.code;
            }

            showOutputs();
        }, 0);
    }

    function showOutputs() {
        var outputs = instance && instance.getOutputs ? instance.getOutputs() : {};
        var lines = Object.keys(outputs).map(function (key) {
            var value = outputs[key];
            var shown;

            if (value === undefined) {
                shown = 'undefined   <- the platform reads this as "no change"';
            } else if (value === null) {
                shown = 'null        <- an explicit clear';
            } else {
                shown = JSON.stringify(value);
            }

            return '  ' + key + ': ' + shown;
        });

        document.getElementById('harness-outputs').textContent =
            lines.length > 0 ? '{\n' + lines.join('\n') + '\n}' : '{}';

        document.getElementById('harness-notified').textContent =
            'notifyOutputChanged x' + notifications
            + (document.getElementById('harness-status').dataset.tracked === 'yes'
                ? ' · trackContainerResize called'
                : ' · never asked to be resized');
    }

    /**
     * A fresh instance per switch change.
     *
     * `init` runs once per control on a real form, so reusing one across a
     * language change would be testing a sequence the platform never produces.
     * The exception is `updateView again`, which is exactly the repeated call
     * the platform *does* make.
     */
    function mount() {
        var o = options();

        if (instance && instance.destroy) {
            instance.destroy();
        }

        container = document.getElementById('harness-root');
        container.innerHTML = '';

        var surface = document.getElementById('harness-surface');
        surface.style.width = o.width + 'px';
        // A form section grows around its contents; this box does the same,
        // so a fitContent editor visibly resizes the surface it sits in.
        surface.style.height = 'auto';

        instance = new registered();

        var context = buildContext(o);

        instance.init(context, notifyOutputChanged, {}, container);
        instance.updateView(context);

        showOutputs();
    }

    function rerender() {
        instance.updateView(buildContext(options()));
        showOutputs();
    }

    window.__harnessStart = function () {
        var status = document.getElementById('harness-status');

        if (typeof registered !== 'function') {
            status.textContent = 'No control registered — run npm run build, then reload.';

            return;
        }

        [
            'harness-language',
            'harness-security',
            'harness-disabled',
            'harness-width',
            'harness-height',
            'harness-allocates',
            'harness-theme',
            'harness-app-theme',
            'harness-pref-height',
            'harness-fit',
            'harness-validation',
            'harness-schema',
        ].forEach(function (id) {
            document.getElementById(id).addEventListener('change', mount);
        });

        /*
         * `''`, not a value. An empty column and a column holding whitespace
         * are different, and a control that renders them the same way is
         * usually fine while one that *writes* them the same way is not.
         */
        document.getElementById('harness-empty').addEventListener('click', function () {
            columnValue = '';
            mount();
        });

        // The probe's order: valid JSON, five faults against the schema.
        document.getElementById('harness-order').addEventListener('click', function () {
            columnValue = ORDER;
            mount();
        });

        // One line of FetchXML, the probe's P6 document: Format should lay it
        // out one element per line and leave the comment where it was.
        document.getElementById('harness-fetchxml').addEventListener('click', function () {
            columnValue = '<fetch top="5"><entity name="account"><attribute name="name"/><filter type="and"><condition attribute="statecode" operator="eq" value="0"/></filter><!-- recent first --><order attribute="createdon" descending="true"/></entity></fetch>';
            mount();
        });

        // A document with two faults, handed down by the platform: the strip
        // should name the first and count the second, and the squiggles land
        // on the comma and the comment.
        document.getElementById('harness-break').addEventListener('click', function () {
            columnValue = BROKEN;
            mount();
        });

        // The cheapest way to catch work that belongs behind a comparison:
        // press it and watch whether the editor loses what was typed.
        document.getElementById('harness-rerender').addEventListener('click', rerender);

        status.textContent = 'Registered the control.';

        fetch('../CodeEditor/strings/CodeEditor.1033.resx')
            .then(function (r) { return r.text(); })
            .then(function (xml) {
                var doc = new DOMParser().parseFromString(xml, 'application/xml');
                Array.prototype.forEach.call(doc.getElementsByTagName('data'), function (node) {
                    var value = node.getElementsByTagName('value')[0];
                    if (value) {
                        STRINGS[node.getAttribute('name')] = value.textContent;
                    }
                });
            })
            .catch(function () {
                status.textContent += ' Could not read the .resx; the strip shows keys.';
            })
            .then(mount);
    };
})();
