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

`npm run build && npm run shots` retakes every picture in `media/`; the
states and their crops are the table at the top of `dev/shots.mjs`, and the
page they are taken from is `dev/shots.html`. Look at each one before
committing it.

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
- **P2, the clip:** at the ceiling the strip stays visible at the bottom of
  the field and the editor scrolls inside — the platform's wrapper sizes
  the control's container rather than clipping it, so the container's own
  height is what the control gets and the strip sits inside it. No
  `ResizeObserver` needed.
- **P3 — the markers render** (squiggle, overview-ruler mark, and the message
  in the strip: "Ln 32, Col 1: Expected '}'"), and **Format changes the
  column value** the form saves.
- **P4 — the property panel shows `height` blank** and `theme` as a choice.

## The 1.2.9 probe — asked before 1.3.0 is written

1.3.0 adds a `schema` input (a JSON Schema inline, or a web resource name),
Format for XML, and two outputs (`isValid`, `problemCount`). The pure halves
— `schema.ts`, `formatXml.ts` — exist and are asserted; everything that
depends on the host waits for these answers. `probe.ts` parks
`window.__pcfCodeEditorProbe` on every `updateView`; each answer lands below,
verbatim and dated, and **a wrong answer removes the feature it names**.

**Dataverse has no JSON web resource type** — the twelve are HTML, CSS,
Script, XML, the image formats, XSL and RESX (Learn, *Web resource types*,
read 2026-09-23). So a schema is stored as **Script (JScript)**, and the
loader must read the body as JSON whatever `content-type` says.

Set-up on the test environment: a web resource `cll_/probe/order.schema.json`
of type **Script (JScript)** holding the scratchpad's `order.schema.json`
(note whether the designer accepts a `.json` name on that type), published;
the Accounts form's Code Editor with
`language` = `json` and `schema` = `cll_/probe/order.schema.json`; the
column holding `order.document.json`.

| # | Ask | Cuts |
|---|---|---|
| P1 | `p.env()`, then `await p.webResource("cll_/probe/order.schema.json")` — does `context.page.getClientUrl` exist on a *standard* field control, and does a same-origin fetch of `/WebResources/<name>` answer 200 with the schema, with no feature declared? Both routes (client URL, root-relative). | The web-resource route; inline only |
| P2 | `await p.webResource("cll_/probe/missing.json")` — status and body of a name that does not exist; and one created but **not published**. | The named "schema not loaded" states |
| P3 | Paste `schema-4000-chars.json` into `schema` in the form designer, save, publish; `p.env().schemaRawLength`. Where is the panel's ceiling? | Advertising inline schemas on model-driven |
| P4 | Import and publish in the **classic** designer too (the `labels` trap); do `isValid`/`problemCount` stay out of the property panel? `p.outputs()` after a fault and after fixing it. | The outputs |
| P5 | `await p.schema()` — the five faults the suite expects (`Expected a number…` at 2:9, `Must be at least 1` at 4:26, `Missing required property "sku"` at 5:5, `Must be one of…` at 7:13, `Property "note" is not allowed` at 8:3), and **no CSP violation in the console**. | The validator library |
| P6 | Set `language` = `xml`, paste `fetchxml.xml`; `p.xml()` → `sameTree` and `browserParses` both true; `p.applyXml()`, save, reload, `p.xml().changed` false. | XML Format |

### Answers (cll365, Accounts form, 2026-09-23)

- **P1 — yes, both routes.** `context.page` is an object and
  `getClientUrl` a function on this *standard* field control; it answered
  `https://cll365.crm.dynamics.com`, the page's own origin (`/main.aspx`,
  client `Web`, form factor 1). `fetch` of
  `<clientUrl>/WebResources/cll_/probe/order.schema.json` → **200**, not
  redirected, `content-type: text/jscript`, `cache-control: private`, all
  499 bytes of the file, 166 ms; the root-relative `/WebResources/…` → the
  same 200 and body, 80 ms. No `<uses-feature>` declared. The web-resource
  route stays; the loader reads the body as JSON and ignores the type,
  because a Script web resource says `text/jscript`. The new designer
  accepted a `.json` name on a Script (JScript) web resource. The
  `schema` input arrived as typed (`schemaRawLength` 28), resolved as
  `webResource`.
