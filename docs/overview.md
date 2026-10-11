---
title: Overview
description: A Monaco-backed code editor for multiline text columns in Power Apps.
order: 1
---

# Overview

Code Editor replaces the plain textarea a multiline text column gets by default
with the [Monaco editor](https://microsoft.github.io/monaco-editor/) — the same
editor that runs inside Visual Studio Code.

:::callout{type=info}
**Built with AI assistance · maintained.** Version 1.0 was written by hand in 2022; later versions were written with AI (Claude) and tested on a live Dataverse form, and that code has not been reviewed line by line. Maintained by Charles Llamas.
:::

::image{src=media/screenshot.png alt="A JSON document in the Code Editor with two faults marked, and the strip beneath it naming the first" zoom}

It exists because of a specific, common situation: a solution stores JSON or XML
in a text column, and somebody eventually has to edit it. Without an editor that
understands the format, that means counting braces in a box with no line
numbers, and finding out it was wrong when the integration fails.

## What you get

- Syntax colouring for fourteen languages: JSON, XML, SQL, YAML, Power Query M,
  DAX, Markdown, PowerShell, C#, Python, CSS, HTML, JavaScript and TypeScript.
- **Validation for JSON, XML and FetchXML** — faults marked in the editor and named in
  the strip beneath it, with a click to jump to the first. Strict JSON: no
  comments, no trailing commas.
- **Checking against a JSON Schema** — a schema kept as a web resource in
  your environment (or passed inline in a canvas app), its faults marked and
  worded like syntax faults: *Missing required property "sku"*, *Must be one
  of "open", "closed"*.
- **Completion and hover from the schema** — with a schema in force, the
  property names it declares where a key goes (required ones first) and its
  allowed values where a value goes, each with its description; rest the
  pointer on a property to read what the schema says about it. Enter takes a
  suggestion.
- **FetchXML, with your environment's names** — set `language` to `fetchxml`
  and the editor completes FetchXML's elements, attributes and operators, and
  on a form your environment's tables, the columns of the table in scope with
  their display names, the joins a `link-entity` can make (filling in `from`
  and `to`), and a choice column's options by label. An element or an operator
  Dataverse refuses is marked as a fault; a table or column your environment
  does not have is a warning.
- **Format** for JSON, XML and FetchXML, from the strip, the context menu or
  `Shift+Alt+F`.
- **Changes** (from 1.6.0) — once you have changed the document, a button in
  the strip shows it against the value as it was last saved, side by side
  where there is room and in one column where there is not. The right-hand
  side is the editor itself, so you can keep typing there; a save — yours or
  the form's auto-save — becomes the new starting point.
- **A Markdown preview** (from 1.6.0) — a Markdown column gets **Preview** in
  the strip, and can open rendered instead of as text (*Open Markdown in*).
  Headings, lists, task lists, tables, code and basic HTML render; scripts,
  styles, frames and media do not. Images come only from your own
  environment: one from another site is shown as a link, never loaded, so
  opening a record tells nobody outside who opened it.
- **A JSON tree** (from 1.7.0) — a JSON column gets **Tree** in the strip, and
  can open as one (*Open JSON in*). Browse it with the arrow keys or the
  mouse; **Enter** or a double-click takes you back to that node's text in the
  editor, selected; **Ctrl+C** or **Copy path** copies where the node is, such
  as `$.lines[0].sku`. With a schema in force, the strip shows what the schema
  says about the node in focus. A read-only column gets the tree too.
- **`isValid` and `problemCount`** for a canvas app to act on — a Save
  button that refuses an invalid document is one `DisplayMode` formula.
- **Light or dark**, following the app's theme or forced either way.
- Bracket matching, folding, indentation, find and replace, multi-cursor, and
  a context menu.
- An editor that sizes itself to the space the form gives it — or to the
  document, with `fitContent`, up to a height you choose.
- Nothing outside your environment. Monaco is compiled into the solution, and a schema is read from your own web resources.

::image{src=media/screenshot-completion.png alt="An empty JSON object with the completion list open under the caret: id, marked number and required, then lines and status" zoom}

::image{src=media/screenshot-hover.png alt="The pointer on the status property: its description, its two allowed values and its default, in a box above the line" zoom}

::image{src=media/screenshot-fetchxml.png alt="A FetchXML query on account with the list open inside an attribute's name: account's columns, each with its display name beside it" zoom}

::image{src=media/screenshot-dark.png alt="The same editor in the dark theme, sized to its eight-line document" zoom}

::image{src=media/screenshot-changes.png alt="Changes open over a JSON document edited twice: each changed line shown removed in red and added in green, the changed words highlighted, and Back to editing in the strip" zoom}

::image{src=media/screenshot-tree.png alt="An order opened as a tree: its id, its lines opened to the first line's sku and qty, the focus on qty, and the strip reading $.lines[0].qty — How many; at least one." zoom}

::image{src=media/screenshot-markdown.png alt="A Markdown checklist rendered in the preview: a heading, ticked and unticked tasks, a table, a quotation, and an image from another site shown as a link" zoom}

## What you do not get

:::callout{type=warning}
**No IntelliSense beyond a JSON Schema and FetchXML, and no validation
beyond JSON and XML.** Monaco's language services run in web workers, and
Power Apps serves a code component as a single JavaScript file with no way to
serve worker files alongside it. The JSON and XML checks, completion from a
JSON Schema and everything FetchXML gets run on the main thread instead;
JSON without a schema suggests nothing, and the other twelve languages are
coloured, not flagged.

**Fourteen languages, not eighty.** Monaco has grammars for around eighty; this
control bundles a curated fourteen. Anything else renders as plain text. Adding
more is cheap — see [Limitations](limitations).
:::

If you are upgrading from a release that loaded Monaco from a CDN, both of those
are a step back from what you had — that build had IntelliSense in every
language and every grammar Monaco ships. What you get in exchange is a control that
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
