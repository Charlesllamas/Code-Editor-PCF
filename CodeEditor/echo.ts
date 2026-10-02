/**
 * Whether a bound value arriving in `updateView` is the form's own change —
 * to be written into the editor — or an echo of this control's own write.
 *
 * The platform hands every `notifyOutputChanged` back as an `updateView`
 * carrying the value just written, **late and not necessarily in order**:
 * typing "pase laur" on a real form produced passes carrying "pase laur",
 * "pase lau", "pase laur" (measured 2026-09-13, the template's scaffold).
 * Until 1.5.1 the editor told the two apart by focus alone — an incoming value
 * was written in only while the editor had no focus — which held while the
 * user typed and failed twice:
 *
 * - **A blur inside the echo window.** Type quickly and click away, and the
 *   late echo of an earlier keystroke (120–430 ms behind, measured on
 *   pcf-input-mask's form) arrives at an editor without focus, is written in,
 *   and the last characters typed are gone — and the next save writes the
 *   shorter text back.
 * - **PCFHub's demo.** It never writes an output back, and re-renders — on a
 *   width, a theme, a preset switch — with the preset's value as it always
 *   was; an unfocused editor took that as the form's change and wiped the
 *   visitor's edit (pcf-input-mask's demo, 2026-09-28).
 *
 * So: a value equal to what the host said last time is not news; a value this
 * control wrote recently is an echo whatever its order; anything else is the
 * form's — a script, a business rule, another record — and is taken, and the
 * list starts again. Pure, so the suite loads it from source (the bundle
 * cannot load in Node).
 */

/**
 * Bounded lower than the template's 32: these are whole documents, not field
 * values, and the measured lag is one keystroke.
 */
const KEEP = 16;

export class EchoGuard {
    private written: string[] = [];
    private lastIncoming: string | undefined = undefined;

    /** A value this control is about to hand the platform. */
    public wrote(value: string): void {
        this.written.push(value);

        if (this.written.length > KEEP) {
            this.written.shift();
        }
    }

    /**
     * Whether `incoming` should replace `current` in the editor. Records
     * `incoming` as what the host said, so it is called once per pass.
     */
    public takes(incoming: string, current: string): boolean {
        const repeated = incoming === this.lastIncoming;

        this.lastIncoming = incoming;

        if (repeated || incoming === current || this.written.includes(incoming)) {
            return false;
        }

        this.written = [];

        return true;
    }
}
