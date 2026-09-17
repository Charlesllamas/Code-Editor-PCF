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

Two things this is not: it is not IntelliSense, so there is no completion in
any language; and it is not schema validation, so a JSON document that is
well-formed but wrong for your integration passes.

## Format is JSON only

**Format** in the strip, `Shift+Alt+F` and the context-menu entry all run the
same formatter, and the control registers one for JSON only. It keeps comments
and formats as much of a broken document as parses. XML and the rest have no
formatter; the button is not shown for them.

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

## It cannot block a save

The Power Apps component framework does not let a control cancel a save, so an
invalid document saves like any other value. The marker and the strip make the
fault visible; they do not make it impossible.

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
