#!/usr/bin/env node
/**
 * Read — and set — the version, in every place a control repository keeps one.
 *
 * Why this exists
 * ---------------
 * A release bumps three files (more, in a repository holding several
 * controls), and until now the only thing that checked they agreed was a
 * PowerShell step in `release-reusable.yml` that runs **after the tag is
 * pushed**, on a Windows runner. So the failure mode was: push tag, wait for a
 * runner, get a throw, delete the tag locally and remotely, fix, retag. Once
 * per repository, reliably, because nothing local ever said a word.
 *
 * `adopt.mjs` already had the three readers — it used them to print an
 * advisory note during adoption and nothing else. This promotes them to a tool
 * and adds the writer.
 *
 * The anchoring is the whole job
 * ------------------------------
 * A manifest carries **three kinds** of `version=` attribute and only one of
 * them is the control's:
 *
 *     <control … version="0.5.0" …>                    ← this one
 *     <resx path="…" version="1.0.0" />                ← a resx schema version
 *     <platform-library name="React" version="16.14.0" /> ← a pinned dependency
 *
 * A naive `s/version="[\d.]+"/…/` corrupts all three and the repository still
 * builds, because nothing validates a resx version and the platform library
 * pin only misbehaves at runtime. So every read and every write here is
 * anchored to the `<control …>` open tag, the same way `adopt.mjs` does it.
 *
 * `Solution.xml` has the same trap one element apart:
 *
 *     <ImportExportXml version="9.1.0.643" SolutionPackageVersion="9.1" …>
 *       <SolutionManifest>
 *         <Version>0.5.0</Version>                     ← this one
 *
 * Usage
 * -----
 *     npm run bump                          report every location; exit 1 if they disagree
 *     npm run bump -- 0.6.0                 set all of them
 *     npm run bump -- --minor               bump, from the agreed current version
 *     npm run bump -- --patch --dry-run
 *
 * **On PowerShell, call the script directly instead**:
 *
 *     node scripts/version.mjs --patch
 *
 * `npm run bump -- --patch` works in bash and is swallowed by npm in
 * PowerShell, which reads the flag as its own config and warns *"Unknown cli
 * config --patch"* — then runs the script with no arguments, so it prints the
 * report and changes nothing. It looks like the bump ran and did not need to
 * do anything. Measured 2026-09-20 on Windows, npm 10.
 *
 * The script is `bump` rather than `version` on purpose: npm reserves
 * `version` as a **lifecycle hook**, run in the middle of `npm version
 * <newversion>` — after package.json has been rewritten and before the commit.
 * A script named `version` would therefore fire at the one moment the three
 * locations are guaranteed to disagree, exit 1, and abort `npm version` with a
 * message about a disagreement npm had just created. `npm version` is the
 * wrong tool here anyway, since it knows about package.json and nothing else.
 *
 * A bump refuses while the locations disagree, because "bump from what" has no
 * answer then. Set explicitly to resolve it.
 *
 * What it does not do
 * -------------------
 * It does not tag, commit or write a changelog. `release.mjs` tags; the
 * changelog is the tag message, which the hub imports as the release body —
 * `docs/changelog.md` is a hard failure in `check-template.mjs` for that
 * reason.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * `variants/` is donor material for `setup.mjs` and `add-control.mjs`, not
 * this repository's own control — its manifests are pinned at 0.1.0 because
 * that is where a scaffolded control starts. `setup.mjs` deletes the directory
 * on adoption, so this only matters while working on the template itself, and
 * there it matters a lot: without the skip, every bump of the template would
 * rewrite the number a fresh control is born at.
 */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'bin', 'obj', 'generated', 'variants']);

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/* ------------------------------------------------------------------- argv */

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

/*
 * `--into <path>` so the template can run this against an adopted repository,
 * the way `adopt.mjs` and `add-control.mjs` are reached by path. Inside a repo
 * that has its own copy, `npm run bump` needs none of it.
 */
const intoAt = argv.indexOf('--into');
const root = intoAt === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(argv[intoAt + 1] ?? '');

if (intoAt !== -1 && !argv[intoAt + 1]) {
    fail('--into needs a path.');
}

const rest = intoAt === -1 ? argv : [...argv.slice(0, intoAt), ...argv.slice(intoAt + 2)];
const flags = rest.filter((arg) => arg.startsWith('--') && arg !== '--dry-run');
const positional = rest.filter((arg) => !arg.startsWith('--'));

const BUMPS = { '--major': 0, '--minor': 1, '--patch': 2 };

if (flags.some((flag) => !(flag in BUMPS))) {
    fail(`Unknown flag ${flags.find((flag) => !(flag in BUMPS))}. Use --major, --minor, --patch or --dry-run.`);
}

if (flags.length > 1) {
    fail('Pass one of --major, --minor or --patch.');
}

if (positional.length > 1) {
    fail('Pass one version.');
}

