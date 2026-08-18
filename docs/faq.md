---
title: FAQ
description: The questions that come up after the control is on a form.
order: 7
---

# FAQ

## The editor is blank. What happened?

It is no longer the CDN — the editor is bundled into the solution and the
control makes no external requests. Check the browser console on the form for a
script error, and confirm the solution imported cleanly; a `bundle.js` that
exceeded the environment's web resource size limit fails at import rather than
at runtime.

If you are on a release before the bundled build, the answer is different: those
versions fetched Monaco from `cdn.jsdelivr.net` and rendered nothing when that
host was unreachable. Upgrading is the fix.

## Why is my language showing as plain text?

Either it is not one of the fourteen bundled languages, or the identifier does
not match. The control accepts Monaco's language ids and a handful of common
aliases — `DAX`, `M`, `yml`, `T-SQL`, `C#`, `py`, `js` and `ts` all resolve.
Anything it does not recognise falls back to plain text rather than erroring.

See [Installation](installation) for the full list of accepted values.

## Why is there no red underline on my broken JSON?

Validation runs in a Monaco web worker, and Power Apps serves a code component
as a single file with no way to serve worker files beside it. Colouring, bracket
matching and folding all work; validation and completion do not. See
[Limitations](limitations).

## The editor takes up the whole screen. Can I make it smaller?

That was the old behaviour — the height was hardcoded to 90% of the viewport.
The control now sizes itself from what the form allocates it, falling back to
500 pixels when the form allocates nothing. In a canvas app it matches the box
you draw.

## I changed the record in my gallery and the editor did not update.

That is fixed. The control now writes the bound value into the editor whenever
it changes underneath.

One exception, by design: it will not do that while your cursor is in the
editor, because the platform reports the value back asynchronously and writing
it mid-edit would reset your cursor on every keystroke. Click out of the editor
and the value resynchronises.

## Why is the editor writable on a read-only column?

It should not be. The control reads `context.mode.isControlDisabled` and the
column's field-level security, and renders read-only when either says so. If you
are seeing an editable control on a locked column, that is worth
[reporting](https://github.com/Charlesllamas/Code-Editor-PCF/issues) — include
whether the lock comes from the form, a business rule or field security.

Older releases did not check any of this.

## Can it validate the JSON before saving?

No, on two counts. The component framework gives a control no way to cancel a
save, and the language workers that would produce the error in the first place
cannot run. Validation that has to hold belongs in a synchronous plugin or a
business rule.

## Why is my column not offered when I add the control?

`Code` binds to **Multiple Lines of Text**, or to **Single Line of Text** with
the **Text Area** format. A plain single-line text column will not appear.

## Which languages are supported?

JSON, XML, SQL, YAML, Power Query M, DAX, Markdown, PowerShell, C#, Python, CSS,
HTML, JavaScript and TypeScript. Colouring only — see the validation question
above.

That is fourteen of the roughly eighty grammars Monaco ships. The list is a
curated choice rather than a limit; [Limitations](limitations) covers how to add
one.

## Can I change the theme?

Not in this version. The editor renders in Monaco's default light theme.

## Something is broken. Where do I report it?

Open an issue on
[the repository](https://github.com/Charlesllamas/Code-Editor-PCF/issues).
Include the environment type, the column type, and whether it is a model-driven
form or a canvas app — nearly every report comes down to one of those three.
