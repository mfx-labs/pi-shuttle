#!/usr/bin/env node
/**
 * PS-6 Lane B mandatory APFS evidence enforcement (SIR-PS6-004 correction;
 * PS6-MAC-001 semantics).
 *
 * The generic unit suite may retain truthful platform skips, but Lane B
 * first-class evidence must DISTINGUISH:
 *   PASS            — the darwin case-variant and Unicode OBJECT-IDENTITY
 *                     evidence (one filesystem object ⇒ at most one
 *                     registration, via the dev+ino duplicate-object guard)
 *                     EXECUTED and passed on this runner
 *   NOT EXECUTED    — any skip (case-sensitive volume, non-darwin host,
 *                     fixture failure to resolve) — the evidence job must
 *                     NOT be green
 * from plain test failure.
 *
 * Runs the committed `apfs-path-evidence` suite through the node test
 * runner with the TAP reporter and enforces a zero-skip, zero-fail
 * outcome. Exit codes:
 *   0 = APFS evidence PASS (all evidence tests executed and passed)
 *   1 = APFS evidence FAILED (a test assertion failed)
 *   3 = APFS evidence NOT EXECUTED (any skip — missing mandatory evidence)
 *   2 = usage/infrastructure error
 *
 * Test/CI evidence only — never part of the product.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const testFile = process.argv[2] ?? join(repoRoot, 'dist-test', 'tests', 'unit', 'apfs-path-evidence.test.js');
const platform = process.argv[3] ?? process.platform;

if (!existsSync(testFile)) {
  console.error(`APFS evidence: test file not found (run the build/tests compile first): ${testFile}`);
  process.exit(2);
}

if (platform !== 'darwin') {
  console.error('APFS evidence: NOT EXECUTED — the mandatory case-variant/Unicode evidence requires a darwin (APFS) host; this host is ' + platform);
  process.exit(3);
}

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testFile], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
if (run.error) {
  console.error('APFS evidence: NOT EXECUTED — test runner could not start: ' + run.error.message);
  process.exit(3);
}

let pass = 0;
let fail = 0;
let skip = 0;
for (const line of output.split('\n')) {
  const passMatch = line.match(/^# pass (\d+)$/);
  if (passMatch) pass = Number(passMatch[1]);
  const failMatch = line.match(/^# fail (\d+)$/);
  if (failMatch) fail = Number(failMatch[1]);
  const skipMatch = line.match(/^# skip(?:ped)? (\d+)$/);
  if (skipMatch) skip = Number(skipMatch[1]);
  if (line.includes('# SKIP')) skip = Math.max(skip, 1);
}

if (skip > 0) {
  console.error(`APFS evidence: NOT EXECUTED — ${skip} evidence test(s) skipped; mandatory Lane B case-variant/Unicode object-identity evidence is missing (this prevents Lane B from being green)`);
  console.error(output.trim().split('\n').filter((l) => l.includes('SKIP') || l.includes('skip')).slice(0, 12).join('\n'));
  process.exit(3);
}
if (fail > 0) {
  console.error(`APFS evidence: FAILED — ${fail} evidence assertion(s) failed`);
  console.error(output.trim());
  process.exit(1);
}
if (pass < 3) {
  console.error(`APFS evidence: NOT EXECUTED — expected at least the 3 committed evidence tests (symlink, case variant, Unicode), observed ${pass} passing`);
  process.exit(3);
}
console.log(`APFS evidence: PASS — ${pass} evidence tests executed and passed (case variant, Unicode NFC/NFD, symlink alias; one filesystem object ⇒ at most one registration) on ${platform}`);
process.exit(0);