if (positional.length === 1 && flags.length === 1) {
    fail('Pass a version or a bump flag, not both.');
}

if (positional.length === 1 && !SEMVER.test(positional[0])) {
    fail(`"${positional[0]}" is not a three-part version. Dataverse solution versions are numeric.`);
}

/* --------------------------------------------------------------- locations */

/**
 * Every file holding the control's version, as
 * `{ path, label, version, replace(next) }`.
 *
 * `replace` returns the file's new contents rather than writing, so a dry run
 * and a real run take exactly the same code path up to the write.
 */
const locations = collect();

if (locations.length === 0) {
    fail('No package.json, ControlManifest.Input.xml or Solution.xml found. Is this a control repository?');
}

const missing = locations.filter((location) => location.version === null);

if (missing.length > 0) {
    fail(
        'No version could be read from:\n' +
        missing.map((location) => `    ${location.path} (${location.label})`).join('\n'),
    );
}

const distinct = [...new Set(locations.map((location) => location.version))];
const agreed = distinct.length === 1 ? distinct[0] : null;

/* ----------------------------------------------------------------- report */

if (positional.length === 0 && flags.length === 0) {
    report();

    if (agreed === null) {
        console.error(
            '\n  The versions disagree. CI checks the tag against every manifest and against\n' +
            '  Solution.xml, so a tag pushed now fails on a Windows runner after the pack.\n' +
            `  Fix with: npm run bump -- ${distinct[0]}\n`,
        );
        process.exit(1);
    }

    console.log(`\nAll ${locations.length} in agreement at ${agreed}.`);
    process.exit(0);
}

/* -------------------------------------------------------------------- set */

if (flags.length === 1 && agreed === null) {
    report();
    fail(
        'Cannot bump while the versions disagree — there is no single number to bump from.\n' +
        `  Set one explicitly first: npm run bump -- ${distinct[0]}`,
    );
}

const next = positional.length === 1 ? positional[0] : bump(agreed, BUMPS[flags[0]]);

if (agreed !== null && next === agreed) {
    fail(`Already at ${next}.`);
}

if (agreed !== null && !isAhead(next, agreed)) {
    fail(
        `${next} is not ahead of ${agreed}. Dataverse compares solution versions on import, ` +
        'and an upgrade that is not ahead does nothing.',
    );
}

for (const location of locations) {
    const before = readFileSync(location.path, 'utf8');
    const after = location.replace(before, next);

    if (after === before) {
        fail(`Nothing changed in ${rel(location.path)} (${location.label}). The anchor did not match.`);
    }

    if (!dryRun) {
        writeFileSync(location.path, after);
    }

    console.log(`  ${dryRun ? 'would set' : 'set'}  ${rel(location.path).padEnd(52)} ${location.version} → ${next}`);
}

migrationPage();
limitationsPage();

console.log(
    dryRun
        ? `\n--dry-run: nothing written. ${locations.length} location(s) would move to ${next}.`
        : `\n${locations.length} location(s) now at ${next}. ` +
          'Commit them together, then: npm run release',
);

/* ---------------------------------------------------------------- helpers */

