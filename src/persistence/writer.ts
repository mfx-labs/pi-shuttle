/**
 * pi-shuttle persistence (PS-2, corrected per SIR-PS2-001/002): ONE
 * authoritative raw publisher and ONE transactional mutation primitive.
 *
 * Ordinary local application config/state persistence — deliberately NOT a
 * copy of the Gateway trusted storage engine (no brands, no capabilities,
 * no trusted-store layout). Discipline:
 *   - atomic publication (same-directory tmp + fsync + rename + dir fsync);
 *   - exact mode 0600 (operator-owned), parent dirs 0700 (created only when
 *     missing; the target itself is never created by mkdir);
 *   - complete-buffer write loop (a short/failed write can never publish a
 *     truncated document; zero progress fails closed);
 *   - idempotent identical-content no-op (no rewrite);
 *   - no partial final-file exposure (publication only via atomic rename of
 *     a complete, fsync'd temporary).
 *
 * CONCURRENCY (SIR-PS2-001/002): the logical state transition
 *
 *     acquire lock → read current state → decode → transition → serialize
 *     → durable publish → verify → release
 *
 * is covered by an exclusive sibling lock artifact (`<path>.lock`) acquired
 * with the atomic O_CREAT|O_EXCL primitive (`openSync 'wx'`) — shared
 * with the PS-3 installer via `src/persistence/lock.ts` (single locking
 * design; see that module for the exact semantics). The lock is
 * held across read/decode/transition/publish/verify, so:
 *   - stale snapshots cannot report success: the transition input is always
 *     the current authoritative state, read AFTER ownership is acquired;
 *   - incompatible/foreign state is never silently replaced by a
 *     cooperating pi-shuttle writer (decode runs under the lock);
 *   - concurrent mutations serialize: every reported success is present in
 *     the final state, or the operation fails closed with a deterministic
 *     `ERR-PS2-CONFIG-BUSY` result.
 *
 * LOCK/CONTENTION SEMANTICS (v0.1.0): contention wait is bounded
 * (20 × 25 ms); no unbounded busy loop, no deadlock. A lock artifact that
 * survives process death is NEVER auto-stolen (no time/PID guessing):
 * acquisition fails closed with `ERR-PS2-CONFIG-BUSY` and explicit
 * stale-lock recovery guidance (the operator removes the lock file).
 * Operational limitation recorded for PS-4/doctor follow-up.
 *
 * The raw `writeFileAtomic` publisher carries no concurrency guarantee
 * (single-writer contexts only). Ordinary state transitions MUST go through
 * `mutateDocumentAtomically`; the installer receipt is the one exception,
 * published while its caller owns install.lock. Filesystem mutation
 * vocabulary is confined to this module (static guard enforced).
 */
import { closeSync, fchmodSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAX_CONFIG_BYTES, readBoundedTextFile } from '../config/json.js';
import { acquireLock, releaseLock } from './lock.js';

export type WriteResult = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly code: string; readonly message: string };

export interface WriteOptions {
  /**
   * Narrow testability seam (approved PS-1 pattern): deterministic
   * short/failing-write simulation. Production always uses `writeSync`;
   * the injected writer can only consume bytes on an already-open
   * descriptor. Widens no authority or I/O capability.
   */
  readonly write?: (fd: number, buffer: Buffer, offset: number, length: number) => number;
}

/** Write the complete byte buffer; zero/invalid progress fails closed. */
function writeAll(fd: number, bytes: Buffer, write: (fd: number, buffer: Buffer, offset: number, length: number) => number): void {
  let written = 0;
  while (written < bytes.length) {
    const n = write(fd, bytes, written, bytes.length - written);
    if (n <= 0) throw new Error('write made no progress');
    written += n;
  }
}

/** Read the existing file for the identical/no-clobber check (bounded). */
function existingState(path: string, expected: Buffer): { readonly kind: 'absent' } | { readonly kind: 'same' } | { readonly kind: 'different' } | { readonly kind: 'error'; readonly message: string } {
  const read = readBoundedTextFile(path);
  if (!read.ok) {
    if (read.code === 'absent') return { kind: 'absent' };
    if (read.code === 'ERR-PS2-READ-TOO-LARGE') return { kind: 'different' };
    return { kind: 'error', message: read.message };
  }
  if (Buffer.from(read.text, 'utf8').equals(expected)) return { kind: 'same' };
  return { kind: 'different' };
}

/**
 * Raw atomic byte publication: temp (wx, 0600, complete write, fsync) +
 * rename + dir fsync. Identical existing content is an idempotent no-op.
 * No compatibility check and no concurrency guarantee — see module header.
 */
export function writeFileAtomic(path: string, content: string, options: WriteOptions = {}): WriteResult {
  return publishBytes(path, Buffer.from(content, 'utf8'), options.write);
}

