// Which of Monaco's two built-in themes to use.
//
// `auto` follows the app: `context.fluentDesignLanguage.isDarkTheme`, which a
// model-driven app with the modern look publishes and a canvas app does not.
// Absent means light rather than "ask the operating system" — the app has a
// theme of its own and the OS setting says nothing about it (the skill's
// styling rule, and the reason `prefers-color-scheme` is not consulted).
//
// Monaco's theme is global to the page: `setTheme` restyles every standalone
// editor on it, so two of these controls on one form share one. Which one is
// `pageTheme`'s job: a forced `light` or `dark` outranks `auto` — a maker who
// forced one editor and left the other alone meant the forced one — and of
// two forced themes that disagree, the last to arrive wins. Before 1.4.0 the
// last to *render* won outright, and each strip kept its own control's
// setting: a forced-dark editor beside an `auto` one on a light app drew a
// light editor over a dark strip (SPEC.md, beside P5). Said in the docs.

export type MonacoTheme = "vs" | "vs-dark";

/** One control's say in the page's theme. */
export interface ThemeVote {
    preference: string | null | undefined;
    isDarkTheme: boolean | undefined;
}

function isForced(preference: string | null | undefined): boolean {
    const pref = String(preference ?? "").trim().toLowerCase();
    return pref === "light" || pref === "dark";
}

/**
 * The theme the page shows, from every live control's vote in the order they
 * arrived: the last forced one, or — with none forced — the last `auto`, all
 * of which read the same app. No votes is light.
 */
export function pageTheme(votes: ThemeVote[]): MonacoTheme {
    const forced = votes.filter((v) => isForced(v.preference));
    const decisive = forced.length > 0 ? forced[forced.length - 1] : votes[votes.length - 1];
    return decisive ? resolveTheme(decisive.preference, decisive.isDarkTheme) : "vs";
}

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
