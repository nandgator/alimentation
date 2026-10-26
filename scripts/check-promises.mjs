// Keeps the home page's promises honest.
//
//   node scripts/check-promises.mjs           fails if a promise has no test, a test names a
//                                             promise that does not exist, the home page and
//                                             the ledger disagree, or the ledger is out of date
//   node scripts/check-promises.mjs --write   rewrites the ledger's proof columns
//
// A test proves a promise by carrying the tag [P<n>] in its name.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ledgerPath = join(root, 'docs/PROMISES.md');
const write = process.argv.includes('--write');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'test-results', 'reports'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

// Which promises exist, and in what order.
const ledger = readFileSync(ledgerPath, 'utf8');
const rows = [...ledger.matchAll(/^\| (P\d+)\s+\| ([^|]+?)\s+\| ([^|]*?)\s+\| ([^|]*?)\s+\|$/gm)];
const promises = rows.map((m) => ({ id: m[1], text: m[2] }));
if (promises.length === 0) throw new Error('No promises found in docs/PROMISES.md');

// Which tests name them.
const proofs = new Map(promises.map((p) => [p.id, new Map()]));
const unknown = [];
for (const file of walk(root)) {
  if (!/\.(test|spec)\.tsx?$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\b(?:it|test|describe)(?:\.\w+)*\(\s*(['"`])(.*?)\1/g)) {
    for (const tag of m[2].matchAll(/\[(P\d+)\]/g)) {
      const per = proofs.get(tag[1]);
      if (!per) {
        unknown.push(`${relative(root, file)}: ${tag[1]}`);
        continue;
      }
      per.set(relative(root, file), (per.get(relative(root, file)) ?? 0) + 1);
    }
  }
}

const problems = [];
for (const p of promises)
  if (proofs.get(p.id).size === 0) problems.push(`${p.id} (“${p.text}”) has no test that names it`);
for (const u of unknown) problems.push(`a test names a promise that is not in the ledger: ${u}`);

// The home page must show exactly the ledger's promises, in the ledger's words.
const home = readFileSync(join(root, 'apps/web/src/pages/Home.tsx'), 'utf8');
const shown = [...home.matchAll(/^\s+title: '([^']+)'/gm)].map((m) =>
  m[1].replace(/’/g, "'").replace(/\.$/, '').toLowerCase(),
);
const wanted = promises.map((p) => p.text.replace(/’/g, "'").replace(/\.$/, '').toLowerCase());
if (shown.length !== wanted.length)
  problems.push(`the home page shows ${shown.length} promises and the ledger has ${wanted.length}`);
else
  shown.forEach((title, i) => {
    if (title !== wanted[i])
      problems.push(
        `${promises[i].id}: the home page says “${title}” and the ledger says “${wanted[i]}”`,
      );
  });

// Rebuild the proof columns.
const short = (f) => f.replace(/^.*\//, '');
let next = ledger;
for (const p of promises) {
  const per = proofs.get(p.id);
  // A tag on a group of tests covers every test in it, so files are listed, not counted.
  const proof = per.size ? `tagged in ${[...per.keys()].map(short).sort().join(', ')}` : 'none';
  const status = per.size ? 'tested' : 'UNTESTED';
  next = next.replace(
    new RegExp(`^\\| ${p.id}\\s+\\| ([^|]+?)\\s+\\| [^|]*\\| [^|]*\\|$`, 'm'),
    (_all, text) => `| ${p.id}  | ${text} | ${proof} | ${status} |`,
  );
}

if (write) {
  writeFileSync(ledgerPath, next);
  console.log(`ledger rewritten for ${promises.length} promises`);
} else if (next.replace(/\s+/g, ' ') !== ledger.replace(/\s+/g, ' ')) {
  // Spacing differs after formatting; compare the cells.
  const cells = (t) =>
    [...t.matchAll(/^\| (P\d+)\s+\| ([^|]+?)\s+\| ([^|]*?)\s+\| ([^|]*?)\s+\|$/gm)].map((m) =>
      m.slice(1).join('|'),
    );
  if (cells(next).join('\n') !== cells(ledger).join('\n'))
    problems.push(
      'docs/PROMISES.md is out of date: run  node scripts/check-promises.mjs --write  and commit it',
    );
}

for (const p of promises) {
  const per = proofs.get(p.id);
  console.log(
    `${p.id}  ${per.size ? 'tested ' : 'MISSING'}  ${per.size} file${per.size === 1 ? '' : 's'}  ${p.text}`,
  );
}
if (problems.length) {
  console.error('\n' + problems.map((x) => '✗ ' + x).join('\n'));
  process.exit(1);
}
