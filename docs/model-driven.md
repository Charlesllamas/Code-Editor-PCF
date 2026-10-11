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

## Changes since the last save

From 1.6.0, **Changes** appears in the strip once the document differs from
the value as it was last saved. It opens Monaco's diff editor: the saved value
on the left, read-only, and the editor itself on the right — completion,
hover and the fault markers included — so typing there is typing in the
column. **Back to editing** returns to the single editor.

A control is never told the record was saved, so the editor reads it from what
the form hands it. When the record is saved — your Save, Save & Close, or the
auto-save, whichever column changed — the form passes the column back two or
three times carrying the value the editor already holds, and that becomes the
new starting point. Two things are **not** a save, by design:

- **A form script or a business rule setting the column** writes the new value
  into the editor (unless the cursor is in it) and leaves it in the diff, since
  it is not saved yet.
- **Reopening the record** starts from what is stored, as any new form does.

One case shows more than it should: a save pressed within a second of the last
keystroke can leave the starting point where it was until the next save, so the
diff still shows what was just saved. It never shows less than you changed.

## Markdown preview

From 1.6.0, a column whose `language` is `markdown` gets **Preview** in the
strip, and **Edit** to return. Set *Open Markdown in* to **Preview** for a
column people mostly read — instructions, release notes, a checklist — and it
opens rendered.

- **Images** are drawn when they come from your own environment — a web
  resource such as `/WebResources/new_/images/logo.png`, by its relative path
  or its full address — or are written inline as `data:` images. An image on
  any other site is shown as a link with its alt text and never loaded, so
  opening the record tells nobody outside who opened it.
- **Links** open in a new tab, over `http` and `https`. A `mailto:` link shows
  as its text: through the platform it opened nothing on the test form.
- **HTML** is rendered when it is basic markup — `<details>`, `<kbd>`, `<sub>`,
  `<br>` and the like. Scripts, event handlers, styles, frames, forms and media
  are removed.

## JSON tree

From 1.7.0, a column whose `language` is `json` gets **Tree** in the strip,
and **Edit** to return. Set *Open JSON in* to **Tree** for a column people
mostly browse — an integration's payload, a configuration they should not
have to read as text — and it opens as a tree.

The tree opens on the node the caret was in, with the way to it open. From
there:

| Key | What it does |
|---|---|
| ↑ ↓ | The row above or below |
| → | Opens a closed node; on an open one, moves to its first child |
| ← | Closes an open node; otherwise moves to its parent |
| Home, End | The first or last row |
| Page Up, Page Down | A page of rows |
| `*` | Opens every node beside this one |
| Enter | Back to the editor with this node's text selected |
| Ctrl+C | Copies this node's path, such as `$.lines[0].sku` |
| A letter | The next row whose name starts with it; type quickly for more letters |

A click on a row moves to it, a click on its arrow opens or closes it, and a
double-click goes back to its text. The strip shows the path to the node in
focus — and, with a schema in force, what the schema says about the place —
and **Copy path** copies it.

The tree is one stop for Tab: Tab moves on to the next field, as it does from
the editor. Each row tells assistive technology its name, its value or how
many items or keys it holds, and its level and place among its siblings.

- **A fault**: while the JSON has one, there is no tree — the fault is named
  where the tree would be, with **Go to the fault**.
- **Read-only and field-secured columns** get the tree too; it never edits.
- **The form changing the value** — a script, another user's save brought in
  by a refresh — rebuilds the tree, keeping what you had open and the node you
  were on, or the nearest one left.

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
