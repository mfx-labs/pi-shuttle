/**
 * PS-6R focused tests: runtime compatibility boundaries, host-lane
 * identity regression, and cross-boundary consistency.
 *
 * The approved policy separates the VALIDATED CI BASELINE (exact
 * 22.23.2 / 2.45.4 / 0.83.0 — evidence, reporting only) from the
 * RUNTIME REQUIREMENT (minimum versions + capability probes). These
 * tests pin the boundary behavior and prove the four operator
 * boundaries (install, project add, doctor, start) consume ONE shared
 * classification — no exact-equality gate may survive anywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyAgainstMinimum, compareVersionTriples, isAtLeast, parseVersionTriple } from '../../src/compat/versions.js';
import { classifyNodeRuntime } from '../../src/installer/preflight.js';
import { hostLane } from '../../src/host/environment.js';
import { GIT_RUNTIME_MINIMUM, NODE_LANE_VERSION, NODE_RUNTIME_MINIMUM, PI_RUNTIME_MINIMUM } from '../../src/compat/manifest.js';

const REPO = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..');

test('versions: strict triple parsing and comparison (fail closed on malformed)', () => {
  assert.deepEqual(parseVersionTriple('22.23.2'), { major: 22, minor: 23, patch: 2 });
  assert.deepEqual(parseVersionTriple(' 2.30.0 '), { major: 2, minor: 30, patch: 0 });
  assert.equal(parseVersionTriple('22'), null);
  assert.equal(parseVersionTriple('22.19'), null);
  assert.equal(parseVersionTriple('22.19.0.1'), null);
  assert.equal(parseVersionTriple('v22.19.0'), null, 'prefixes must be stripped by callers');
  assert.equal(parseVersionTriple('22.19.0-rc.1'), null, 'prerelease suffixes fail closed');
  assert.equal(parseVersionTriple('22.19.0+build'), null, 'build suffixes fail closed');
  assert.equal(parseVersionTriple(''), null);
  assert.equal(parseVersionTriple('garbage'), null);
  assert.equal(compareVersionTriples({ major: 2, minor: 30, patch: 0 }, { major: 2, minor: 29, patch: 9 }), 1);
  assert.equal(compareVersionTriples({ major: 2, minor: 30, patch: 0 }, { major: 2, minor: 30, patch: 0 }), 0);
  assert.equal(compareVersionTriples({ major: 22, minor: 18, patch: 0 }, { major: 22, minor: 19, patch: 0 }), -1);
  assert.equal(classifyAgainstMinimum('2.45.4', '2.30.0'), 'at-or-above');
  assert.equal(classifyAgainstMinimum('2.29.9', '2.30.0'), 'below-minimum');
  assert.equal(classifyAgainstMinimum(null, '2.30.0'), 'malformed');
  assert.equal(isAtLeast('24.0.0', NODE_RUNTIME_MINIMUM), true);
});

test('node runtime boundaries: 22.18.x rejected, 22.19.0+ accepted, malformed rejected (PS-6R)', () => {
  const cases: ReadonlyArray<[string | null, 'supported' | 'below-minimum' | 'malformed']> = [
    ['22.18.9', 'below-minimum'],
    ['22.18.0', 'below-minimum'],
    ['22.0.0', 'below-minimum'],
    ['22.19.0', 'supported'], // exact minimum
    ['22.23.2', 'supported'], // known-good CI baseline
    ['22.99.0', 'supported'], // newer 22.x
    ['23.0.0', 'supported'], // newer major
    ['24.0.0', 'supported'], // newer major, semver-valid
    ['v22.19.0', 'malformed'],
    ['22.19', 'malformed'],
    ['garbage', 'malformed'],
    ['', 'malformed'],
    [null, 'malformed'],
  ];
  for (const [version, expected] of cases) {
    assert.equal(classifyNodeRuntime(version), expected, `node ${version} → ${expected}`);
  }
});

test('git runtime boundaries: 2.29.x rejected, 2.30.0+ accepted, malformed rejected (PS-6R)', () => {
  const cases: ReadonlyArray<[string | null, 'at-or-above' | 'below-minimum' | 'malformed']> = [
    ['2.29.9', 'below-minimum'],
    ['2.20.0', 'below-minimum'],
    ['2.30.0', 'at-or-above'], // exact minimum
    ['2.45.4', 'at-or-above'], // known-good CI baseline
    ['2.50.1', 'at-or-above'], // newer
    ['3.0.0', 'at-or-above'],
    ['2.30', 'malformed'],
    ['git version 2.45.4', 'malformed'], // callers strip the prefix
    ['', 'malformed'],
    [null, 'malformed'],
  ];
  for (const [version, expected] of cases) {
    assert.equal(classifyAgainstMinimum(version, GIT_RUNTIME_MINIMUM), expected, `git ${version} → ${expected}`);
  }
});

test('host lane: identifiers are frozen opaque protocol strings, never derived from the runtime version (PS-6R)', () => {
  // The trusted host-lane strings remain byte-identical (PS-6R §3); they
  // are opaque protocol identifiers participating in configuration/store
  // identity. A newer compatible Node runtime must NOT alter them.
  assert.equal(hostLane('linux', 'x64'), 'linux-x86_64-posix-utf8-node22');
  assert.equal(hostLane('darwin', 'arm64'), 'darwin-arm64-posix-utf8-node22');
  // The mapping is pure: it depends only on platform/arch — never on
  // process.version (there is no runtime-version input anywhere in the
  // mapping; the 'node22' label is frozen protocol text).
  const mappingSource = readFileSync(join(REPO, 'src', 'host', 'environment.ts'), 'utf8');
  assert.ok(mappingSource.includes("'linux-x86_64-posix-utf8-node22'"), 'frozen Linux lane constant');
  assert.ok(mappingSource.includes("'darwin-arm64-posix-utf8-node22'"), 'frozen darwin lane constant');
  assert.ok(!mappingSource.includes('process.version'), 'the lane mapping must not consult the runtime version');
  assert.ok(!mappingSource.includes('NODE_LANE_VERSION'), 'the lane mapping must not consult the manifest node lane');
  assert.ok(!mappingSource.includes('node24') && !mappingSource.includes('node25'), 'no future node lanes are generated');
});

test('cross-boundary consistency: install / project add / start / doctor share ONE node classifier (PS-6R §9)', () => {
  // Every operator boundary must apply the SAME runtime rule, so identical
  // runtime facts can never produce different verdicts across boundaries.
  for (const rel of ['src/installer/install.ts', 'src/lifecycle/projects.ts', 'src/lifecycle/start.ts']) {
    const text = readFileSync(join(REPO, rel), 'utf8');
    assert.ok(text.includes('checkNodeLane()'), `${rel} must gate node through the shared checkNodeLane`);
    assert.ok(!text.includes('=== NODE_LANE_VERSION') && !text.includes("=== NODE_LANE_VERSION"), `${rel} must not re-implement exact-version gating`);
  }
  const doctor = readFileSync(join(REPO, 'src', 'command', 'doctor.ts'), 'utf8');
  assert.ok(doctor.includes('classifyNodeRuntime('), 'doctor must use the shared node classifier');
  // No exact-equality node/git gates may remain anywhere in src: the
  // baseline constants appear only in reporting text (preflight/doctor
  // messages), never in comparisons.
  for (const rel of ['src/installer/preflight.ts', 'src/command/doctor.ts']) {
    const text = readFileSync(join(REPO, rel), 'utf8');
    assert.ok(!text.includes(`=== NODE_LANE_VERSION`), `${rel}: no node equality gate`);
    assert.ok(!text.includes(`=== GIT_LANE_VERSION`), `${rel}: no git equality gate`);
  }
  // The baseline constants remain declared for evidence/reporting.
  assert.equal(NODE_LANE_VERSION, '22.23.2');
  assert.equal(NODE_RUNTIME_MINIMUM, '22.19.0');
  assert.equal(GIT_RUNTIME_MINIMUM, '2.30.0');
  assert.equal(PI_RUNTIME_MINIMUM, '0.83.0');
});
