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

## No IntelliSense or validation, in any language

Monaco's language services — completion, hover, and the red underlines under
malformed JSON — run in web workers. Power Apps serves a code component as one
JavaScript file and provides no way to serve the extra worker files alongside
it, so those workers cannot start.

What survives is everything that runs on the main thread: syntax colouring,
bracket matching, folding, indentation, find and replace. What is gone is
validation and completion. A malformed JSON document is coloured but not
flagged.

## The bundle is close to the platform's size limit

`bundle.js` is about 4.9 MB. Dataverse rejects a web resource larger than 5 MB
by default, so the control imports into a default environment — but with little
room. If you fork this and add language services or more grammars, check the
built size before shipping. Administrators can raise the ceiling to 128 MB via
**Power Platform admin centre → Environments → Settings → Email**, but needing
that would make the control harder to deploy.

## Height falls back to 500px when the form does not constrain it

The control sizes itself from what the platform allocates. Model-driven forms
frequently allocate no explicit height, in which case the editor renders 500
pixels tall. There is no property to change that; it is a constant in the
control.

Canvas apps always give a control explicit dimensions, so there the editor
matches the box you draw.

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
invalid document saves like any other value. With the language workers
unavailable this matters more than it used to: there are no error underlines to
notice in the first place.

## No theme property

The editor renders in Monaco's default light theme regardless of the app's
appearance.

## Large documents get slow

Monaco handles megabyte files comfortably; the platform around it does not. A
model-driven form round-trips the whole column value on every save, and a
Multiple Lines of Text column is capped at 1,048,576 characters. Documents in
the hundreds of kilobytes are usable but noticeably slower to save.

## Keyboard shortcuts are captured while focused

Monaco binds a lot of keys. While the cursor is inside the editor, app- or
browser-level shortcuts sharing those bindings will not fire.
