---
title: Model-driven apps
description: Where the control fits on a model-driven form, and how it behaves there.
order: 3
---

# Model-driven apps

This is the control's home. It binds to a text column on a form, and everything
below assumes a model-driven form unless it says otherwise.

## Sizing, and why it is what it is

The editor renders at `height: 90vh` — ninety percent of the browser viewport,
regardless of what the form allocates. This is baked into the control and there
is no property for it.

The practical consequence: give the column a **section of its own**, ideally on
a dedicated tab. Placing it inline among other fields produces a form where one
column occupies the whole screen and everything after it is below the fold.

:::callout{type=info}
If a shorter editor matters more to you than anything else here, the height is a
one-line change in `CodeEditor/components/Editor.tsx` and the repository builds
both solution types. Forking for it is a legitimate answer.
:::

## Saving

The control calls `notifyOutputChanged` on every keystroke, so the form's dirty
state tracks what is in the editor. Two consequences worth knowing:

- **Autosave will fire mid-edit.** On a table with autosave enabled, a pause
  while typing saves a partially written document. That is the platform's
  behaviour for any column, but it is more noticeable when the value is a
  document rather than a name.
- **There is no validation gate.** A control cannot cancel a save, so a
  syntactically invalid document saves like any other value.

:::callout{type=danger}
If the column feeds an integration that will fail on malformed input, validate it
somewhere that can actually stop the save — a synchronous plugin on the `Update`
message, or a business rule. Relying on the red squiggle to have been noticed is
relying on the user.
:::

## Read-only columns are still editable

The control does not read `context.mode.isControlDisabled`, so a column that is
read-only on the form, locked by a business rule, or disabled for the user's
security role still renders an editable Monaco instance.

Typing into it changes the value the control reports, and the platform then
refuses the write — so nothing is corrupted, but the user has been allowed to do
work that is silently discarded. Do not put this control on a column you rely on
the form to protect.

## The value is read once, at mount

Monaco is given the column's value as `defaultValue`, which it reads when the
editor is created and never again. On a normal model-driven form that is
invisible: opening a record mounts the control with that record's value.

It becomes visible when something changes the column while the form is open — a
workflow writing back, or another control's `setValue`. The editor keeps showing
what it was given, and a save then writes the stale text over the new value.
Reloading the form resynchronises it.

## Field security

Field-level security is honoured because the platform never sends the value to a
control the user cannot read. The editor renders empty in that case, which is
indistinguishable from an empty column; if that distinction matters on your form,
a separate read-only indicator column is the usual workaround.
