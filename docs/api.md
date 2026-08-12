---
title: API reference
description: The control's properties, as declared in its manifest.
order: 5
---

# API reference

The table below is generated from `ControlManifest.Input.xml` for the release you
are reading, so it cannot disagree with the control you installed.

::props-table

## The bound property

`code` is declared against a type group rather than a single type:

```xml title="CodeEditor/ControlManifest.Input.xml" highlight="2-3"
<type-group name="text">
  <type>SingleLine.TextArea</type>
  <type>Multiple</type>
</type-group>
```

So it binds to a **Single Line of Text** column with the Text Area format, or to
a **Multiple Lines of Text** column. A plain single-line text column is not
offered, and that is deliberate — the platform caps it at 4,000 characters and an
editor is the wrong shape for a value that short.

## The language property

`language` is a required input string, passed to Monaco as `defaultLanguage`
after being lowercased. It has no default in the manifest; the control falls
back to `json` if the platform hands it a null.

Both properties are read when the editor mounts and not afterwards. See
[Limitations](limitations).

## Localisation

Two resource files ship with the control:

| Language | File |
|---|---|
| English (1033) | `strings/CodeEditor.1033.resx` |
| Spanish (3082) | `strings/CodeEditor.3082.resx` |

They cover the property display names and descriptions shown in the form
designer. Monaco's own interface is not localised by these.

## The external service declaration

```xml title="CodeEditor/ControlManifest.Input.xml"
<external-service-usage enabled="false">
</external-service-usage>
```

:::callout{type=warning}
This declaration is what keeps the control out of the premium classification, and
it does not describe what the control does at runtime: `@monaco-editor/react`
fetches the editor from `cdn.jsdelivr.net` on first render. Treat the control as
requiring outbound browser access to that host when you assess it.
:::

There is no `feature-usage` block. The control uses neither the Web API nor any
device capability, which keeps it usable where those are restricted.
