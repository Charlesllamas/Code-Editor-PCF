---
title: Limitations
description: What the control cannot do, and why.
order: 6
---

# Limitations

Written down here rather than discovered on a form. Everything below is current
as of 1.0.2.

## Monaco comes from a public CDN

The control uses `@monaco-editor/react`, which loads the editor from
`cdn.jsdelivr.net` on first render rather than bundling it. If the browser cannot
reach that host — a restricted corporate network, a sovereign cloud, an air-
gapped environment — the control renders an empty box and says nothing.

The manifest declares `external-service-usage enabled="false"`, which is what
keeps the control out of the premium classification. That declaration does not
match the runtime behaviour, and the runtime behaviour is the one your users
experience.

## The height is fixed at 90vh

Ninety percent of the viewport, regardless of the space the form gives it. There
is no property for it. Give the column a section of its own.

## The value is read once, at mount

Monaco receives the column value as `defaultValue`, which it reads when the
editor is created and ignores from then on. A value that changes underneath the
open form — a workflow writing back, a canvas gallery selecting a different
record — leaves the editor showing stale text that a save will then write out.

See [Canvas apps](canvas) for the workaround, which is to force a remount.

## Read-only columns are still editable

`context.mode.isControlDisabled` is not read, so a column locked by the form, a
business rule or field security still renders an editable editor. The platform
refuses the write, so nothing is corrupted — but the user was allowed to do work
that is discarded without explanation.

## It cannot block a save

The Power Apps component framework does not let a control cancel a save, so an
invalid document saves like any other value. Monaco's error underlines are a
prompt to the person typing, not a gate.

## No theme property

The editor renders in Monaco's default light theme regardless of the app's
appearance.

## Large documents get slow

Monaco handles megabyte files comfortably; the platform around it does not. A
model-driven form round-trips the whole column value on every save, and a
Multiple Lines of Text column is capped at 1,048,576 characters. Documents in
the hundreds of kilobytes are usable but noticeably slower to save.

## Keyboard shortcuts are captured while focused

Monaco binds a lot of keys. While the cursor is inside the editor, app- or
browser-level shortcuts sharing those bindings will not fire.

## No demo on PCFHub

There is no interactive preview for this control on the hub. It would need to
load Monaco from a third-party CDN inside the demo origin's content security
policy, which that origin exists specifically to forbid — so the manifest
declares `"fidelity": "none"` rather than shipping a preview that behaves
differently from the real control.
