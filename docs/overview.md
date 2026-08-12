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

- Syntax colouring for the language you configure the column with.
- Bracket matching, folding, indentation and line numbers.
- Full IntelliSense and validation for TypeScript, JavaScript, JSON, HTML, CSS,
  LESS and SCSS.
- Basic colouring for around thirty more, including XML, C#, SQL, PowerShell,
  YAML and Markdown.

## Before you install it

:::callout{type=warning}
**Monaco is fetched from a public CDN at runtime, not bundled.** The control
loads the editor from `cdn.jsdelivr.net` on first render, so the browser needs
outbound access to that host. On a locked-down network, or a sovereign cloud
where the tenant cannot reach public CDNs, the control renders an empty box and
nothing in the form tells the user why.

The control's manifest declares `external-service-usage enabled="false"`, which
is how it avoids being classed as premium. That declaration and the CDN fetch do
not agree, and the fetch is the one that decides whether your users see an
editor. Test it on a representative network before rolling it out.
:::

The editor is also **fixed at 90% of the viewport height**. That suits a form
section given over to a document; on a dense form beside other fields it will
dominate the page. There is no property to change it.

## What it is not

This is an editor, not a validator. Monaco will underline a syntax error in JSON
as you type, but nothing here stops an invalid value being saved — Power Apps
gives a control no way to reject a save, so validation belongs in a business rule
or a plugin.

## Properties

::props-table
