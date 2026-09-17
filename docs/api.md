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

`language` is a required input string. The control lowercases it, resolves a
small set of aliases, and checks the result against the grammars compiled into
the bundle:

| Input | Resolves to |
|---|---|
| `DAX`, `MSDAX` | `msdax` |
| `M`, `Power Query` | `powerquery` |
| `yml` | `yaml` |
| `T-SQL`, `TSQL` | `sql` |
| `C#`, `cs` | `csharp` |
| `ps1` | `powershell` |
| `md` | `markdown` |
| `py` | `python` |
| `js`, `node`, `ecmascript` | `javascript` |
| `ts` | `typescript` |

An unrecognised value resolves to `plaintext` rather than raising an error, so a
misconfigured property shows up as an uncoloured document. A null or blank
value hands back `json`, which is the control's default; releases before 1.2.0
treated blank as plain text.

## The 1.2.0 inputs

All four are optional, so a form configured for 1.1.0 upgrades without a
change: `theme` defaults to `auto`, `validation` to `on`, `fitContent`
to off, and a blank `height` is the 500 pixels earlier releases hard-wired.

| Property | Values | Where it applies |
|---|---|---|
| `theme` | `auto`, `light`, `dark` | Everywhere. `auto` follows the app where one is published, and is light where none is. |
| `height` | pixels | Only where the host allocates no height — a model-driven form, usually. |
| `fitContent` | on/off | Only where the host allocates no height. Grows with the document, up to `height`. |
| `validation` | `on`, `off` | JSON and XML. `off` for a column that holds JSON with comments. |

The strip beneath the editor is not a property; it shows the resolved language,
the first fault when there is one, and **Format** for JSON.

Both properties are live. Changing either updates the open editor — the language
re-colours the current document in place, and a changed value is written in
unless the cursor is currently inside the editor. See [Limitations](limitations)
for why that exception exists.

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

This declaration is accurate: Monaco is compiled into `bundle.js` and the control
makes no outbound requests at runtime. It is also what keeps the control out of
the premium classification.

:::callout{type=info}
In releases before the bundled build this declaration was wrong —
`@monaco-editor/react` fetched the editor from `cdn.jsdelivr.net` on first
render, so the control did depend on an external host despite declaring
otherwise. If you are assessing an older version, treat it as requiring outbound
access to that host.
:::

There is no `feature-usage` block. The control uses neither the Web API nor any
device capability, which keeps it usable where those are restricted.
