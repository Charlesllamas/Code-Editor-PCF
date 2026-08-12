---
title: FAQ
description: The questions that come up after the control is on a form.
order: 7
---

# FAQ

## The editor is blank. What happened?

Almost always the CDN. Monaco is fetched from `cdn.jsdelivr.net` at runtime
rather than bundled into the solution, so a network that blocks it leaves the
control with nothing to render and no message. Open the browser console on the
form — a failed request to jsDelivr is the confirmation.

## The editor takes up the whole screen. Can I make it smaller?

Not through a property. The height is fixed at 90% of the viewport in the control
itself. Give the column a section, ideally a tab, of its own. If a shorter editor
matters more than staying on the released build, it is a one-line change in
`CodeEditor/components/Editor.tsx`.

## I changed the record in my gallery and the editor did not update.

Expected, and worth understanding before you save: Monaco receives the value as
`defaultValue`, which it reads at mount and ignores afterwards. The editor is
still showing the previous record's document, and saving writes that text over
the new record. See [Canvas apps](canvas) for the remount workaround.

## Why is the editor writable on a read-only column?

The control does not check `context.mode.isControlDisabled`. The platform still
refuses the write, so the data is safe — but the user is allowed to type into it
first. Do not use this control where the form is what enforces read-only.

## Can it validate the JSON before saving?

It will underline a syntax error as you type, but it cannot stop the save — the
component framework gives a control no way to cancel one. Validation that has to
hold belongs in a synchronous plugin or a business rule.

## Why is my column not offered when I add the control?

`Code` binds to **Multiple Lines of Text**, or to **Single Line of Text** with
the **Text Area** format. A plain single-line text column will not appear.

## Which languages are supported?

Everything Monaco ships a grammar for. TypeScript, JavaScript, JSON, HTML, CSS,
LESS and SCSS get full IntelliSense and validation; roughly thirty more,
including XML, C#, SQL, PowerShell and Markdown, get syntax colouring. See
[Installation](installation) for the identifiers.

## Can I change the theme?

Not in this version. The editor renders in Monaco's default light theme.

## Something is broken. Where do I report it?

Open an issue on
[the repository](https://github.com/Charlesllamas/Code-Editor-PCF/issues).
Include the environment type, the column type, and whether it is a model-driven
form or a canvas app — nearly every report comes down to one of those three.
