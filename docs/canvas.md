---
title: Canvas apps
description: Using the control in a canvas app, and the binding behaviour that catches people out.
order: 4
---

# Canvas apps

The control works in a canvas app, with one behaviour that matters more here
than anywhere else: **the editor reads its value once, when it mounts.**

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

## The gallery problem

:::callout{type=danger}
Selecting a different record in a gallery **does not change what the editor
shows**. The control passes the value to Monaco as `defaultValue`, which Monaco
reads at mount and ignores afterwards — so the editor keeps displaying the first
record's document while `CodeEditor1.code` reports that same stale text.

Saving from that state writes one record's content over another's.
:::

The workaround is to force a remount when the selection changes. Wrapping the
control in a container whose `Visible` is driven by the selection, or keying the
screen on the selected record, both work — anything that makes the platform tear
the control down and build a new one.

If your app only ever edits one record per screen navigation, this never comes
up.

## Other rough edges

- The editor is fixed at 90% of the viewport height. A canvas control has an
  explicit width and height, and Monaco will overflow a box shorter than that.
- Monaco captures keyboard shortcuts while focused, so app-level shortcuts bound
  to the same keys will not fire while the cursor is in the editor. `Ctrl+F`
  opens Monaco's find widget.
- `Language` is a plain text property, so it can be an expression — one editor
  that switches grammar with the record it is showing is one `Switch()` away.
  Like the value, it is read at mount.
