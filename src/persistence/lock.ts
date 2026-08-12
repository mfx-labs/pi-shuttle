/**
 * pi-shuttle exclusive lock artifact (shared; PS-2 writer + PS-3 installer).
 *
 * Semantics (single design, reused — never a third locking scheme):
 *   - atomic acquisition via O_CREAT|O_EXCL (`openSync 'wx'`), 0600, with
 *     the acquiring PID recorded as informational content;
 *   - bounded contention (20 × 25 ms ≈ max 500 ms), then a deterministic
 *     `ERR-PS2-CONFIG-BUSY` fail-closed result;
 *   - a lock artifact that survives process death is NEVER auto-stolen
 *     (no time/PID guessing): acquisition fails closed and the message
 *     carries explicit stale-lock recovery guidance;
 *   - release unlinks the lock artifact BEFORE closing the descriptor
 *     (a crash between the two leaves no stale lock).
 *
 * The lock must span the whole read→decide→mutate→verify critical section
 * it protects; it is advisory only among cooperating pi-shuttle writers.
 */
import { closeSync, openSync, unlinkSync, writeSync } from 'node:fs';

export type LockResult = { readonly ok: true; readonly fd: number } | { readonly ok: false; readonly code: string; readonly message: string };

/** Bounded contention wait: 20 attempts × 25 ms (max ~500 ms), then BUSY. */
const LOCK_RETRIES = 20;
const LOCK_RETRY_DELAY_MS = 25;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Acquire the sibling lock atomically (O_CREAT|O_EXCL). Bounded retry; never steals. */
export function acquireLock(lockPath: string): LockResult {
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try {
        writeSync(fd, `${process.pid}\n`);
      } catch {
        // informational lock content; acquisition stands without it
      }
      return { ok: true, fd };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, code: 'ERR-PS2-CONFIG-LOCK', message: `lock could not be acquired for ${lockPath} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
      }
      if (attempt >= LOCK_RETRIES) {
        return {
          ok: false,
          code: 'ERR-PS2-CONFIG-BUSY',
          message: `another pi-shuttle state operation is in progress (lock: ${lockPath}); waited ${LOCK_RETRIES + 1} attempts. If no other operation is running, remove the stale lock file and retry`,
        };
      }
      sleepSync(LOCK_RETRY_DELAY_MS);
    }
  }
}

/** Release the lock: unlink first (a crash here leaves no stale lock), then close. */
export function releaseLock(fd: number, lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // best-effort; the critical section already completed
  }
  try {
    closeSync(fd);
  } catch {
    // best-effort
  }
}