function collect() {
    const found = [];

    for (const path of walk(root)) {
        const name = basename(path);

        if (name === 'package.json') {
            /*
             * Every package.json in the tree, not just the root one:
             * `add-control.mjs` writes one per control project, and CI does
             * not check those at all. package-lock.json is deliberately left
             * alone — npm rewrites it, and a hand-edited lock is worse than a
             * stale one.
             */
            found.push({
                path,
                label: 'package.json "version"',
                version: read(path, (text) => JSON.parse(text).version ?? null),
                replace: (text, value) => {
                    const parsed = JSON.parse(text);
                    const indent = /^\{\r?\n(\s+)"/.exec(text)?.[1] ?? '    ';
                    const newline = text.includes('\r\n') ? '\r\n' : '\n';

                    parsed.version = value;

                    return JSON.stringify(parsed, null, indent).replace(/\n/g, newline) +
                        (text.endsWith('\n') ? newline : '');
                },
            });

            continue;
        }

        if (name === 'ControlManifest.Input.xml') {
            found.push({
                path,
                label: '<control version=…>',
                version: read(path, controlVersion),
                replace: (text, value) =>
                    text.replace(/<control\b[^>]*>/, (element) =>
                        element.replace(/(\bversion\s*=\s*")[^"]*(")/, `$1${value}$2`)),
            });

            continue;
        }

        if (name === 'Solution.xml') {
            found.push({
                path,
                label: '<SolutionManifest><Version>',
                version: read(path, (text) => /<Version>([^<]+)<\/Version>/.exec(text)?.[1] ?? null),
                replace: (text, value) =>
                    text.replace(/(<Version>)[^<]+(<\/Version>)/, `$1${value}$2`),
            });
        }
    }

    return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The `<control>` element's own version, never a `<resx>` or a
 * `<platform-library>` one. Matched rather than parsed, as `adopt.mjs` and
 * `check-template.mjs` both do — there is no XML parser in the toolchain and
 * adding one for four attributes would be a dependency.
 */
function controlVersion(text) {
    const element = /<control\b[^>]*>/.exec(text)?.[0] ?? '';

    return /\bversion\s*=\s*"([^"]*)"/.exec(element)?.[1] ?? null;
}

function* walk(dir) {
    for (const entry of readdirSync(dir).sort()) {
        if (SKIP_DIRS.has(entry)) {
            continue;
        }

        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            yield* walk(path);
        } else {
            yield path;
        }
    }
}

function read(path, from) {
    try {
        return from(readFileSync(path, 'utf8'));
    } catch {
        return null;
    }
}

function bump(current, index) {
    const parts = SEMVER.exec(current);

    if (!parts) {
        fail(`Cannot bump "${current}" — it is not a three-part version.`);
    }

    const numbers = [Number(parts[1]), Number(parts[2]), Number(parts[3])];

    numbers[index] += 1;

    for (let after = index + 1; after < 3; after += 1) {
        numbers[after] = 0;
    }

    return numbers.join('.');
}

function isAhead(next, current) {
    const a = SEMVER.exec(next);
    const b = SEMVER.exec(current);

    if (!a || !b) {
        // A non-numeric version is the author's business; only refuse what can be compared.
        return true;
    }

    for (let part = 1; part <= 3; part += 1) {
        if (Number(a[part]) !== Number(b[part])) {
            return Number(a[part]) > Number(b[part]);
        }
    }

    return false;
}

/**
 * Offer `docs/migration.md` when the bump is one that can break a maker.
 *
 * `setup.mjs` deletes the template's copy on adoption, and for a good reason —
 * it ships `appliesTo: ">=1.0.0"`, which matches no release of a control
 * starting at 0.1.0, so the hub reports the range as matching nothing and skips
 * the page. `check-template.mjs` cannot catch that, because it validates
 * filenames and not frontmatter.
 *
 * So the deletion stays and the donor moves to `scripts/templates/`, written
 * out here **pinned to the version actually being cut**. That is the whole fix:
 * the page that used to be wrong by construction is now right by construction.
 *
 * Offered rather than imposed. Whether a change is breaking is a judgement the
 * version number only hints at — a minor bump can rename a property and a major
 * one can be a rewrite nobody has to do anything about — so this writes the
 * page when the number suggests it, says so, and never overwrites one that is
 * already there.
 */
function migrationPage() {
    const donor = join(root, 'scripts', 'templates', 'migration.md');
    const page = join(root, 'docs', 'migration.md');

    if (!existsSync(donor) || !existsSync(join(root, 'docs'))) {
        return;
    }

    if (existsSync(page)) {
        console.log(`\n  docs/migration.md already exists — left alone. Check its appliesTo covers ${next}.`);

        return;
    }

    const parts = SEMVER.exec(next);
    const before = SEMVER.exec(agreed ?? '');

    // A major bump always; a minor one only below 1.0, where 0.x minors are
    // where breaking changes actually live.
    const breaking = parts && before &&
        (Number(parts[1]) > Number(before[1]) ||
            (Number(parts[1]) === 0 && Number(parts[2]) > Number(before[2])));

    if (!breaking) {
        return;
    }

    if (!dryRun) {
        writeFileSync(page, readFileSync(donor, 'utf8').replace(/__VERSION__/g, next));
    }

    console.log(
        `\n  ${dryRun ? 'would write' : 'wrote'} docs/migration.md, pinned appliesTo ">=${next}".\n` +
        '  Fill it in or delete it — an unedited migration page is worse than none,\n' +
        '  and the hub publishes whatever is on the default branch.',
    );
}

/**
 * Name `docs/limitations.md` at the one moment it is most likely to be wrong.
 *
 * A release is usually picked off that page, and the hub publishes it from the
 * default branch — so a gap the release closes stays on the component page,
 * beside notes saying the opposite, until someone deletes the line.
 * `pcf-data-table` 0.6.19 shipped grouping with its page still saying "No
 * grouping and no aggregate row".
 *
 * A reminder rather than a check: which lines a release closes is a reading of
 * the notes against the page, and nothing here can do that reading.
 */
function limitationsPage() {
    if (!existsSync(join(root, 'docs', 'limitations.md'))) {
        return;
    }

    console.log(
        '\n  Reread docs/limitations.md for what this release closes: delete each gap it\n' +
        '  no longer has, write the new feature\'s own limits, and commit it with the bump.\n' +
        '  The hub publishes that page from the default branch.',
    );
}

function report() {
    console.log('');

    for (const location of locations) {
        const flag = agreed === null && location.version !== distinct[0] ? '  <- disagrees' : '';

        console.log(`  ${location.version.padEnd(10)} ${rel(location.path).padEnd(52)} ${location.label}${flag}`);
    }
}

function rel(path) {
    return relative(root, path).replace(/\\/g, '/');
}

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}