- **P2 — a missing name is a 404; an unpublished one is served.**
  `cll_/probe/missing.json` → **404**, `content-type: text/html;
  charset=utf-8`, **empty body**, both routes — so "not found" is the
  status alone, and the loader names it from that, never from a body.
  `cll_/probe/unpublished.json`, created and saved but **never published**
  → **200**, `text/jscript`, its content (`{}`), both routes. Measured as
  the environment's System Administrator; whether a user who cannot
  customize is served the same is **unmeasured**, and the docs tell a maker
  to publish rather than rely on it. P2b asks the sharper case.
- **P2b — an unpublished edit is not served; the published copy is.** The
  published `order.schema.json` edited (`"DRAFT"` added to the enum, 499 →
  508 bytes) and saved without publishing: the probe's fetch answered 499,
  and so did `fetch(…, { cache: "no-store" })`, which cannot come from the
  browser's cache — the server hands out the published copy, to the System
  Administrator too. With P2: a web resource never published is served as
  saved (there is nothing else to serve); an edit reaches nobody until it
  is published. **`cache-control: private` lets the browser keep a copy**,
  so the loader fetches with `cache: "no-cache"` — revalidated every load,
  so a newly published schema reaches the next form load rather than
  whenever the browser's heuristic expires.
- **P3 — the modern form designer refuses a static value over 100
  characters.** Pasting the 3,967-character schema into *JSON schema →
  Static value*: the field turns red, *"The json schema property cannot be
  more than 100 characters"*, and the form cannot be saved with it. So on a
  model-driven form **the schema is a web resource name**; inline is not
  advertised there (a `{"type":"object"}` fits, and no real schema does),
  and a web resource name over 100 characters cannot be entered either. A
  canvas app sets the input by formula, where no such ceiling was seen —
  inline is the canvas route. The same panel offers **Bind to table
  column** for the input, which would give a schema per record from a text
  column: not tried, listed under *Not verified*.
