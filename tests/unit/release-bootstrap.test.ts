/**
 * FRESH-INSTALL Slice — release-lane installer entry tests.
 *
 * The release-lane entry (dist/installer/release/bootstrap.js) is the same
 * manifest-native production flow as the local lane: the previous-
 * generation envelope handoff is not part of this generation and is never
 * consulted. These tests pin the closed argument grammar, outcome
 * formatting, exit-code mapping, and the no-caller-authority refusal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/installer/release/bootstrap.js';
import type { FreshInstallOutcome } from '../../src/manifest-native/install.js';
import { INSTALLER_EXIT, INSTALLER_USAGE, formatFreshInstallOutcome, exitCodeFor } from '../../src/installer/main.js';

function envDir(): string {
  return mkdtempSync(join(tmpdir(), 'pi-shuttle-release-entry-'));
}

test('release entry: --help prints the closed usage without any install', async () => {
  const dir = envDir();
  try {
    const code = await main(['--help'], { installRunner: async () => { throw new Error('runner must not be invoked'); } });
    assert.equal(code, INSTALLER_EXIT.COMPLETE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('release entry: unrecognized arguments are refused before any install (no caller-selected authority)', async () => {
  const dir = envDir();
  try {
    const code = await main(['--batch', '--gateway', 'yes'], {
      installRunner: async () => { throw new Error('runner must not be invoked'); },
    });
    assert.equal(code, INSTALLER_EXIT.FAILED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('release entry: the previous-generation envelope handoff environment is never consulted', async () => {
  const dir = envDir();
  try {
    // Stale previous-generation handoff variables in the environment must
    // not change behavior and must not be read (a deliberately broken
    // envelope path proves the point).
    const saved = { ...process.env };
    process.env.PI_SHUTTLE_RELEASE_ENVELOPE = join(dir, 'definitely-missing-envelope.json');
    process.env.PI_SHUTTLE_PI_SHUTTLE_TGZ = join(dir, 'definitely-missing.tgz');
    try {
      let runnerCalls = 0;
      const outcome: FreshInstallOutcome = { kind: 'INSTALLED', releaseId: 'gateway-native-release-aaa', packageRoot: join(dir, 'pkg'), binPath: join(dir, 'pkg', 'bin', 'run.js') };
      const code = await main([], { installRunner: async () => { runnerCalls += 1; return outcome; } });
      assert.equal(runnerCalls, 1, 'the manifest-native flow must run regardless of stale handoff variables');
      assert.equal(code, INSTALLER_EXIT.COMPLETE);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('release entry: outcome formatting and exit codes follow the manifest-native taxonomy', async () => {
  const dir = envDir();
  try {
    const run = async (outcome: FreshInstallOutcome): Promise<number> => main([], { installRunner: async () => outcome });
    assert.equal(await run({ kind: 'INSTALLED', releaseId: 'gateway-native-release-aaa', packageRoot: '/x', binPath: '/x/bin/run.js' }), 0);
    assert.equal(await run({ kind: 'ALREADY_INSTALLED', releaseId: 'gateway-native-release-aaa' }), 0);
    assert.equal(await run({ kind: 'ALREADY_INSTALLED_UPDATE_REQUIRED', installedReleaseId: 'gateway-native-release-aaa', selectedReleaseId: 'gateway-native-release-bbb' }), 2);
    assert.equal(await run({ kind: 'UNSUPPORTED', reason: 'lane x is not supported' }), 2);
    assert.equal(await run({ kind: 'REFUSED', code: 'ERR-MN-INSTALL-STATE-MALFORMED', message: 'malformed' }), 2);
    assert.equal(await run({ kind: 'FAILED', stage: 'artifact', code: 'ERR-REL-ACQUIRE-DIGEST-MISMATCH', message: 'digest mismatch' }), 2);
    // Formatting carries the typed reason.
    assert.match(formatFreshInstallOutcome({ kind: 'FAILED', stage: 'artifact', code: 'ERR-REL-ACQUIRE-DIGEST-MISMATCH', message: 'digest mismatch' }), /FAILED at stage "artifact"/);
    assert.match(formatFreshInstallOutcome({ kind: 'ALREADY_INSTALLED_UPDATE_REQUIRED', installedReleaseId: 'a', selectedReleaseId: 'b' }), /update is not supported/);
    assert.match(formatFreshInstallOutcome({ kind: 'INSTALLED', releaseId: 'gateway-native-release-aaa', packageRoot: '/x', binPath: '/x/bin/run.js' }), /INSTALLED/);
    assert.equal(exitCodeFor({ kind: 'INSTALLED', releaseId: 'x', packageRoot: '/x', binPath: '/x/bin' }), 0);
    assert.equal(exitCodeFor({ kind: 'REFUSED', code: 'c', message: 'm' }), 2);
    assert.ok(INSTALLER_USAGE.includes('manifest-native'), 'usage must describe the manifest-native lane');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('release entry: a broken HOME is refused before any install', async () => {
  const dir = envDir();
  try {
    const saved = { ...process.env };
    process.env.HOME = 'relative-home';
    try {
      const code = await main([], { installRunner: async () => { throw new Error('runner must not be invoked'); } });
      assert.equal(code, INSTALLER_EXIT.FAILED);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
