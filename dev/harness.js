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
        return {
            language: document.getElementById('harness-language').value,
            security: document.getElementById('harness-security').value,
            disabled: document.getElementById('harness-disabled').checked,
            width: Number(document.getElementById('harness-width').value) || 720,
            height: Number(document.getElementById('harness-height').value) || 320,
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
            },

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

            resources: {
                getString: function (key) {
                    return key;
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

        // The cheapest way to catch work that belongs behind a comparison:
        // press it and watch whether the editor loses what was typed.
        document.getElementById('harness-rerender').addEventListener('click', rerender);

        status.textContent = 'Registered the control.';

        mount();
    };
})();
