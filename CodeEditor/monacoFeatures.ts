// Which parts of the editor ship, chosen one by one.
//
// `monaco-editor/editor/editor.api` is the bare editor: it types, scrolls and
// colours, and nothing else. Every editing feature people think of as
// "Monaco" -- the find widget, folding, bracket matching, the context menu,
// Format Document, the hover that shows a marker's message -- is a separate
// contribution, and `editor.main` (the file that imports them all) also
// imports eighty grammars and the four worker-backed language services this
// control cannot run. So the list is written out here instead.
//
// The rule for adding one: it has to work without a language service. A
// contribution that only lights up given a provider -- suggest, rename,
// go-to-definition, code lens, inlay hints -- is bundle weight with no
// visible effect here. Measure `out/controls/CodeEditor/bundle.js` after a
// production build; the ceiling is Dataverse's 5 MB web resource limit and
// docs/limitations.md quotes the current figure.

// Keyboard and mouse basics the API build leaves out.
import "monaco-editor/editor/browser/coreCommands";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations";
import "monaco-editor/editor/contrib/caretOperations/browser/caretOperations";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor";
import "monaco-editor/editor/contrib/lineSelection/browser/lineSelection";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/editor/contrib/smartSelect/browser/smartSelect";
import "monaco-editor/editor/contrib/indentation/browser/indentation";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/longLinesHelper/browser/longLinesHelper";

// What a document editor is expected to have.
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/features/find/register";
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter";

// The 1.2.0 features: Format Document runs the provider monacoSetup.ts
// registers; the hover is how a marker's message is read in place; F8 walks
// the markers; the read-only message explains a locked column on keypress.
import "monaco-editor/editor/contrib/format/browser/formatActions";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError";
import "monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus";
import "monaco-editor/editor/contrib/readOnlyMessage/browser/contribution";

// Accessibility and the platform's clients: Ctrl+M releases Tab for the
// form's own focus order, F1 lists every command, Ctrl+G goes to a line, and
// the iPad keyboard button matters on the tablet client.
import "monaco-editor/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess";
import "monaco-editor/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard";
import "monaco-editor/editor/common/standaloneStrings";

// The codicon icon font is not listed: the package's exports map appends
// `.js` to every deep path, so a `.css` cannot be named from here -- and it
// does not need to be. `codeEditorWidget` imports the stylesheet itself, and
// webpack.config.js inlines the TTF it references.
