/**
 * PS-3 focused tests: preflight classification — lane, node, pi version
 * (both hypothetical non-baseline policies at the pure layer), tar, and
 * layout writability.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPiPolicy, checkNodeLane, checkNotRoot, checkPlatformLane, classifyNodeRuntime, classifyPiVersion, ensureWritableLayout } from '../../src/installer/preflight.js';
import { resolveLayout } from '../../src/host/environment.js';
import { COMPATIBILITY_MANIFEST, DARWIN_X86_64_HOST_LANE, LINUX_HOST_LANE, DARWIN_ARM64_HOST_LANE } from '../../src/compat/manifest.js';

const LINUX = { home: '/tmp/x', platform: 'linux', arch: 'x64' };

test('preflight: platform lane classification — v0.1.0 supports Linux x64 only; darwin arm64/x64 and windows refused', () => {
  assert.equal(checkPlatformLane(LINUX).ok, true, 'Linux x86_64 is the v0.1.0 supported lane');
  const mac = checkPlatformLane({ home: '/tmp/x', platform: 'darwin', arch: 'arm64' });
  assert.equal(mac.ok, false, 'macOS arm64 is NOT supported in v0.1.0 (deferred)');
  if (!mac.ok) assert.match(mac.message, /macOS .* not supported in v0\.1\.0/, 'the refusal must say macOS is not supported in v0.1.0');
  const intel = checkPlatformLane({ home: '/tmp/x', platform: 'darwin', arch: 'x64' });
  assert.equal(intel.ok, false, 'macOS Intel is NOT supported in v0.1.0 (deferred)');
  if (!intel.ok) assert.match(intel.message, /macOS .* not supported in v0\.1\.0/, 'the refusal must say macOS is not supported in v0.1.0');
  assert.equal(checkPlatformLane({ home: '/tmp/x', platform: 'win32', arch: 'x64' }).ok, false);
});

test('preflight: manifest claims ONLY the Linux lane; darwin lanes are gated (v0.1.0 Linux-only disposition)', () => {
  assert.deepEqual([...COMPATIBILITY_MANIFEST.supportedLanes], [LINUX_HOST_LANE]);
  assert.equal(COMPATIBILITY_MANIFEST.supportedLanes.includes(DARWIN_ARM64_HOST_LANE), false);
  assert.equal(COMPATIBILITY_MANIFEST.supportedLanes.includes(DARWIN_X86_64_HOST_LANE), false);
  // Retained constants + gated lanes (historical/component-level meaning):
  assert.deepEqual([...COMPATIBILITY_MANIFEST.gatedLanes], [DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE]);
  assert.equal(LINUX_HOST_LANE, 'linux-x86_64-posix-utf8-node22');
  assert.equal(DARWIN_ARM64_HOST_LANE, 'darwin-arm64-posix-utf8-node22');
  assert.equal(DARWIN_X86_64_HOST_LANE, 'darwin-x86_64-posix-utf8-node22');
});

test('preflight: node lane is the exact validated version', () => {
  const verdict = checkNodeLane();
  assert.equal(verdict.ok, true, 'the CI node lane (22.23.2) is at/above the minimum 22.19.0');
});

test('preflight: node runtime classification boundaries (PS-6R)', () => {
  // 22.18.x → reject (below minimum).
  assert.equal(classifyNodeRuntime('22.18.9'), 'below-minimum');
  assert.equal(classifyNodeRuntime('22.18.0'), 'below-minimum');
  // 22.19.0 → accept (exact minimum).
  assert.equal(classifyNodeRuntime('22.19.0'), 'supported');
  // 22.23.2 → accept / known-good CI baseline.
  assert.equal(classifyNodeRuntime('22.23.2'), 'supported');
  // newer 22.x → accept.
  assert.equal(classifyNodeRuntime('22.99.0'), 'supported');
  // newer major → accept when semver-valid (all other required facts
  // still apply: platform lane, native arm64 on darwin, presence).
  assert.equal(classifyNodeRuntime('24.0.0'), 'supported');
  // malformed → reject (fail closed).
  assert.equal(classifyNodeRuntime('garbage'), 'malformed');
  assert.equal(classifyNodeRuntime('v22'), 'malformed');
  assert.equal(classifyNodeRuntime('22.19'), 'malformed');
  assert.equal(classifyNodeRuntime('22.19.0-rc.1'), 'malformed');
  assert.equal(classifyNodeRuntime(null), 'malformed');
});

test('preflight: pi version classification against the 0.83.0 baseline (PS-6R)', () => {
  assert.deepEqual(classifyPiVersion('0.83.0'), { lane: 'supported', version: '0.83.0' });
  assert.deepEqual(classifyPiVersion('0.84.1'), { lane: 'candidate', version: '0.84.1' }, 'above the known-good baseline → candidate (needs the compatibility probe)');
  assert.deepEqual(classifyPiVersion('0.83.1'), { lane: 'candidate', version: '0.83.1' });
  assert.deepEqual(classifyPiVersion('1.0.0'), { lane: 'candidate', version: '1.0.0' });
  assert.deepEqual(classifyPiVersion('0.82.9'), { lane: 'not-supported-lane', version: '0.82.9' }, 'below the minimum 0.83.0 → unsupported');
  assert.deepEqual(classifyPiVersion(' 0.83.0 '), { lane: 'supported', version: '0.83.0' }, 'whitespace is tolerated');
  assert.deepEqual(classifyPiVersion(null), { lane: 'missing' });
  assert.deepEqual(classifyPiVersion('garbage'), { lane: 'malformed', version: 'garbage' }, 'unparseable → malformed (fail closed)');
});

test('preflight: pi policies — probe-based acceptance is the production policy; refuse-non-baseline remains the conservative alternative', () => {
  // Known-good baseline: accepted under every policy.
  assert.equal(applyPiPolicy(classifyPiVersion('0.83.0'), 'probe-candidates').ok, true);
  assert.equal(applyPiPolicy(classifyPiVersion('0.83.0'), 'refuse-non-baseline').ok, true);
  // Candidate: accepted by the production policy (probe runs later in the
  // install flow and must PASS); refused by the conservative policy.
  const candidate = classifyPiVersion('0.84.1');
  assert.equal(candidate.lane, 'candidate');
  assert.equal(applyPiPolicy(candidate, 'probe-candidates').ok, true, 'candidate proceeds to the required compatibility probe');
  const refused = applyPiPolicy(candidate, 'refuse-non-baseline');
  assert.equal(refused.ok, false);
  // Below minimum and malformed: refused under every policy.
  assert.equal(applyPiPolicy(classifyPiVersion('0.82.9'), 'probe-candidates').ok, false);
  assert.equal(applyPiPolicy(classifyPiVersion('garbage'), 'probe-candidates').ok, false);
  // Missing: refused when pi-guard is selected.
  assert.equal(applyPiPolicy(classifyPiVersion(null), 'probe-candidates').ok, false);
});

test('preflight: root/sudo is refused (SIR-PS3-007); non-root and uid-less hosts pass', () => {
  const refused = checkNotRoot(0);
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, 'ERR-PS3-ROOT-REFUSED');
    assert.ok(refused.message.includes('root privileges'), refused.message);
  }
  assert.equal(checkNotRoot(1000).ok, true);
  assert.equal(checkNotRoot(null).ok, true, 'platforms without getuid are gated by the platform lane');
});

test('preflight: layout writability fails closed under an unwritable parent', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps3-pref-'));
  try {
    const blocker = join(env, 'blocker');
    writeFileSync(blocker, 'file', { mode: 0o600 });
    const layout = resolveLayout(env);
    const verdict = ensureWritableLayout({ ...layout, shareDir: join(blocker, 'share') });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.equal(verdict.code, 'ERR-PS3-LAYOUT-UNWRITABLE');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('preflight: layout writability creates the layout dirs with 0700', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps3-pref-'));
  chmodSync(env, 0o700);
  try {
    const layout = resolveLayout(env);
    const verdict = ensureWritableLayout(layout);
    assert.equal(verdict.ok, true);
    for (const dir of [layout.shareDir, layout.stateDir, layout.configDir, layout.binDir, layout.packagesDir]) {
      assert.equal(statSync(dir).isDirectory(), true, dir);
      assert.equal(statSync(dir).mode & 0o777, 0o700, `mode for ${dir}`);
    }
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});
