---
title: Overview
description: A Monaco-backed code editor for multiline text columns in Power Apps.
order: 1
---

# Overview

Code Editor replaces the plain textarea a multiline text column gets by default
with the [Monaco editor](https://microsoft.github.io/monaco-editor/) — the same
editor that runs inside Visual Studio Code.

It exists because of a specific, common situation: a solution stores JSON or XML
in a text column, and somebody eventually has to edit it. Without an editor that
understands the format, that means counting braces in a box with no line
numbers, and finding out it was wrong when the integration fails.

## What you get

- Syntax colouring for fourteen languages: JSON, XML, SQL, YAML, Power Query M,
  DAX, Markdown, PowerShell, C#, Python, CSS, HTML, JavaScript and TypeScript.
- Bracket matching, folding, indentation and line numbers.
- Find and replace, multi-cursor, and the rest of Monaco's editing surface.
- An editor that sizes itself to the space the form gives it.
- No network calls. Monaco is compiled into the solution.

## What you do not get

:::callout{type=warning}
**No IntelliSense, completion or validation — in any language.** Those features
run in Monaco web workers, and Power Apps serves a code component as a single
JavaScript file with no way to serve worker files alongside it. Broken JSON is
coloured, not flagged.

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

This is an editor, not a validator. Nothing here stops an invalid value being
saved — Power Apps gives a control no way to reject a save, so validation
belongs in a business rule or a plugin.

## Properties

::props-table
