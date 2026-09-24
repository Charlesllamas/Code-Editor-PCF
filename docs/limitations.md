---
title: Limitations
description: What the control cannot do, and why.
order: 6
---

# Limitations

Written down here rather than discovered on a form. Everything below reflects
the bundled Monaco build.

## Fourteen languages, not eighty

Monaco ships grammars for around eighty languages. This control bundles
fourteen: JSON, XML, SQL, YAML, Power Query M, DAX, Markdown, PowerShell, C#,
Python, CSS, HTML, JavaScript and TypeScript. Anything else falls back to plain
text with no colouring at all.

This is a curated set, not a hard limit. Each additional grammar costs roughly
6 KB in the bundle, so the size ceiling described below is not what constrains
the list. If you need a language that is missing, adding it is a few lines in
`CodeEditor/monacoSetup.ts` and a rebuild.

Earlier releases fetched the whole of Monaco from a CDN and so supported
everything it had a grammar for. The move to a bundled editor traded that
breadth for a control that loads on a restricted network.

## Validation covers JSON and XML, and nothing else

Monaco's language services — completion, hover documentation, schema-aware
validation — run in web workers. Power Apps serves a code component as one
JavaScript file and provides no way to serve the extra worker files alongside
it, so those workers cannot start, and none of that runs here.

What 1.2.0 adds is the half that needs no worker. A JSON document is parsed
on the main thread — strictly, so comments and trailing commas are faults —
and every fault is marked in the editor and named in the strip beneath it. An
XML document goes through the browser's own parser, which reports the first
fault only, because that is what `DOMParser` reports. The other twelve
languages are coloured and not checked.

It is not IntelliSense: there is no completion in any language.

## Schema validation has edges

From 1.3.0 a JSON document can be checked against a **JSON Schema** (drafts
4, 7, 2019-09 and 2020-12), on the main thread like everything else here.
What that does not cover:

- **On a model-driven form the schema is a web resource.** The form
  designer refuses a property value over 100 characters, which no real
  schema fits, so paste-in-the-panel is not offered there. A web resource
  name over 100 characters cannot be entered either.
- **A web resource is read from the environment the form runs in.** A canvas
  app runs elsewhere and passes the schema inline, as the text of a formula.
- **Publish the web resource.** An edit reaches nobody until it is
  published — a maker testing a saved-but-unpublished change sees the old
  schema, the same as everyone else. (A resource never published at all is
  served as saved.)
- **`$ref` resolves inside the schema only.** `#/$defs/…` works; a
  reference to another file or a URL does not, and the strip says the schema
  refers to something it does not contain.
- **Syntax comes first.** A document that does not parse is not checked
  against the schema until it does; half a document would only produce noise.
- **An empty column passes**, schema or not. Blank is a normal state for a
  column; use a business rule if it must hold something.
- **The messages are English**, for schema faults as for syntax faults.

## Format covers JSON and XML

**Format** in the strip, `Shift+Alt+F` and the context-menu entry all run the
same formatter. For **JSON** it keeps comments and formats as much of a broken
document as parses. For **XML** (from 1.3.0) it re-indents elements and does
nothing else:

- An element holding text or CDATA — `<value>  spaced  </value>`, mixed
  content like `<p>Hello <b>big</b> world</p>` — is written back exactly as
  it was, because in XML that whitespace can be data.
- So is anything under `xml:space="preserve"`.
- Tags are never rewritten: attribute order, quotes and line breaks inside a
  tag stay yours.
- A document that is not well-formed is not formatted at all; the button is
  hidden while validation is showing a fault.

Other languages have no formatter, and the button is not shown for them.

## Sizing depends on who has an opinion

Three parties can decide the height, in this order: the host, when it
allocates one (a canvas app always does; a model-driven form sometimes does);
then the maker's `height` property; then 500 pixels, which is what earlier
releases hard-wired.

`fitContent` grows and shrinks the editor with the document, but only
**below** that number — a form section grows around its contents, and a
document of three thousand lines would otherwise be a three-thousand-line
form. Where the host allocates a box, `fitContent` does nothing; the box wins.

The form designer's own **height in rows** is a third thing again: the
control cannot see it, and a `fitContent` editor grows until it meets it and
then scrolls inside, strip still at the bottom (measured on a form, 2026-09-17).
Set the rows generously, or leave `height` as the ceiling.

## The theme is global

Monaco has one theme per page. `theme` set to `auto` follows the app, which is
what every editor on a form wants; a maker who forces `light` on one editor and
`dark` on another gets whichever rendered last. In a canvas app, and on the
classic model-driven look, the app publishes no theme and `auto` means light.

## External changes are ignored while you are typing

The control writes the bound column value into the editor when that value
changes underneath it — a workflow writing back, or a canvas gallery moving to
another record. It deliberately does **not** do so while the cursor is in the
editor.

It has to work that way. The platform reports the bound value back
asynchronously, so mid-typing it is routinely a keystroke behind; writing it
back would reset the cursor to the top of the document on every key press. The
consequence is that a change arriving while somebody is actively typing is
dropped, and the editor resynchronises the next time it loses and regains the
value.

## It cannot block a save on a form

The Power Apps component framework does not let a control cancel a save, so on
a model-driven form an invalid document saves like any other value. The marker
and the strip make the fault visible; they do not make it impossible.

**In a canvas app it can**, because the save is yours: from 1.3.0 the control
reports `isValid` and `problemCount`, and a Save button whose `DisplayMode`
reads `isValid` refuses an invalid document — see [Canvas apps](canvas).
`isValid` **fails closed**: while a schema is loading, missing or broken it is
false, because the document has not been checked against what you asked for.

**Do not bind the outputs on a model-driven form.** The classic form designer
offers to bind a column to them; saving the form after doing so fails with an
unhelpful `[object XMLDocument]` alert (measured). The modern designer shows
them as read-only labels and offers no binding.

## The bundle and the platform's size limit

`bundle.js` is about 4.1 MB. Dataverse rejects a web resource larger than 5 MB
by default, so the control imports into a default environment with room to
spare — earlier releases sat at 4.9 MB, because they carried Monaco's JSON
language service as well, all of it dead weight behind workers that could never
start. If you fork this and add grammars or editor features, check the built
size before shipping. Administrators can raise the ceiling to 128 MB via
**Power Platform admin centre → Environments → Settings → Email**, but needing
that would make the control harder to deploy.

## Large documents get slow

Monaco handles megabyte files comfortably; the platform around it does not. A
model-driven form round-trips the whole column value on every save, and a
Multiple Lines of Text column is capped at 1,048,576 characters. Documents in
the hundreds of kilobytes are usable but noticeably slower to save.

## Keyboard shortcuts are captured while focused

Monaco binds a lot of keys. While the cursor is inside the editor, app- or
browser-level shortcuts sharing those bindings will not fire. `Ctrl+M` releases
`Tab` so keyboard users can move on to the next field.
