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

Model-driven forms usually allocate no explicit height, and then the
`height` property decides — blank means **500 pixels**, which is what earlier
releases hard-wired. With `fitContent` on, the editor is as tall as its
document, between a few lines and that number; the form section grows and
shrinks with it. The strip beneath the editor is inside the height, not added
to it.

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

The editor's own check is a warning, not a gate: a JSON or XML fault is marked
and named in the strip, and the user can still save. See
[Limitations](limitations).
:::

## Validation and Format

With `validation` on (the default), a JSON document is parsed strictly on
every pause in typing — comments and trailing commas are faults — and an XML
document is checked for well-formedness. Each fault is underlined; the strip
names the first with its line and column and counts the rest, and pressing it
moves the caret there. Hovering a fault reads it in place, and `F8` walks
them.

**Format** in the strip tidies a JSON document and keeps its comments, and
re-indents an XML document without touching its content; `Shift+Alt+F` and the
right-click menu do the same. It is not shown for other languages or on a
read-only column.

### Checking against a JSON Schema

:::steps
1. In your solution, add a **web resource** of type **Script (JScript)** —
   Dataverse has no JSON type — named, say, `new_/schemas/order.json`, holding
   the schema. **Publish it.**
2. On the form, set the Code Editor's **JSON schema** property to that name.
3. Save and publish the form.
:::

::image{src=media/screenshot-schema.png alt="An order document checked against a web-resource schema: five faults underlined, the first named in the strip with a count of four more, and the schema's name beside it" zoom}

A document that breaks the schema is marked like a syntax fault, each with
its own message: *Expected a number, found a string*, *Missing required
property "sku"*, *Property "note" is not allowed*. The strip names the schema
in force; if it cannot be had — a misspelt name, a resource nobody published —
the strip says so, and syntax checking carries on.

From 1.4.0 the same schema **suggests as you type**: the property names it
declares where a key goes, required ones first, and its allowed values where
a value goes. Enter takes a suggestion — on a form, Tab moves to the next
field instead. Rest the pointer on a property to read its description. Write
a `description` (or VS Code's `markdownDescription`) and a `default` into the
schema, and both appear there.

The property panel accepts no more than 100 characters, so a schema cannot be
pasted into it on a form: use a web resource. After editing the schema,
**publish** again; an unpublished edit reaches nobody.

:::callout{type=warning}
Leave **Is valid** and **Problem count** unbound. They are outputs for canvas
apps; the classic form designer offers to bind a column to them, and the form
then fails to save.
:::

## FetchXML

Set **Language** to `fetchxml` on a column that holds a FetchXML query — a
configuration table's saved view, a flow's query, a report's dataset.

As you type, the editor offers what fits where the caret is:

- **Elements** — under `<entity>`, `attribute`, `filter`, `order`,
  `link-entity`… — and the attributes each takes, required ones first.
- **Your tables**, where a table's name goes, with their display names.
- **The columns of the table in scope**, with their display names: the
  `entity` or `link-entity` around the caret, or the link-entity a
  condition's `entityname` names. `from` lists the linked table's columns,
  `to` the columns of the table it links from.
- **The joins a `link-entity` can make**, first in its `name` list: picking
  one fills in `from` and `to` (and `intersect` for a many-to-many).
- **Operators**, the ones that suit the condition's column first.
- **A choice column's options** in a condition's `value` or `<value>`, by
  label, inserting the number.

Rest the pointer on a column, a table or an operator to read what it is.

::image{src=media/screenshot-fetchxml-faults.png alt="A FetchXML query with a misspelt element underlined in red, an unknown column and a value that is not one of the choice's options underlined in amber, and the strip naming the element" zoom}

**Faults and warnings.** With `validation` on, the query is checked once it is
well-formed XML. A fault is what Dataverse refuses: an element FetchXML does
not have, an element where its parent does not take it, an operator it does
not know. A **warning** is the rest — a name your environment does not have
(`account has no column "nmae"`), a column not valid for read, a value that is
not one of a choice's options, an attribute FetchXML does not have (Dataverse
ignores those), a value outside a fixed list. Warnings are marked in amber and
named in the strip when there is no fault to name.

The names are read from your environment's table definitions the first time
something needs them, with your own access, and kept while the form is open:
a column created since then appears after a reload. If they cannot be read,
the strip says so and the FetchXML grammar still completes.

## Theme

`theme: auto` follows the app. On the modern look the platform tells the
control whether the app is dark and the editor switches with it; on the classic
look nothing is published and the editor is light. `light` and `dark` force
one regardless. Monaco's theme is global to the page, so two editors on one
form share whichever was set last — with `auto` on both that is never a
difference.

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
