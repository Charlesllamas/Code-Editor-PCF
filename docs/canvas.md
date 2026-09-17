---
title: Canvas apps
description: Using the control in a canvas app, and how it binds.
order: 4
---

# Canvas apps

The control works in a canvas app, and sizes itself to the box you draw.

## Enabling code components

Code components are off by default in a canvas app. Turn them on per app:

1. **Settings → General → Advanced settings** (the exact path moves between
   Studio versions).
2. Enable **Components → Code components**.
3. Reopen the app. The imported control appears under **Insert → Get more
   components → Code**.

## Binding the value

```powerapps title="Code property"
DocumentGallery.Selected.'Configuration JSON'
```

Writing back needs an explicit action, because a canvas app saves nothing on its
own:

```powerapps title="OnSelect of a Save button" highlight="4"
Patch(
    Documents,
    DocumentGallery.Selected,
    { 'Configuration JSON': CodeEditor1.code }
)
```

## Galleries

Selecting a different record in a gallery updates the editor. The control
compares the incoming value against what the editor holds and writes it in when
they differ.

:::callout{type=info}
This is the fix for what used to be this page's biggest warning. Earlier releases
handed the value to Monaco as `defaultValue`, which Monaco reads once at mount
and ignores afterwards — so changing gallery selection left the previous
record's document on screen, and saving wrote it over the newly selected record.
The remount workaround that used to be documented here is no longer needed.
:::

The one case that still will not update is a value arriving **while the cursor is
in the editor**. That is deliberate — see [Limitations](limitations) — and it
resolves as soon as focus leaves the control. In practice a gallery selection
moves focus out of the editor anyway.

## Other rough edges

- The editor fills the box you give it. A short box gets a short editor with its
  own scrollbar rather than an overflow. `height` and `fitContent` do nothing
  here — the box you draw is the height.
- A canvas app publishes no theme, so `theme: auto` is light. Set `dark` for
  the dark editor.
- Monaco captures keyboard shortcuts while focused, so app-level shortcuts bound
  to the same keys will not fire while the cursor is in the editor. `Ctrl+F`
  opens Monaco's find widget.
- `Language` is a plain text property, so it can be an expression — one editor
  that switches grammar with the record it is showing is one `Switch()` away.
  Unlike earlier releases, changing it re-colours the open document rather than
  waiting for a remount.
