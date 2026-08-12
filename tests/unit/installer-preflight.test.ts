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
import { applyPiPolicy, checkNodeLane, checkNotRoot, checkPlatformLane, classifyPiVersion, ensureWritableLayout } from '../../src/installer/preflight.js';
import { resolveLayout } from '../../src/host/environment.js';

const LINUX = { home: '/tmp/x', platform: 'linux', arch: 'x64' };

test('preflight: platform lane classification is Linux x64 only', () => {
  assert.equal(checkPlatformLane(LINUX).ok, true);
  const mac = checkPlatformLane({ home: '/tmp/x', platform: 'darwin', arch: 'arm64' });
  assert.equal(mac.ok, false, 'macOS arm64 must not be claimed in PS-3');
  if (!mac.ok) assert.ok(mac.message.includes('gated pending PS-6'), mac.message);
  assert.equal(checkPlatformLane({ home: '/tmp/x', platform: 'win32', arch: 'x64' }).ok, false);
  assert.equal(checkPlatformLane({ home: '/tmp/x', platform: 'darwin', arch: 'x64' }).ok, false, 'macOS Intel is never claimed');
});

test('preflight: node lane is the exact validated version', () => {
  const verdict = checkNodeLane();
  assert.equal(verdict.ok, true, 'the CI node lane is the validated 22.23.2 lane');
});

test('preflight: pi version classification against the 0.83.0 baseline', () => {
  assert.deepEqual(classifyPiVersion('0.83.0'), { lane: 'supported', version: '0.83.0' });
  assert.deepEqual(classifyPiVersion('0.84.1'), { lane: 'not-supported-lane', version: '0.84.1' });
  assert.deepEqual(classifyPiVersion(' 0.83.0 '), { lane: 'supported', version: '0.83.0' }, 'whitespace is tolerated');
  assert.deepEqual(classifyPiVersion(null), { lane: 'missing' });
  assert.deepEqual(classifyPiVersion('garbage'), { lane: 'not-supported-lane', version: 'garbage' });
});

test('preflight: both hypothetical non-baseline Pi policies are implemented at the pure layer', () => {
  const notBaseline = classifyPiVersion('0.84.1');
  const refused = applyPiPolicy(notBaseline, 'refuse-non-baseline');
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.code, 'ERR-PS3-PI-NOT-SUPPORTED-LANE');
    assert.ok(refused.message.includes('0.83.0 is the verified baseline'), 'contract-mandated explanation');
  }
  const allowed = applyPiPolicy(notBaseline, 'allow-unverified');
  assert.equal(allowed.ok, true, 'the alternative policy exists for the pending human decision');
  assert.equal(applyPiPolicy(classifyPiVersion('0.83.0'), 'refuse-non-baseline').ok, true);
  assert.equal(applyPiPolicy(classifyPiVersion(null), 'refuse-non-baseline').ok, false);
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
