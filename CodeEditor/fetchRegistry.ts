// Which FetchXML editors are on the page, and what each completes from.
//
// The same arrangement as schemaRegistry.ts, for the same reason: Monaco
// registers one provider per language for the page, so each control files
// its entry under its model's URI and the provider looks the model up. An
// entry's `metadata` is null where no request can be made — canvas, the hub's
// demo — and completion then offers the grammar alone.
//
// No Monaco import: keyed by the URI's string.

import { FetchLabels } from "./fetchComplete";
import { FetchHoverLabels } from "./fetchHover";
import { Metadata } from "./metadata";

export interface FetchEntry {
    metadata: Metadata | null;
    labels: FetchLabels & FetchHoverLabels;
}

const entries = new Map<string, FetchEntry>();

export const fetchRegistry = {
    set(uri: string, entry: FetchEntry): void {
        entries.set(uri, entry);
    },
    get(uri: string): FetchEntry | undefined {
        return entries.get(uri);
    },
    delete(uri: string): void {
        entries.delete(uri);
    },
    get size(): number {
        return entries.size;
    }
};
