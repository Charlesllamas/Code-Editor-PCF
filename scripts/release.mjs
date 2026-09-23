#!/usr/bin/env node
/**
 * Tag a release the way the pipeline and the hub expect it.
 *
 * Why this exists
 * ---------------
 * The tag message *is* the release body, and the release body *is* the
 * component's changelog on PCFHub — which is why `docs/changelog.md` is a hard
 * failure in `check-template.mjs`. So the tag is the most consequential thing
 * anyone types in this repository, and it is typed by hand, once every few
 * weeks, with two traps in it that fail silently:
 *
 * 1. **`--cleanup=verbatim`.** git's default message cleanup strips every line
 *    beginning `#` as a comment. A notes file written in Markdown therefore
 *    tags as its paragraphs with every heading removed, and nothing warns.
 *    `pcf-attachment-list` v0.2.0 went out that way and was re-tagged.
 * 2. **A lightweight tag.** `git tag v1.2.3` with no `-a`/`-m` gets GitHub's
 *    generated notes instead, which for a repository that pushes commits
 *    directly is one compare link. That was every component in the catalogue
 *    until 2026-09-12.
 *
 * `release-reusable.yml` warns about the second after the fact. This refuses
 * both before the push.
 *
 * Usage
 * -----
 *     npm run release -- --draft     write .release-notes.md from the log
 *     npm run release                tag from .release-notes.md
 *     npm run release -- --push      …and push the tag
 *     npm run release -- --dry-run   print the command it would run
 *
 * The draft is a starting point, not an output: it lists the commits since the
 * last tag so none is forgotten, and then somebody rewrites it for a reader
 * deciding whether to upgrade — what changed for them first, then what was
 * fixed, then anything they must do. A commit list is not release notes; the
 * compare link the workflow appends is already the commit list.
 *
 * What it does not do
 * -------------------
 * It does not bump — `version.mjs` does, and this refuses while the locations
 * disagree or while the tag would not match them. It does not commit: the
 * bump and the notes are the author's commit to write.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NOTES = join(root, '.release-notes.md');

const argv = process.argv.slice(2);
const draft = argv.includes('--draft');
const dryRun = argv.includes('--dry-run');
const push = argv.includes('--push');
const force = argv.includes('--force');

/* ------------------------------------------------------------------ state */

const version = agreedVersion();
const tag = `v${version}`;

if (draft) {
    writeDraft();
    process.exit(0);
}

/* ---------------------------------------------------------------- refusals */

if (!force && git(['status', '--porcelain']).trim() !== '') {
    fail(
        'The working tree is dirty. A tag names a commit, so anything uncommitted is not in\n' +
        '  the release — including, usually, the version bump itself. Commit first, or --force.',
    );
}

if (git(['tag', '-l', tag]).trim() === tag) {
    fail(
        `${tag} already exists locally. To replace it: git tag -d ${tag} && git push --delete origin ${tag},\n` +
        '  then re-run. The release body is replaced rather than appended when the workflow re-runs.',
    );
}

if (!existsSync(NOTES)) {
    fail(
        `No .release-notes.md. Write one — it becomes the release body and the hub's changelog —\n` +
        '  or start from the commit log: npm run release -- --draft',
    );
}

const notes = readFileSync(NOTES, 'utf8').trim();

if (notes === '') {
    fail('.release-notes.md is empty. An empty message tags lightweight, which is the thing this avoids.');
}

/*
 * `release-reusable.yml` strips a first line that is only the version, because
 * the release already carries that as its title. Worth saying here rather than
 * letting somebody write a heading that silently disappears.
 */
if (/^([a-z ]+\s)?(v|release\s+)?\d+\.\d+\.\d+\s*$/i.test(notes.split('\n')[0])) {
    console.warn(
        `\n  warning: the first line of .release-notes.md is just the version. The workflow strips\n` +
        '  it, because the release title already says it — so that line will not appear.\n',
    );
}

if (notes.includes('<!--')) {
    console.warn('\n  warning: .release-notes.md still contains an HTML comment. It will be published verbatim.\n');
}

/* -------------------------------------------------------------------- tag */

const command = ['tag', '-a', '--cleanup=verbatim', tag, '-F', NOTES];

