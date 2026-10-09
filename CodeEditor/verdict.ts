/**
 * The `isValid` and `problemCount` outputs: when the host has to be told.
 *
 * A host keeps an output at its own default until the control reports one —
 * a canvas app's `isValid` is false — and it asks only after
 * `notifyOutputChanged`. Telling it only when the verdict *changed* left a
 * canvas app reading false for a document with nothing wrong, until the first
 * keystroke: the verdict starts valid, a value the app hands in keeps it
 * valid, and nothing is ever reported (SPEC.md, the 1.6.0 canvas
 * walkthrough, C6). So a verdict is reported until the host has read one,
 * and after that only when it changes.
 *
 * "Read" is the host calling `getOutputs`, not the control calling notify: a
 * notify can go unanswered (during `init`, say), and then the next verdict is
 * reported again.
 *
 * Pure, so the suite loads it from source.
 */

export interface VerdictValue {
    isValid: boolean;
    problemCount: number;
}

export class Verdict {
    private value: VerdictValue = { isValid: true, problemCount: 0 };
    private read = false;

    public get(): VerdictValue {
        return this.value;
    }

    /** A validation finished. Returns whether to call `notifyOutputChanged`. */
    public settle(next: VerdictValue): boolean {
        const changed = next.isValid !== this.value.isValid || next.problemCount !== this.value.problemCount;
        this.value = next;

        return changed || !this.read;
    }

    /** The host asked for the outputs: it holds the verdict now. */
    public reported(): VerdictValue {
        this.read = true;

        return this.value;
    }
}
