/**
 * PS-2 focused tests: compatibility representation truthfulness — exact
 * pins, gated lanes, deferred digests, no unverified claims.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('manifest: exact approved pins are preserved', () => {
  assert.equal(COMPATIBILITY_MANIFEST.piShuttle, PI_SHUTTLE_VERSION);
  assert.equal(COMPATIBILITY_MANIFEST.piShuttle, '0.1.0');
  assert.equal(COMPATIBILITY_MANIFEST.gateway, '0.1.0');
  // Gateway committed baseline (PS-6 coordinated pin — see L2 of the
  // focused correction gate).
  assert.equal(COMPATIBILITY_MANIFEST.gatewayCommit, GATEWAY_PS1_BASELINE_COMMIT);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayCommit, '1a454b61241ca23a638c3083e2e7d28e28f86b18');
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
