---
title: Model-driven apps
description: Where the control fits on a model-driven form, and how it behaves there.
order: 3
---

# Model-driven apps

This is the control's home. It binds to a text column on a form, and everything
below assumes a model-driven form unless it says otherwise.

## Sizing

The control asks the platform to report container resizes and sizes the editor
from the width and height the form allocates it.

Model-driven forms often allocate no explicit height, and in that case the
editor falls back to **500 pixels**. That is a constant in the control, not a
property, so if it is the wrong height for your form the answer is a section
sized to suit it.

:::callout{type=info}
Earlier releases rendered at `height: 90vh` regardless of what the form
allocated, which is what made a dedicated tab mandatory. That is fixed — the
control now stays inside its box, and the scrollbar tracks the content rather
than the viewport.
:::

Giving the column a section of its own still reads better for a document-sized
value, but it is now a layout preference rather than a workaround.

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
message, or a business rule.

Do not rely on the user noticing a red squiggle: the bundled build has no
validation at all, so there is no squiggle to notice. See
[Limitations](limitations).
:::

## Read-only columns

The control reads `context.mode.isControlDisabled` and the bound column's
field-level security, and renders a read-only editor when either indicates the
value cannot be written. A column locked by the form, by a business rule, or by
the user's security role gets an editor that can be read, scrolled and copied
from, but not typed into.

Releases before the bundled build did not check any of this and rendered an
editable editor over a locked column.

## Values changing while the form is open

If something changes the column while the form is open — a workflow writing
back, or another control calling `setValue` — the editor picks the new value up.

The one exception is deliberate: it will not overwrite the editor while the
cursor is inside it. The platform reports the bound value back asynchronously,
so during typing it is routinely a keystroke stale, and writing it back would
reset the cursor to the top of the document on every key press. A change
arriving while somebody is mid-edit is therefore dropped rather than applied.

## Field security

Field-level security is honoured twice over: the platform never sends the value
to a control the user cannot read, and the control renders read-only when the
column is not editable. A user without read access sees an empty editor, which
is indistinguishable from an empty column; if that distinction matters on your
form, a separate indicator column is the usual workaround.