/**
 * The complete-buffer publisher used by both the raw writer and the
 * transaction. Returns `changed: false` for the identical-content no-op.
 */
function publishBytes(path: string, bytes: Buffer, write?: (fd: number, buffer: Buffer, offset: number, length: number) => number): WriteResult {
  const existing = existingState(path, bytes);
  if (existing.kind === 'same') return { ok: true, changed: false };
  if (existing.kind === 'error') {
    return { ok: false, code: 'ERR-PS2-WRITE-READ', message: `existing file could not be read for the conflict check: ${existing.message}` };
  }
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch (err) {
    return { ok: false, code: 'ERR-PS2-WRITE-MKDIR', message: `could not create the configuration directory for ${path} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  const tmp = `${path}.tmp-${process.pid}`;
  let fd: number | undefined;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    fchmodSync(fd, 0o600);
    writeAll(fd, bytes, write ?? writeSync);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    // Atomic publication: the final path is only ever replaced by rename of
    // a complete, fsync'd file. No partial content can appear at `path`.
    renameSync(tmp, path);
    const parent = openSync(dirname(path), 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
    return { ok: true, changed: true };
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort close; the failure result stands
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      // best-effort cleanup; the failure result stands
    }
    return { ok: false, code: 'ERR-PS2-WRITE-FAILED', message: `could not write ${path} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
}

// ─── transactional state mutation ────────────────────────────────────────

export type TransitionResult<T> = { readonly ok: true; readonly next: T; readonly changed: boolean } | { readonly ok: false; readonly code: string; readonly message: string };

export interface MutateOptions<T> {
  /**
   * Decode existing text into the current state; return null when the
   * existing content is incompatible/foreign/malformed (fails closed —
   * never silently replaced).
   */
  readonly decode: (text: string) => T | null;
  /**
   * Pure transition over the CURRENT authoritative state (null when the
   * file is absent). Must not read the filesystem or perform I/O.
   */
  readonly transition: (current: T | null) => TransitionResult<T>;
  /** Deterministic serialization of the next state. */
  readonly serialize: (next: T) => string;
  /** Narrow testability seam (same contract as `WriteOptions.write`). */
  readonly write?: (fd: number, buffer: Buffer, offset: number, length: number) => number;
}

export type MutateResult<T> =
  | { readonly ok: true; readonly value: T; readonly changed: boolean; readonly previous: T | null }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * ONE authoritative transactional state mutation (SIR-PS2-001/002): the
 * whole logical transition runs under the exclusive lock, so concurrent
 * mutations serialize (or fail `ERR-PS2-CONFIG-BUSY`), incompatible state
 * fails closed, and no stale snapshot can report success.
 */
export function mutateDocumentAtomically<T>(path: string, options: MutateOptions<T>): MutateResult<T> {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch (err) {
    return { ok: false, code: 'ERR-PS2-WRITE-MKDIR', message: `could not create the configuration directory for ${path} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  const lockPath = `${path}.lock`;
  const lock = acquireLock(lockPath);
  if (!lock.ok) return lock;
  try {
    // Read the CURRENT authoritative state AFTER acquiring ownership.
    const read = readBoundedTextFile(path);
    let current: T | null = null;
    if (read.ok) {
      const decoded = options.decode(read.text);
      if (decoded === null) {
        return { ok: false, code: 'ERR-PS2-CONFIG-INCOMPATIBLE', message: `${path} exists with incompatible content; refusing to modify it` };
      }
      current = decoded;
    } else if (read.code !== 'absent') {
      return {
        ok: false,
        code: read.code === 'ERR-PS2-READ-TOO-LARGE' ? 'ERR-PS2-CONFIG-INCOMPATIBLE' : 'ERR-PS2-CONFIG-READ',
        message: read.message,
      };
    }
    const transition = options.transition(current);
    if (!transition.ok) {
      return { ok: false, code: transition.code, message: transition.message };
    }
    const bytes = Buffer.from(options.serialize(transition.next), 'utf8');
    const publish = publishBytes(path, bytes, options.write);
    if (!publish.ok) return { ok: false, code: publish.code, message: publish.message };
    if (publish.changed) {
      // Post-publication verification: never report success for state that
      // is absent or different afterwards (bounded read-back; oversized
      // documents are outside the model and skip verification).
      if (bytes.length <= MAX_CONFIG_BYTES) {
        const check = readBoundedTextFile(path);
        const verified = check.ok && Buffer.from(check.text, 'utf8').equals(bytes);
        if (!verified) {
          return { ok: false, code: 'ERR-PS2-WRITE-VERIFY', message: `${path} was published but does not match the intended document; manual verification required` };
        }
      }
    }
    return { ok: true, value: transition.next, changed: publish.changed, previous: current };
  } finally {
    releaseLock(lock.fd, lockPath);
  }
}

/** Export the shared ceiling so callers reason about one bound. */
export { MAX_CONFIG_BYTES };