if (dryRun) {
    console.log(`\n  would run: git ${command.join(' ')}`);
    console.log(`  ${push ? 'would then: ' : 'then, by hand: '}git push origin ${tag}\n`);
    console.log(`  the body would be:\n\n${notes.split('\n').map((line) => `    ${line}`).join('\n')}\n`);
    process.exit(0);
}

git(command);

/*
 * Read it back rather than trusting the write. `--cleanup=verbatim` is the
 * whole reason this script exists, and the failure it prevents is invisible in
 * the command that caused it — so the check is that the headings survived.
 */
const stored = git(['tag', '-l', '--format=%(contents)', tag]).trim();
const headingsWritten = (notes.match(/^#{1,6}\s/gm) ?? []).length;
const headingsStored = (stored.match(/^#{1,6}\s/gm) ?? []).length;

if (headingsWritten !== headingsStored) {
    git(['tag', '-d', tag]);
    fail(
        `The tag message lost ${headingsWritten - headingsStored} Markdown heading(s), so it was deleted again.\n` +
        '  That is what --cleanup=verbatim exists to prevent; this git may not support it.',
    );
}

console.log(`\n  tagged ${tag}, ${stored.split('\n').length} line(s), ${headingsStored} heading(s) intact.`);

if (push) {
    git(['push', 'origin', tag]);
    console.log(`  pushed. The Windows pack runs now; the hub imports the release as a draft.\n`);
} else {
    console.log(`  push it when ready: git push origin ${tag}\n`);
}

/* ---------------------------------------------------------------- helpers */

/**
 * The version every location agrees on — `version.mjs`'s job, repeated here
 * rather than shelled out to, because this needs the number and not the
 * report. A disagreement is fatal: the workflow compares the tag against every
 * manifest *and* `Solution.xml`, after the pack, on a Windows runner.
 */
function agreedVersion() {
    const found = new Map();

    const manifest = join(root, 'package.json');

    if (existsSync(manifest)) {
        found.set('package.json', JSON.parse(readFileSync(manifest, 'utf8')).version ?? null);
    }

    for (const path of manifests(root)) {
        const element = /<control\b[^>]*>/.exec(readFileSync(path, 'utf8'))?.[0] ?? '';

        found.set(path, /\bversion\s*=\s*"([^"]*)"/.exec(element)?.[1] ?? null);
    }

    const solution = join(root, 'Solution', 'src', 'Other', 'Solution.xml');

    if (existsSync(solution)) {
        found.set(solution, /<Version>([^<]+)<\/Version>/.exec(readFileSync(solution, 'utf8'))?.[1] ?? null);
    }

    const distinct = [...new Set(found.values())];

    if (distinct.length !== 1 || distinct[0] === null) {
        fail('The version locations disagree. Run: npm run bump');
    }

    return distinct[0];
}

function* manifests(dir) {
    for (const entry of readdirSync(dir).sort()) {
        if (['.git', 'node_modules', 'out', 'bin', 'obj', 'generated', 'variants'].includes(entry)) {
            continue;
        }

        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            yield* manifests(path);
        } else if (entry === 'ControlManifest.Input.xml') {
            yield path;
        }
    }
}

function writeDraft() {
    const last = lastTag();
    const range = last ? `${last}..HEAD` : 'HEAD';
    const log = git(['log', '--no-merges', '--format=- %s', range]).trim();

    const body =
        `Written for somebody deciding whether to upgrade: what changed for them, then what\n` +
        `was fixed, then anything they must do. Delete this paragraph and the list below once\n` +
        `it says those things — the compare link the workflow appends is already the commit list.\n\n` +
        `## What changed\n\n\n## Fixed\n\n\n## What you must do\n\n\n` +
        `---\n\n` +
        `Commits since ${last ?? 'the first one'}, so none is forgotten:\n\n${log || '- (none)'}\n`;

    writeFileSync(NOTES, body);

    console.log(`\n  wrote .release-notes.md for ${tag} — ${log.split('\n').length} commit(s) since ${last ?? 'the start'}.`);
    console.log('  Rewrite it, then: npm run release\n');
}

function lastTag() {
    try {
        return git(['describe', '--tags', '--abbrev=0']).trim() || null;
    } catch {
        return null;
    }
}

function git(args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}
