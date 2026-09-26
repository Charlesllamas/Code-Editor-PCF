// Which schema each editor on the page completes against.
//
// Monaco's providers are registered once per page and per language, not per
// editor: the one completion provider for JSON serves every Code Editor on
// the form. So each control files its schema here under its model's URI, and
// the provider looks the model up — two editors with two schemas each get
// their own list (measured on the form, SPEC.md P5). A control removes its
// entry when the schema stops being in force and in destroy().
//
// No Monaco import: keyed by the URI's string.

import { CompletionLabels } from "./complete";
import { HoverLabels } from "./hover";

export interface SchemaEntry {
    schema: unknown;
    labels: CompletionLabels & HoverLabels;
}

const entries = new Map<string, SchemaEntry>();

export const schemaRegistry = {
    set(uri: string, entry: SchemaEntry): void {
        entries.set(uri, entry);
    },
    get(uri: string): SchemaEntry | undefined {
        return entries.get(uri);
    },
    delete(uri: string): void {
        entries.delete(uri);
    },
    get size(): number {
        return entries.size;
    }
};
