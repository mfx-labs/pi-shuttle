/**
 * C3B2 — Lane C CI wiring: focused workflow-contract regressions.
 *
 * The B preparation surface (prepare-fixtures.sh --lane) and the C3B1
 * real-stack/handshake surface (ci-lane-b-real-stack.sh GATEWAY_LANE →
 * mcp-handshake-probe.mjs) are already lane-aware. These tests prove the
 * three lane workflows consume them correctly:
 *
 *   - Lane A (Linux) carries no Gateway wiring at all — historical
 *     self-contained regression lane, untouched;
 *   - Lane B (arm64) stays on the historical mfx-labs/project-gateway
 *     pin with NO lane propagation (the macOS fork is never selected);
 *   - Lane C (Intel x64) checks out ONLY mfx-labs/project-gateway-macos
 *     at the pinned PGM-DIST-1 provenance-complete Git-tree candidate
 *     commit, passes its lane EXPLICITLY to
 *     the fixture builder (--lane) and to the real-stack/handshake
 *     surface (GATEWAY_LANE), and verifies the checked-out fork HEAD
 *     against the exact pin before any use.
 *
 * File-static and network-free: no component checkout is performed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');

const HISTORICAL_COMMIT = '55f764290a4567a20557f1db19d2a6fb97572a97';
const INTEL_COMMIT = 'a90284b06420effb1ec1eeef14e7ed82e02c64e9';
const INTEL_LANE = 'darwin-x86_64-posix-utf8-node22';

function laneText(name: string): string {
  return readFileSync(join(WORKFLOWS, name), 'utf8');
}

const laneA = (): string => laneText('lane-a-linux-regression.yml');
const laneB = (): string => laneText('lane-b-macos-arm64.yml');
const laneC = (): string => laneText('lane-c-macos-intel.yml');

test('C3B2 lane A: Linux regression carries no Gateway fixture/real-stack wiring (historical, untouched)', () => {
  const text = laneA();
  assert.ok(!text.includes('project-gateway'), 'lane A must never reference any Gateway repository');
  assert.ok(!text.includes('prepare-fixtures'), 'lane A must not prepare Gateway fixtures');
  assert.ok(!text.includes('ci-lane-b-real-stack'), 'lane A must not run the real-stack orchestrator');
  assert.ok(!text.includes('GATEWAY_LANE'), 'lane A must not propagate a Gateway lane');
  assert.ok(!text.includes('--lane'), 'lane A must not pass a fixture lane');
  assert.ok(!text.includes(INTEL_COMMIT), 'lane A must not reference the fork commit');
  assert.ok(!text.includes(HISTORICAL_COMMIT), 'lane A must not reference the historical commit');
});

test('C3B2 lane B: darwin-arm64 remains on the historical Gateway pin — never the fork', () => {
  const text = laneB();
  assert.ok(text.includes(`GATEWAY_COMMIT: ${HISTORICAL_COMMIT}`), 'lane B workflow pin stays the historical commit');
  assert.ok(text.includes('repository: mfx-labs/project-gateway\n'), 'lane B checks out the historical Gateway repository');
  assert.ok(text.includes(`ref: ${HISTORICAL_COMMIT}`), 'lane B checkout ref stays the historical commit');
  assert.ok(!text.includes(INTEL_COMMIT), 'lane B must never reference the fork commit');
  assert.ok(!text.includes('project-gateway-macos'), 'lane B must never reference the macOS fork');
  assert.ok(!text.includes('--lane'), 'lane B keeps the historical default (no --lane propagation)');
  assert.ok(!text.includes('GATEWAY_LANE'), 'lane B keeps the historical default (no GATEWAY_LANE propagation)');
  assert.ok(!text.includes(INTEL_LANE), 'lane B must never carry the Intel lane literal');
});

test('C3B2 lane C: Intel materialization comes from the pinned provenance-complete fork candidate commit', () => {
  const text = laneC();
  assert.ok(text.includes(`GATEWAY_COMMIT: ${INTEL_COMMIT}`), 'lane C workflow pin is the pinned provenance-complete fork candidate');
  assert.ok(text.includes('repository: mfx-labs/project-gateway-macos\n'), 'lane C checks out only the macOS Intel fork');
  assert.ok(text.includes(`ref: ${INTEL_COMMIT}`), 'lane C checkout ref is the exact pinned fork candidate commit');
  assert.ok(!text.includes(HISTORICAL_COMMIT), 'lane C must never reference the historical commit');
  assert.ok(!text.includes('repository: mfx-labs/project-gateway\n'), 'lane C must never check out the historical Gateway repository');
});

test('C3B2 lane C: checked-out fork HEAD is verified against the exact pin before any use', () => {
  const text = laneC();
  assert.ok(text.includes('git -C "${{ github.workspace }}/gateway" rev-parse HEAD'), 'lane C asserts the checked-out Gateway HEAD');
  assert.ok(text.includes('test "$GW_HEAD" = "$GATEWAY_COMMIT"'), 'lane C compares the Gateway HEAD to the exact pin (fail closed)');
  assert.ok(text.includes('test "$PG_HEAD" = "$PI_GUARD_COMMIT"'), 'lane C keeps the pi-guard HEAD assertion');
  const headAssert = text.indexOf('git -C "${{ github.workspace }}/gateway" rev-parse HEAD');
  const fixtureBuild = text.indexOf('bash scripts/prepare-fixtures.sh');
  assert.ok(headAssert !== -1 && fixtureBuild !== -1 && headAssert < fixtureBuild, 'the HEAD assertion must run BEFORE the fixture build');
});

test('C3B2 lane C: fixture preparation passes the Intel lane EXPLICITLY to the B surface', () => {
  const text = laneC();
  assert.ok(text.includes('--out "$RUNNER_TEMP/fixtures" \\\n            --lane darwin-x86_64-posix-utf8-node22'), 'the --lane argument must be attached to the fixture-builder invocation (line continuation)');
  assert.ok(text.includes('bash scripts/prepare-fixtures.sh'), 'fixtures are built through the committed helper');
  assert.ok(text.includes('test -f "$RUNNER_TEMP/fixtures/project-gateway-macos-core-0.1.0.tgz"'), 'lane C expects the Intel artifact filename, not the historical one');
  assert.ok(!text.includes('project-gateway-artifact-core-0.1.0.tgz'), 'lane C must never expect the historical artifact filename');
});

test('C3B2 lane C: real-stack/handshake receives the Intel lane EXPLICITLY — never ambient', () => {
  const text = laneC();
  assert.ok(text.includes(`GATEWAY_LANE: ${INTEL_LANE}`), 'lane C real-stack env carries the explicit Intel lane literal');
  assert.ok(!text.includes('GATEWAY_LANE: "${{'), 'the lane is a repository-owned literal, never an input/expression');
  assert.ok(text.includes('bash scripts/ci-lane-b-real-stack.sh'), 'real-stack runs through the C3B1 orchestrator');
  assert.ok(text.includes('GATEWAY_COMMIT: "${{ env.GATEWAY_COMMIT }}"'), 'the fork pin is propagated to the real-stack surface');
  assert.ok(!text.includes('tools/list'), 'no weaker inline tool check duplicated in workflow YAML (C3B1 exact-nine probe is the surface)');
});

test('C3B2 lane C: no historical Gateway package/commit hardcoding remains for Intel', () => {
  const text = laneC();
  assert.ok(!text.includes('@project-gateway/artifact-core'), 'historical package name must not appear in lane C');
  assert.ok(!text.includes('project-gateway-mcp'), 'historical bin name must not appear in lane C');
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#') || line.trimStart().startsWith('repository:')) continue;
    assert.ok(!line.includes('@project-gateway/'), `no historical Gateway package identity in lane C content: ${line}`);
  }
});

test('C3B2 lane wiring: no workflow promotes arm64 to the fork and no workflow writes artifact SHA authority', () => {
  const arm64 = laneB();
  assert.ok(!arm64.includes('darwin-x86_64-posix-utf8-node22'), 'arm64 workflow must not carry the Intel lane');
  assert.ok(!arm64.includes('project-gateway-macos'), 'arm64 workflow must not reference the fork');
  for (const name of ['lane-a-linux-regression.yml', 'lane-b-macos-arm64.yml', 'lane-c-macos-intel.yml']) {
    const text = laneText(name);
    assert.ok(!text.includes('artifactSha256'), `${name}: workflows never write artifact SHA authority (B digest is run evidence only)`);
  }
});