- **P4 — the outputs import and run; the classic designer offers to bind
  them.** Imported over 1.2.0 with `isValid` and `problemCount` declared,
  the form loads and the control reports them (`{ isValid: true,
  problemCount: 0 }` on the faulty document and on `{}` — the probe counts
  syntax faults only). The modern designer shows both as read-only labels.
  **The classic designer's Controls tab lists them with a pencil**, types
  shown (`Whole.None`, *"How many problems validation found; 0 when it is
  off."*) — a maker can bind a column to an output there, and what the
  platform does with that on a model-driven form is P4b. Also seen: the
  bound column comes back with `\r\n` line endings (the suite's CRLF cases
  cover the positions).
- **P4b — binding an output to a column breaks the classic form's save.**
  `Is valid` bound to a Yes/No column on the classic designer's Controls
  tab, then Save: a browser alert, *"cll365.crm.dynamics.com says
  [object XMLDocument]"* — the designer's error path stringifying the
  server's XML reply — and the form was not saved. So an output is **not**
  a way to store the result on a model-driven form, and the docs say not to
  bind one there; the modern designer, the default, shows outputs as labels
  and offers no binding at all. The outputs stay: they exist for canvas,
  and nothing offered on model-driven depended on the binding.
- **P5 — the validator runs on the form, and matches the suite exactly.**
  `order.document.json` against the web-resource schema: the five faults
  the suite asserts, same line, column, length and wording (2:9 ×5, 4:26
  ×1, 5:5 ×1, 7:13 ×6, 8:3 ×6), in **2 ms**, on a column the form stored
  with `\r\n`. And the policy question behind the library choice:
  `new Function("return 1")()` **is allowed** on this form — the default
  model-driven CSP is `script-src * 'unsafe-inline' 'unsafe-eval' blob:`
  (Learn, *Content security policy*, read 2026-09-23). But the admin
  centre's **Strict CSP** drops `unsafe-eval` for model-driven apps
  (`script-src 'self' blob: <platform>`), and there a code-generating
  validator stops working while this one does not. The choice stands, for a
  reason now written down rather than assumed.
- **P6 — XML Format round-trips through a save.** `fetchxml.xml` (one
  line) in the column with `language` = `xml`: `formattable`, `changed`,
  `sameTree` and `browserParses` all true — the formatter's tree equals the
  original's and the browser's own `DOMParser` accepts the result.
  Written into the editor, saved, reloaded: `changed` is **false**, so the
  saved value is the formatted one and formatting it again is a no-op.

Nothing was cut. Every feature 1.3.0 rests on answered the right way, and
three answers shaped it: the loader ignores `text/jscript` and
revalidates (`no-cache`), the schema is a web resource name on a
model-driven form and inline in canvas, and an output is documented as
canvas-only because binding one breaks the classic form's save.

## What building 1.3.0 found

- **`isValid` fails closed.** The harness showed a missing schema beside
  "No problems" and `isValid: true` — a canvas Save button would have
  enabled on a document nobody checked against what the maker asked for.
  So a schema asked for and not in force (loading, missing, refused,
  broken) withholds "valid" (`schemaWithholdsVerdict`), "No problems" is not
  claimed while it does, and `problemCount` still counts only what was
  found.
- **The outputs are notified when the verdict changes**, not only on a
  keystroke — so the column is handed back as `null`, never `""`, while
  nobody has typed in a null column: an untouched record must not look
  edited. Whether a verdict-only notify leaves a model-driven form clean
  is under *Not verified*.
- **The screenshot found two strip defects the suite could not.** A failed
  schema's sentence was capped at a third of the strip and cut mid-word
  beside empty space (a failure is the news, so it now takes the room); and
  at a form's usual width the ellipsis ate "(+4 more)", the part that says
  the first fault is not the only one — the message and the count are two
  boxes now, and only the message shrinks. The first capture also came out
  unstyled: the platform loads the control's CSS from the manifest, so the
  shot page has to link it.
- **The screenshot recipe is a script now** — `npm run shots [state…]`,
  `dev/shots.mjs` driving headless Chrome at 2× over `dev/shots.html` —
  where it was a paragraph here, which is how a retake becomes archaeology.

## The 1.3.0 walkthrough (cll365, Accounts form, 2026-09-23)

1.3.0 imported over the 1.2.9 probe. All four the right way.

- **W1 — the web-resource schema on the form.** `schema` =
  `cll_/probe/order.schema.json`, the order document in the column: five
  underlines, and the strip names *Schema cll_/probe/order.schema.json*.
- **W2 — a verdict-only notify leaves the form clean.** The record
  reloaded with that document and nothing typed: no unsaved changes. The
  control notified (the verdict went from valid to five problems as the
  schema landed) and handed the column back as it came, so the form counted
  nothing.
- **W3 — a missing schema names itself.** `schema` =
  `cll_/probe/nope.json`: the strip reads *"Schema cll_/probe/nope.json not
  found — check the name, and that it is published"*.
- **W4 — Format on XML.** `fetchxml.xml` with `language` = `xml`: the
  Format button laid it out.

## The 1.3.9 probe — asked before 1.4.0 is written

1.4.0 completes property names and values from the JSON Schema already in
force, and shows a property's description on hover — both on the main
thread, through providers registered for JSON, with the suggest and snippet
contributions added to `monacoFeatures.ts`. Suggestions open as you type, as
VS Code does; no new property, since nothing appears without a schema.
`probe.ts` registers a static provider and a markdown hover with the options
1.4.0 means to ship, and parks `window.__pcfCodeEditorProbe`; each answer
lands below, verbatim and dated, and **a wrong answer removes the feature it
names**.

**What the harness already answered, 2026-09-26:**

- **A contribution imported after the first Monaco API call is inert.**
  Imported from `probe.ts`, the suggest controller threw *"SuggestController
  depends on UNKNOWN service ISuggestMemories"* on every editor and the list
  never opened: a contribution's services are registered when its module is
  evaluated and read once, on the first `monaco.editor`/`monaco.languages`
  call, which `monacoSetup.ts` makes at load. Moved to `monacoFeatures.ts`,
  it works.
- **`.CodeEditor-editor`'s `overflow: hidden` clips Monaco's overflow
  widgets.** A hover on line 2 lost its top 138px — which is true of 1.3's
  marker hovers today. `fixedOverflowWidgets` fixes both the hover and the
  list in the harness; so does `overflowWidgetsDomNode` on a node under
  `<body>` carrying `monaco-editor`.
- **Monaco reads both overflow options at creation only**; `updateOptions`
  changes nothing. So the probe chooses the mode from `localStorage` before
  the form loads (`p.overflow("fixed" | "body" | "none")`, then reload).
- **On a short field the list on the last line is not clipped — it is
  gone.** At a 96px editor in mode `none`, every hit point of the list was
  covered (cut 99px at the editor's bottom edge); in `fixed` it hangs below
  the editor over the strip, whole. A form's field is often that short.
- Markdown in a hover renders (emphasis, code, a list, a code block); a
  `supportHtml: false` string loses its tags rather than showing them. No
  CSP violation, no warning, no `getWorker` call with
  `wordBasedSuggestions: "off"`.

Set-up on the test environment: the probe zip imported over 1.3.1 on the
Accounts form — **1.3.10**, the second cut, which adds `p.suggest(n, "last")`
and `p.measure()`; 1.3.9 could not open the list on a field's last line,
which is the case P1 is about; the Code Editor with `language` = `json` and the
`cll_/probe/order.schema.json` schema from P1 of 1.2.9. For P5, a second Code
Editor on the same form bound to another multiline column, with an inline
schema (`{"type":"object"}` is enough — the probe's items name their
instance, not the schema).

| # | Ask | Cuts |
|---|---|---|
| P1 | For each of `p.overflow("none")`, `"fixed"`, `"body"` (reload after each): on a **short** field (the designer's height at 6 rows), `await p.suggest(1, "last")`; on a tall one, `await p.suggest()`; and `await p.hover()` — `seen` all true, `clippedBy` empty? Then type `"` on the last line by hand and `p.measure()`. Then scroll the form while the list is open: does a fixed list follow the editor or stay behind? And the reading pane / a tab switch with the list open. | Which overflow mode ships; if none shows the list whole on the form, completion is Ctrl+Space only and the hover keeps 1.3's clip |
| P2 | `await p.hover()` on the form: `hasEm`, `hasCode`, `hasList` true, `violations` empty, and `p.env().trustedTypes` / `ttPolicies`. Anything new in the console? | Markdown hover; plain text instead |
| P3 | Type in the field: Ctrl+Space opens the list (`p.keys()` shows it arrived); Escape closes the list and nothing else (the form stays, no dialog closes); Enter with **no** list open inserts a newline; Enter and Tab with the list open insert the item; Ctrl+M still releases Tab. | The keys the docs promise; Ctrl+Space advertised or not |
| P4 | `p.console()` after P1–P3: `getWorker` and `workerWarning` counts, and the network tab for any `?esm` or worker request. | `wordBasedSuggestions: "off"` as the whole answer |
| P5 | With the two editors: `await p.each()` — each list's first item names its own instance. Then switch to another form tab and back: `p.env().instances` lists two, not four (`destroy` unregistered the first pair). | The registry keyed by model URI |
| P6 | Not blocking: the canvas app's Code Editor (studio and play) and the phone client — does the list open, and can it be picked by touch? | Goes to *Not verified* or `docs/limitations.md`, never cuts |

### Answers

*Pending.*

## Not verified

From 1.3.0:

- **The outputs in a canvas app**: `isValid` driving a Save button's
  `DisplayMode`, including before the user types.

From the 1.2.9 probe:

- **`schema` bound to a table column** (the designer's *Bind to table
  column*): a schema per record, and past the 100-character static ceiling
  — offered by the panel, never tried.
- **A web resource read from a canvas app.** P1 was a model-driven form on
  the environment's own origin; a canvas app runs elsewhere, and the docs
  give it the inline route only.
- **An unpublished web resource served to a user who cannot customize**
  (P2 was measured as System Administrator).
- **A classic-designer publish with the outputs declared and unbound.**
  P4b's bound save failed; whether the plain classic Save + Publish went
  through before it was not reported. The modern designer published.

What the 1.1.9 probe left open. None of it holds the release.

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
