/**
 * PS-2 focused tests: compatibility representation truthfulness — exact
 * pins, gated lanes, deferred digests, no unverified claims.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPATIBILITY_MANIFEST,
  CONFIGURATION_VERSION,
  DARWIN_ARM64_HOST_LANE,
  GATEWAY_PS1_BASELINE_COMMIT,
  LINUX_HOST_LANE,
  PI_COMPATIBILITY_BASELINE,
  PI_GUARD_COMMIT,
  PI_GUARD_VERSION,
  PI_SHUTTLE_VERSION,
} from '../../src/compat/manifest.js';

const REPO = join(import.meta.dirname, '..', '..', '..');

test('manifest: exact approved pins are preserved', () => {
  assert.equal(COMPATIBILITY_MANIFEST.piShuttle, PI_SHUTTLE_VERSION);
  assert.equal(COMPATIBILITY_MANIFEST.piShuttle, '0.1.0');
  assert.equal(COMPATIBILITY_MANIFEST.gateway, '0.1.0');
  // Gateway committed baseline: the exact source closure (PS-6R
  // baseline; mfx-labs/project-gateway).
  assert.equal(COMPATIBILITY_MANIFEST.gatewayCommit, GATEWAY_PS1_BASELINE_COMMIT);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayCommit, '28f1d3a12382bc145376c8d8a2d87d89495785ec');
  // pi-guard verified release.
  assert.equal(COMPATIBILITY_MANIFEST.piGuard, PI_GUARD_VERSION);
  assert.equal(COMPATIBILITY_MANIFEST.piGuard, '0.1.2');
  assert.equal(COMPATIBILITY_MANIFEST.piGuardCommit, PI_GUARD_COMMIT);
  assert.equal(COMPATIBILITY_MANIFEST.piGuardCommit, '7a7580cc4cbd7926797564c72269394fc29a860a');
  // Pi compatibility baseline.
  assert.equal(COMPATIBILITY_MANIFEST.piCompatibilityBaseline, PI_COMPATIBILITY_BASELINE);
  assert.equal(COMPATIBILITY_MANIFEST.piCompatibilityBaseline, '0.83.0');
  assert.equal(COMPATIBILITY_MANIFEST.node, '22.23.2');
  assert.equal(COMPATIBILITY_MANIFEST.git, '2.45.4');
  assert.equal(COMPATIBILITY_MANIFEST.configurationVersion, CONFIGURATION_VERSION);
  assert.equal(COMPATIBILITY_MANIFEST.configFormatVersion, 1);
  assert.deepEqual(COMPATIBILITY_MANIFEST.gatewayDependencies, {
    '@modelcontextprotocol/server': '2.0.0',
    'ajv': '8.20.0',
    'zod': '4.4.3',
  });
});

test('manifest: lane claims are evidence-bound — darwin arm64 supported, darwin x64 never', () => {
  assert.deepEqual([...COMPATIBILITY_MANIFEST.supportedLanes], [LINUX_HOST_LANE, DARWIN_ARM64_HOST_LANE]);
  assert.deepEqual([...COMPATIBILITY_MANIFEST.gatedLanes], []);
  assert.equal(COMPATIBILITY_MANIFEST.supportedLanes.includes(DARWIN_ARM64_HOST_LANE), true, 'macOS arm64 is the PS-6 promoted first-class lane');
  assert.equal(COMPATIBILITY_MANIFEST.supportedLanes.includes('darwin-x64'), false, 'macOS Intel is never a claimed lane');
});

test('manifest: artifact digests are truthfully deferred, not invented', () => {
  assert.equal(COMPATIBILITY_MANIFEST.gatewayArtifactSha256, null);
  assert.equal(COMPATIBILITY_MANIFEST.piGuardArtifactSha256, null);
});

test('manifest: no latest, no ranges, no Pi 0.84.x claims anywhere', () => {
  const text = JSON.stringify(COMPATIBILITY_MANIFEST);
  assert.ok(!text.includes('latest'), 'no latest anywhere in the manifest');
  assert.ok(!text.includes('0.84'), 'no Pi 0.84.x claim');
  assert.ok(!text.includes('^') && !text.includes('~'), 'no semver ranges in pins');
  assert.ok(!text.includes('<computed-at-release>'), 'digests must be represented as null, not placeholder strings');
});

test('manifest: the authoritative public Gateway pin is exact and repository-owned', () => {
  // PS-6 public multi-repo lane: the manifest must pin the EXACT public
  // Gateway source commit that prepare-fixtures.sh builds/verifies and the
  // Lane B workflow checks out — one 40-hex full SHA, no branch/tag/floating
  // ref, identical across every authoritative location (product-contract §6:
  // "gatewayCommit pins the exact source closure for the packaged artifact").
  const PUBLIC_GATEWAY_COMMIT = '28f1d3a12382bc145376c8d8a2d87d89495785ec';
  assert.match(PUBLIC_GATEWAY_COMMIT, /^[0-9a-f]{40}$/, 'pin must be a full 40-hex SHA');
  assert.equal(GATEWAY_PS1_BASELINE_COMMIT, PUBLIC_GATEWAY_COMMIT, 'manifest pin == exact public Gateway commit');
  assert.equal(COMPATIBILITY_MANIFEST.gatewayCommit, PUBLIC_GATEWAY_COMMIT, 'manifest exposes the same exact pin');
  const fixturesScript = readFileSync(join(REPO, 'scripts', 'prepare-fixtures.sh'), 'utf8');
  assert.ok(fixturesScript.includes(`GATEWAY_COMMIT="${PUBLIC_GATEWAY_COMMIT}"`), 'prepare-fixtures.sh embeds the same exact public Gateway pin');
  const laneB = readFileSync(join(REPO, '.github', 'workflows', 'lane-b-macos-arm64.yml'), 'utf8');
  assert.ok(laneB.includes(`GATEWAY_COMMIT: ${PUBLIC_GATEWAY_COMMIT}`), 'Lane B workflow owns the same exact public Gateway pin');
  assert.ok(laneB.includes(`ref: ${PUBLIC_GATEWAY_COMMIT}`), 'Lane B Gateway checkout ref is the exact public commit');
  assert.ok(laneB.includes(`PI_GUARD_COMMIT: ${PI_GUARD_COMMIT}`), 'Lane B workflow owns the exact pi-guard pin');
  assert.ok(laneB.includes(`ref: ${PI_GUARD_COMMIT}`), 'Lane B pi-guard checkout ref is the exact commit');
});
