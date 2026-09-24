---
title: Overview
description: A Monaco-backed code editor for multiline text columns in Power Apps.
order: 1
---

# Overview

Code Editor replaces the plain textarea a multiline text column gets by default
with the [Monaco editor](https://microsoft.github.io/monaco-editor/) — the same
editor that runs inside Visual Studio Code.

::image{src=media/screenshot.png alt="A JSON document in the Code Editor with two faults marked, and the strip beneath it naming the first" zoom}

It exists because of a specific, common situation: a solution stores JSON or XML
in a text column, and somebody eventually has to edit it. Without an editor that
understands the format, that means counting braces in a box with no line
numbers, and finding out it was wrong when the integration fails.

## What you get

- Syntax colouring for fourteen languages: JSON, XML, SQL, YAML, Power Query M,
  DAX, Markdown, PowerShell, C#, Python, CSS, HTML, JavaScript and TypeScript.
- **Validation for JSON and XML** — faults marked in the editor and named in
  the strip beneath it, with a click to jump to the first. Strict JSON: no
  comments, no trailing commas.
- **Checking against a JSON Schema** — a schema kept as a web resource in
  your environment (or passed inline in a canvas app), its faults marked and
  worded like syntax faults: *Missing required property "sku"*, *Must be one
  of "open", "closed"*.
- **Format** for JSON and XML, from the strip, the context menu or
  `Shift+Alt+F`.
- **`isValid` and `problemCount`** for a canvas app to act on — a Save
  button that refuses an invalid document is one `DisplayMode` formula.
- **Light or dark**, following the app's theme or forced either way.
- Bracket matching, folding, indentation, find and replace, multi-cursor, and
  a context menu.
- An editor that sizes itself to the space the form gives it — or to the
  document, with `fitContent`, up to a height you choose.
- Nothing outside your environment. Monaco is compiled into the solution, and a schema is read from your own web resources.

::image{src=media/screenshot-dark.png alt="The same editor in the dark theme, sized to its eight-line document" zoom}

## What you do not get

:::callout{type=warning}
**No IntelliSense or completion, in any language, and no validation beyond
JSON and XML.** Monaco's language services run in web workers, and Power Apps
serves a code component as a single JavaScript file with no way to serve
worker files alongside it. The JSON and XML checks run on the main thread
instead; the other twelve languages are coloured, not flagged.

**Fourteen languages, not eighty.** Monaco has grammars for around eighty; this
control bundles a curated fourteen. Anything else renders as plain text. Adding
more is cheap — see [Limitations](limitations).
:::

If you are upgrading from a release that loaded Monaco from a CDN, both of those
are a step back from what you had — that build had working IntelliSense and every
grammar Monaco ships. What you get in exchange is a control that
works on a locked-down network, in a sovereign cloud, or anywhere else outbound
access to `cdn.jsdelivr.net` is not a given — which is where the old build
silently rendered an empty box.

## What it is not

On a form, this is an editor, not a gate. It shows a fault; it cannot refuse
to save one — Power Apps gives a control no way to reject a save, so
validation that has to hold belongs in a business rule or a plugin. In a
canvas app the save is yours, and `isValid` is what to gate it on.

## Properties

::props-table
