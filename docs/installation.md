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

::download{kind=unmanaged_solution}

:::callout{type=info}
Importing a solution needs the System Customizer or System Administrator role.
For a canvas app you also have to enable code components on the app itself — see
[Canvas apps](canvas).
:::

:::callout{type=warning}
Before you roll this out: the control fetches Monaco from `cdn.jsdelivr.net` at
runtime. Confirm your users' browsers can reach that host, on a representative
network, before the form goes live. See [Limitations](limitations).
:::

## Add it to a model-driven form

1. Open the form editor for the table holding the column.
2. Select the multiline text column on the form.
3. Under **Components**, choose **+ Component** and pick **Code Editor**.
4. Set the **Language** property — see [Configuration](#configuration) below.
5. Choose which form factors the control applies to, then save and publish.

Put the column in a section of its own. The editor renders at 90% of the viewport
height and will otherwise push everything below it off the screen — see
[Model-driven apps](model-driven).

## Configuration

The control takes two properties.

::props-table{kind=input}

`Code` binds to the column itself and must be a **Multiple Lines of Text** or
**Single Line of Text (Text Area)** column. `Language` is the Monaco language
identifier and decides which grammar the editor loads.

```text title="Language values with full IntelliSense"
typescript  javascript  json  html  css  less  scss
```

```text title="Language values with syntax colouring only"
xml   php     csharp  cpp     razor   markdown  diff
java  vb      coffee  handlebars      bat       pug
fsharp  lua   powershell  python  ruby  sass  r  objective-c
```

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
