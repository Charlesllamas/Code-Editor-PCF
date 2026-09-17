// Which of Monaco's two built-in themes to use.
//
// `auto` follows the app: `context.fluentDesignLanguage.isDarkTheme`, which a
// model-driven app with the modern look publishes and a canvas app does not.
// Absent means light rather than "ask the operating system" — the app has a
// theme of its own and the OS setting says nothing about it (the skill's
// styling rule, and the reason `prefers-color-scheme` is not consulted).
//
// Monaco's theme is global to the page: `setTheme` restyles every standalone
// editor on it. Two of these controls on one form therefore share a theme,
// which under `auto` is what a user expects and under a forced `light` next to
// a forced `dark` is a fight the last one to render wins. Said in the docs.

export type MonacoTheme = "vs" | "vs-dark";

export function resolveTheme(preference: string | null | undefined, isDarkTheme: boolean | undefined): MonacoTheme {
    const pref = String(preference ?? "auto").trim().toLowerCase();
    if (pref === "dark") {
        return "vs-dark";
    }
    if (pref === "light") {
        return "vs";
    }
    return isDarkTheme === true ? "vs-dark" : "vs";
}
