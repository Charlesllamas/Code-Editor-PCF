---
title: Installation
description: Import the solution and add the control to a form column.
order: 2
---

# Installation

## Import the solution

Download the managed solution and import it into your environment.

::download{kind=managed_solution}

The unmanaged solution is there too, for a development environment you intend to
customise the control in. Import the managed one everywhere else — an unmanaged
solution cannot be cleanly uninstalled, and a control is not something you want
permanently welded into a production environment.

:::callout{type=info}
Importing a solution needs the System Customizer or System Administrator role.
For a canvas app you also have to enable code components on the app itself — see
[Canvas apps](canvas).
:::

::download{kind=unmanaged_solution}

:::callout{type=info}
The control makes no external requests — Monaco is compiled into the solution —
so there is no CDN or firewall prerequisite. The trade is size: `bundle.js` is
about 4.9 MB against a default Dataverse limit of 5 MB. It imports into a default
environment as shipped, but leaves little headroom if you fork and extend it.
:::

## Add it to a model-driven form

1. Open the form editor for the table holding the column.
2. Select the multiline text column on the form.
3. Under **Components**, choose **+ Component** and pick **Code Editor**.
4. Set the **Language** property — see [Configuration](#configuration) below.
5. Choose which form factors the control applies to, then save and publish.

The editor sizes itself to the space the form allocates, falling back to 500
pixels tall when the form allocates nothing. Giving the column a section of its
own still reads best for a document, but it is no longer required to stop the
control swallowing the page — see [Model-driven apps](model-driven).

## Configuration

The control takes two properties.

::props-table{kind=input}

`Code` binds to the column itself and must be a **Multiple Lines of Text** or
**Single Line of Text (Text Area)** column. `Language` decides which grammar the
editor loads.

```text title="Accepted Language values"
json    xml     sql     yaml    powerquery   msdax
markdown    powershell    csharp    python    css    html
javascript    typescript
```

Common aliases are accepted too and resolve to the ids above:

```text title="Aliases"
DAX -> msdax        M, Power Query -> powerquery    yml -> yaml
T-SQL, TSQL -> sql  C#, cs -> csharp                ps1 -> powershell
md -> markdown      py -> python                    ts -> typescript
js, node, ecmascript -> javascript
```

Matching is case-insensitive. Anything unrecognised renders as plain text rather
than failing — so a typo shows up as an uncoloured document, not an error.

:::callout{type=warning}
This list is the whole of it. Java, PHP, C++, Ruby and the rest of Monaco's
eighty grammars are not bundled, and none of the fourteen get IntelliSense or
validation. [Limitations](limitations) explains the reasoning — and how to add a
language if you need one.
:::

## Build it yourself

The repository builds the same two solution files the release does.

```bash title="terminal" highlight="1-2"
npm install
npm run build
cd CodeEditorSolution
msbuild /t:build /restore /p:configuration=Release
```

The zips land in `CodeEditorSolution/bin/Release`. `msbuild` comes from Visual
Studio or the standalone Visual Studio Build Tools; the Developer Command Prompt
is the least painful way to get it on `PATH`.

:::callout{type=info}
The build needs `featureconfig.json` and `webpack.config.js` at the repository
root. They enable pcf-scripts' custom-webpack support, which is what lets
Monaco's stylesheets and icon font be compiled into the bundle. Building without
them fails.
:::
