/**
 * PS-2 focused tests: host seam — layout resolution, home discovery,
 * canonicalization, and host-lane mapping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizePath, hostEnvironmentFromProcess, hostLane, resolveLayout } from '../../src/host/environment.js';

test('host: layout matches the approved portable layout (both platforms identical)', () => {
  const home = '/home/operator';
  const layout = resolveLayout(home);
  assert.equal(layout.shareDir, '/home/operator/.local/share/pi-shuttle');
  assert.equal(layout.stateDir, '/home/operator/.local/state/pi-shuttle');
  assert.equal(layout.configDir, '/home/operator/.config/pi-shuttle');
  assert.equal(layout.binDir, '/home/operator/.local/bin');
  assert.equal(layout.storesDir, '/home/operator/.local/share/pi-shuttle/stores');
  assert.equal(layout.runtimeConfigPath, '/home/operator/.config/pi-shuttle/runtime.json');
  assert.equal(layout.installReceiptPath, '/home/operator/.local/state/pi-shuttle/install.json');
  // Same layout shape for a macOS-style home (no ~/Library specialization).
  const mac = resolveLayout('/Users/operator');
  assert.equal(mac.shareDir, '/Users/operator/.local/share/pi-shuttle');
  assert.equal(mac.configDir, '/Users/operator/.config/pi-shuttle');
});

test('host: home discovery comes from the environment seam only', () => {
  const original = process.env.HOME;
  try {
    process.env.HOME = '/tmp/fake-home';
    const env = hostEnvironmentFromProcess();
    assert.equal(env.ok, true);
    if (env.ok) assert.equal(env.environment.home, '/tmp/fake-home');
    process.env.HOME = '';
    const missing = hostEnvironmentFromProcess();
    assert.equal(missing.ok, false, 'empty HOME must fail closed');
  } finally {
    if (original === undefined) delete process.env.HOME;
    else process.env.HOME = original;
  }
});

test('host: canonicalizePath resolves symlinks and fails closed on absence', () => {
  const env = mkdtempSync(join(tmpdir(), 'ps2-host-'));
  try {
    const canonical = canonicalizePath(env);
    assert.equal(canonical, realpathSync(env));
    assert.equal(canonicalizePath(join(env, 'does-not-exist')), null);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('host: host-lane mapping is inherited and manifest-bound', () => {
  assert.equal(hostLane('linux', 'x64'), 'linux-x86_64-posix-utf8-node22');
  assert.equal(hostLane('darwin', 'arm64'), 'darwin-arm64-posix-utf8-node22');
  assert.equal(hostLane('darwin', 'x64'), 'darwin-x86_64-posix-utf8-node22'); // PS-6I Intel lane
  assert.equal(hostLane('win32', 'x64'), 'win32-x64'); // unclaimed lane
});
