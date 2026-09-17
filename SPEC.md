# Code Editor

Edit JSON, XML and other code in a multiline text column, with Monaco.

This file arrived with 1.2.0. The repository predates the template and was
adopted onto the hub without one, so the findings below start there; what
1.0–1.1 learned is in the commit messages and `docs/limitations.md`.

## What the build disagreed with

- **`monaco-editor/editor/editor.api` is the bare editor.** It types, scrolls
  and colours, and that is all: the find widget, folding, bracket matching,
  the context menu, Format Document and the hover that reads a marker are
  each a separate contribution, and `editor.main` — the file that imports
  them all — also imports eighty grammars and four worker-backed language
  services. 1.1.0 imported the API and documented find and folding as
  working; whether it had them through the JSON contribution's side imports
  or not at all was never measured, and is moot. `monacoFeatures.ts` names
  what ships, one line each, with the rule that a contribution has to work
  without a language service.

- **The JSON contribution was 1.9 MB of dead weight.** `language/json/
  monaco.contribution` registers a main-thread tokenizer *and* nine LSP
  adapters that proxy to a worker PCF cannot start. Only the tokenizer ever
  ran. It is a standalone module (`languages/features/json/tokenization`)
  with one small dependency, so 1.2.0 imports that and registers the
  language configuration `jsonMode.ts` would have. 4,906,601 → 3,052,377
  bytes before the editing contributions went back in; 4,118,900 after.

- **`jsonc-parser` is inside Monaco and unreachable from outside it.** The
  package's `exports` map is `"./*": "./esm/vs/*.js"`, which appends `.js`
  and only reaches `esm/vs/`; the parser lives at `esm/external/`. So it is
  a declared dependency instead — the same library, ~30 KB duplicated, and
  the formatter and positioned errors come from a package with a version.
  The same map is why no `.css` can be imported from `monaco-editor` by
  path; the codicon stylesheet is reached by `codeEditorWidget` itself.

- **pcf-scripts 1.51 ships its own CSS rule, and resolves its loaders from
  the project root.** 1.14 had no CSS rule and `webpack.config.js` carried
  one; under 1.51 the two ran in sequence (arrays merge by appending) and
  sass-loader was handed JavaScript. The rule is gone from this repository.
  `style-loader` is still a devDependency, though, because pcf-scripts names
  its loaders as bare strings and webpack resolves them from the project,
  not from pcf-scripts' own `node_modules` — a project that imports CSS
  from JavaScript (this one, through Monaco) is the only kind that notices.

- **Monaco 0.56 finds its editor worker through `new URL(…, import.meta.url)`**
  and fails asynchronously under a single-file build: four console errors, a
  404 on a stub webpack emitted beside `bundle.js`, then the main-thread
  fallback anyway. A `MonacoEnvironment.getWorker` that throws reaches the
  same fallback synchronously through `EditorWorkerClient._getOrCreateWorker`'s
  catch, which warns once. Same editor, one warning, and the warning says
  why.

## Platform behaviour worth knowing

- **`allocatedHeight` is `-1` on a model-driven form section** (observed on
  the test form in 1.1.0; it is why the 500px fallback exists). Sizing is
  therefore a three-way decision — host, maker, document — and `sizing.ts`
  holds it as one function so every branch has an assertion. Where the host
  answers, the answer wins; `fitContent` is only for hosts that do not.

- **A `default-value` on an optional property reaches the hub's demo as the
  raw XML string** (skill, *pcfhub-manifest*), which is why every preset in
  `pcfhub.json` sets all six properties explicitly.

## The dev rig

**`dev/smoke.js` does not load the bundle.** Monaco reads `document` at
module scope, so the bundle fails to *load* under `dev/dom.js`, not merely to
render (measured 2026-08-28). The control keeps its decisions in modules that
import nothing of Monaco — `languages.ts`, `validate.ts`, `sizing.ts`,
`theme.ts` — and the suite transpiles those with the TypeScript already in
`devDependencies` and drives them directly. Its loader throws if one of them
imports Monaco, so the boundary is enforced rather than remembered.

What the suite therefore proves is the decision; what it cannot prove is that
`index.ts` asked the right question. That half is `dev/harness.html`
(`npm run harness`), whose switches include the one that matters most for
1.2.0 — *Host allocates a height* off, which is what a model-driven form does.

## Demo

`full`. Nothing leaves the browser: validation is a main-thread parse, the XML
check is the browser's own `DOMParser`, the theme is a switch, and the
formatter is `jsonc-parser`. Four presets, each setting every input, because
of the `default-value` finding above.

## Screenshots

`media/screenshot*.png` come from a scratch page that mounts the control once
with a named state and nothing else on the page, shot by headless Chrome at
`--force-device-scale-factor=2`, `--window-size=640,<height>`,
`--virtual-time-budget=4000`, `--default-background-color=00000000`. The
page registers `ComponentFramework.registerControl` before the bundle's
`<script>`, sets `* { transition: none !important }`, and hands the control
`allocatedHeight: -1` so the `height`/`fitContent` branches decide the crop.
States: `faults` (light, 220px, the two-fault document), `dark` (fit content,
eight lines → 176px), `xml` (fit content, five lines → 119px).

## Measured on the form

The 1.1.9 probe, imported over 1.1.0 on the Accounts test form, 2026-09-17.

- **P1 — `fluentDesignLanguage.isDarkTheme` reaches a standard field control
  on a model-driven form.** `theme: auto` follows the app; `dark` forces the
  dark editor on a light form. Whether `updateView` fires on a theme toggle
  with the form open was not tried separately.
- **P2 — `allocatedHeight` is `-1` on the form section**, and with
  `fitContent` on the section grows with the document. **The form designer's
  height-in-rows is a ceiling the control cannot see**: the editor grew until
  it met the field's 20 rows and stopped there, which is a clip on the section,
  not an allocation — if it were allocated, the editor could not have grown.
- **P3 — Format changes the column value** the form saves.
- **P4 — the property panel shows `height` blank** and `theme` as a choice.

## Not verified

What the 1.1.9 probe left open; tag `v1.2.0` after these, not before.

- **P2, the clip:** when `fitContent` meets the form's height-in-rows, is
  the strip still visible, or cut off under the section's edge? If cut off,
  the fix is a `ResizeObserver` on the container's parent — request a
  height, and where the parent comes back shorter, take the parent's — the
  calendar's rule, applied to height.
- **P3, the markers:** a fault's squiggle and the strip's message on the
  form's Monaco (a CSP check on the squiggle's inline SVG background).
- **P1, the toggle:** whether `updateView` fires when the app's theme is
  switched with the form open, or only on load.
- **P5 — a blank `language` now resolves to JSON rather than plain text**;
  no form is expected to have one, since the property is required.
- The XML message parsing is measured against Chrome's and Firefox's text;
  Safari is assumed to share Chrome's (libxml2) and is unmeasured.
- The phone client: the strip at narrow widths, and whether a 24px button
  is reachable by touch. `docs/canvas.md`'s rough edges do not yet mention
  the phone.

## Promoting a finding

The rig shape above — decisions in pure modules, transpiled and asserted
because the bundle cannot load outside a browser — went to the skill as
*When the bundle cannot load in Node* under *Prove it with the dev rig*, and
`_template/dev/smoke.js` points at it. The pcf-scripts loader finding and the
`exports`-map finding are Monaco- and toolchain-specific and stay here.
