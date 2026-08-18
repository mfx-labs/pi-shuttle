/**
 * O_EXCL persistence locks. The installer uses one ordinary install.lock
 * containing its PID and reclaims it only when the OS definitively reports
 * that PID absent. Other document locks retain their bounded no-reclaim rule.
 */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync,
} from 'node:fs';

export type LockResult = { readonly ok: true; readonly fd: number } | { readonly ok: false; readonly code: string; readonly message: string };
export type InstallLockResult = { readonly ok: true; readonly fd: number; readonly staleRemoved: boolean } | { readonly ok: false; readonly code: string; readonly message: string };
export type InstallLockObservation =
  | { readonly ok: true; readonly active: boolean; readonly stale: boolean; readonly detail: string }
  | { readonly ok: false; readonly detail: string };

const LOCK_RETRIES = 20;
const LOCK_RETRY_DELAY_MS = 25;
const MAX_LOCK_BYTES = 64;
const MAX_PID = 2_147_483_647;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

type LockRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'pid'; readonly pid: number }
  | { readonly kind: 'unsafe'; readonly detail: string };

/** No symlinks, no blocking special files, and no unbounded payloads. */
function readInstallLock(lockPath: string): LockRead {
  let fd: number | undefined;
  try {
    fd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'unsafe', detail: `${lockPath} could not be safely opened (${code ?? 'unknown error'})` };
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { kind: 'unsafe', detail: `${lockPath} is not a regular lock file` };
    if (stat.size > MAX_LOCK_BYTES) return { kind: 'unsafe', detail: `${lockPath} exceeds the ${MAX_LOCK_BYTES}-byte lock payload limit` };
    const bytes = Buffer.alloc(MAX_LOCK_BYTES + 1);
    let total = 0;
    while (total < bytes.length) {
      const count = readSync(fd, bytes, total, bytes.length - total, null);
      if (count === 0) break;
      total += count;
    }
    if (total > MAX_LOCK_BYTES) return { kind: 'unsafe', detail: `${lockPath} exceeds the ${MAX_LOCK_BYTES}-byte lock payload limit` };
    const match = bytes.subarray(0, total).toString('utf8').match(/^([1-9][0-9]*)\n$/);
    const pid = match === null ? NaN : Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid > MAX_PID) return { kind: 'unsafe', detail: `${lockPath} has malformed PID content` };
    return { kind: 'pid', pid };
  } catch (err) {
    return { kind: 'unsafe', detail: `${lockPath} could not be safely inspected (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  } finally {
    try { closeSync(fd); } catch { /* inspection already has a result */ }
  }
}

function processState(pid: number): 'live' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'live';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown';
  }
}

/**
 * Acquire install.lock. A dead PID is a recognized interrupted-attempt
 * leftover: remove it, retry O_EXCL, and report that evidence to the caller.
 */
export function acquireInstallLock(lockPath: string): InstallLockResult {
  let staleRemoved = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try {
        const payload = `${process.pid}\n`;
        if (writeSync(fd, payload) !== Buffer.byteLength(payload)) throw new Error('short PID write');
        return { ok: true, fd, staleRemoved };
      } catch (err) {
        try { closeSync(fd); } catch { /* best effort */ }
        try { unlinkSync(lockPath); } catch { /* best effort */ }
        return { ok: false, code: 'ERR-PS2-CONFIG-LOCK', message: `install lock could not be initialized for ${lockPath} (${(err as Error).message || 'write error'})` };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, code: 'ERR-PS2-CONFIG-LOCK', message: `install lock could not be acquired for ${lockPath} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
      }
    }

    const observed = readInstallLock(lockPath);
    if (observed.kind === 'absent') continue;
    if (observed.kind === 'unsafe') return { ok: false, code: 'ERR-PS2-CONFIG-LOCK', message: `install lock was refused: ${observed.detail}` };
    const state = processState(observed.pid);
    if (state === 'live') {
      return { ok: false, code: 'ERR-PS2-CONFIG-BUSY', message: `another pi-shuttle installer is running (PID ${observed.pid}; lock: ${lockPath})` };
    }
    if (state === 'unknown') {
      return { ok: false, code: 'ERR-PS2-CONFIG-LOCK', message: `install lock PID ${observed.pid} could not be inspected definitively; refusing to remove ${lockPath}` };
    }
    try {
      unlinkSync(lockPath);
      staleRemoved = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, code: 'ERR-PS2-CONFIG-LOCK', message: `stale install lock could not be removed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${lockPath}` };
      }
    }
  }
  return { ok: false, code: 'ERR-PS2-CONFIG-BUSY', message: `install lock changed repeatedly during acquisition: ${lockPath}` };
}

/** Remove the lock created by this cooperative installer invocation. */
export function releaseInstallLock(fd: number, lockPath: string): void {
  try { unlinkSync(lockPath); } catch { /* best effort */ }
  try { closeSync(fd); } catch { /* best effort */ }
}

/** Read-only doctor/status view. */
export function inspectInstallLock(lockPath: string): InstallLockObservation {
  const observed = readInstallLock(lockPath);
  if (observed.kind === 'absent') return { ok: true, active: false, stale: false, detail: 'no install lock' };
  if (observed.kind === 'unsafe') return { ok: false, detail: observed.detail };
  const state = processState(observed.pid);
  if (state === 'live') return { ok: true, active: true, stale: false, detail: `installer PID ${observed.pid} is live` };
  if (state === 'dead') return { ok: true, active: false, stale: true, detail: `stale install lock for dead PID ${observed.pid}` };
  return { ok: false, detail: `install lock PID ${observed.pid} cannot be inspected definitively` };
}

/** Historical bounded O_EXCL lock for non-installer persistence. */
export function acquireLock(lockPath: string): LockResult {
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try { writeSync(fd, `${process.pid}\n`); } catch { /* informational */ }
      return { ok: true, fd };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, code: 'ERR-PS2-CONFIG-LOCK', message: `lock could not be acquired for ${lockPath} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
      }
      if (attempt >= LOCK_RETRIES) {
        return {
          ok: false,
          code: 'ERR-PS2-CONFIG-BUSY',
          message: `another pi-shuttle state operation is in progress (lock: ${lockPath}); waited ${LOCK_RETRIES + 1} attempts. If no other operation is running, verify the stale lock before recovery`,
        };
      }
      sleepSync(LOCK_RETRY_DELAY_MS);
    }
  }
}

/** Release an unchanged ordinary lock and preserve any replacement. */
export function releaseLock(fd: number, lockPath: string): void {
  try {
    const opened = fstatSync(fd);
    const current = lstatSync(lockPath);
    if (opened.dev === current.dev && opened.ino === current.ino) unlinkSync(lockPath);
  } catch { /* best effort */ }
  try { closeSync(fd); } catch { /* best effort */ }
}
