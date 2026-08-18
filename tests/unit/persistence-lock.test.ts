import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireInstallLock, acquireLock, inspectInstallLock, releaseInstallLock, releaseLock } from '../../src/persistence/lock.js';

function fixture(): { readonly dir: string; readonly lock: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-lock-'));
  return { dir, lock: join(dir, 'install.lock') };
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return Number(child.stdout);
}

function boundedRefusal(lock: string): ReturnType<typeof acquireInstallLock> {
  const started = Date.now();
  const result = acquireInstallLock(lock);
  assert.equal(result.ok, false);
  assert.ok(Date.now() - started < 1_000, 'special/malformed lock refusal must be bounded');
  return result;
}

test('install lock: dead PID is removed and O_EXCL acquisition proceeds', () => {
  const { dir, lock } = fixture();
  try {
    writeFileSync(lock, `${deadPid()}\n`, { mode: 0o600 });
    const acquired = acquireInstallLock(lock);
    assert.equal(acquired.ok, true, acquired.ok ? '' : acquired.message);
    if (!acquired.ok) return;
    assert.equal(acquired.staleRemoved, true);
    assert.equal(readFileSync(lock, 'utf8'), `${process.pid}\n`);
    releaseInstallLock(acquired.fd, lock);
    assert.equal(existsSync(lock), false, 'normal release removes this invocation lock');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install lock: live PID reports BUSY and is preserved', () => {
  const { dir, lock } = fixture();
  try {
    writeFileSync(lock, `${process.pid}\n`, { mode: 0o600 });
    const result = acquireInstallLock(lock);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'ERR-PS2-CONFIG-BUSY');
      assert.match(result.message, /installer is running/);
    }
    assert.equal(readFileSync(lock, 'utf8'), `${process.pid}\n`);
    const observed = inspectInstallLock(lock);
    assert.equal(observed.ok && observed.active, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install lock: malformed payloads refuse without mutation', () => {
  for (const payload of ['', '0\n', '+1\n', '-1\n', '1', '1\n2\n', 'x'.repeat(65)]) {
    const { dir, lock } = fixture();
    try {
      writeFileSync(lock, payload, { mode: 0o600 });
      const result = boundedRefusal(lock);
      if (!result.ok) assert.equal(result.code, 'ERR-PS2-CONFIG-LOCK');
      assert.equal(readFileSync(lock, 'utf8'), payload);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('install lock: symlink, FIFO, and directory are controlled refusals', () => {
  for (const kind of ['symlink', 'fifo', 'directory'] as const) {
    const { dir, lock } = fixture();
    try {
      if (kind === 'symlink') {
        const target = join(dir, 'target');
        writeFileSync(target, `${deadPid()}\n`);
        symlinkSync(target, lock);
      } else if (kind === 'fifo') {
        assert.equal(spawnSync('mkfifo', [lock]).status, 0);
      } else {
        mkdirSync(lock);
      }
      const result = boundedRefusal(lock);
      if (!result.ok) assert.equal(result.code, 'ERR-PS2-CONFIG-LOCK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('ordinary document lock keeps its bounded no-reclaim behavior', () => {
  const { dir, lock } = fixture();
  try {
    const first = acquireLock(lock);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = acquireLock(lock);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, 'ERR-PS2-CONFIG-BUSY');
    releaseLock(first.fd, lock);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
