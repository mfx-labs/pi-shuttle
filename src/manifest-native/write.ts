/**
 * Manifest-native durable publication (NEW-STATE Slice B, MN-B-01/MN-B-02
 * correction). POSIX durable write sequence for manifest-native
 * authoritative local files:
 *
 *   create/write unique temporary regular file in destination directory
 *     -> fsync temporary file
 *     -> close temporary file
 *     -> ATOMICALLY expose final name WITHOUT clobber (hard-link publish)
 *     -> remove the temporary directory entry
 *     -> fsync parent directory
 *
 * Atomic no-clobber exposure uses `link(temp, final)`: the link syscall
 * atomically creates the final directory entry and FAILS WITH EEXIST (never
 * replacing) if a competing target appeared after the initial absence
 * observation. Check-then-rename is NOT used as the no-clobber mechanism —
 * ordinary rename() may replace a racing target. The final file and the
 * temp initially reference the same already-fsynced inode.
 *
 * FAIL-FAST discipline: on any I/O error the operation returns a typed
 * durability failure. There is NO application-level filesystem recovery:
 * no journal files, no recovery records, no crash-state inference, no
 * old/new reconciliation, no repair, no rollback.
 *
 * Visibility state: the only internal state is `finalVisible` (false until
 * the link succeeds). PRE-publication failures (temp create/write/fsync/
 * close, or a non-EEXIST link failure) produce the accepted
 * ERR-MN-DURABILITY-PRE-RENAME class with best-effort temp cleanup that
 * never obscures the original failure. POST-publication failures (temp
 * unlink, parent open/fsync/close) produce ERR-MN-DURABILITY-POST-RENAME:
 * the final authoritative object is never deleted, replaced, rolled back,
 * or re-written, and nothing it references is touched. EEXIST is NOT a
 * durability failure — it enters the existing-object verification path.
 *
 * Reuse (MN-B-02): when an existing identical valid object is reused, the
 * parent-directory fsync barrier is explicitly established before reuse is
 * reported (a prior attempt may have made the object visible while its
 * parent fsync failed). Barrier failure is a POST-publication-class error;
 * the visible object is preserved.
 *
 * The `io` argument is a narrow deterministic fault-injection seam for
 * tests only; production defaults always use the real fixed filesystem
 * implementation, and no CLI/env/config switch can alter it.
 */
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, unlinkSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { dirname } from 'node:path';
import type { ManifestNativeLayout } from '../host/environment.js';
import { MAX_CACHE_BYTES, parseManifestNativeCache, serializeManifestNativeCache } from './cache.js';
import type { ManifestNativeCacheDocument } from './cache.js';
import { readBoundedNativeFile } from './fs.js';
import { deriveCachePath, RELEASE_ID_RE, SHA256_HEX_RE } from './paths.js';
import { MAX_RECEIPT_BYTES, parseManifestNativeReceipt, serializeManifestNativeReceipt } from './receipt.js';
import type { ParsedManifestNativeReceipt } from './receipt.js';

/** The two typed durability failure classes (repository naming convention: ERR-MN-*). */
export type DurableErrorCode = 'ERR-MN-DURABILITY-PRE-RENAME' | 'ERR-MN-DURABILITY-POST-RENAME';

export type DurableWriteResult =
  | { readonly ok: true; readonly published: true }
  | {
      readonly ok: false;
      /** A competing target won the race: NOT a durability failure; callers re-enter existing-object verification. */
      readonly code: 'ERR-MN-DURABILITY-EEXIST';
      readonly path: string;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: DurableErrorCode;
      /** The failed syscall/operation (e.g. `write-temp`, `fsync-temp`, `link-final`, `unlink-temp`, `fsync-parent-dir`). */
      readonly operation: string;
      /** The relevant canonical destination path (no secret/private material). */
      readonly path: string;
      /** Underlying system error code or cause. */
      readonly cause: string;
      readonly message: string;
    };

/**
 * Narrow deterministic I/O seam (tests only). Production defaults are the
 * real filesystem implementation (`realDurableIo`); this seam cannot be
 * reached from any CLI/env/config surface.
 */
export interface DurableIo {
  readonly write: (fd: number, buffer: Buffer, offset: number, length: number) => number;
  readonly fsync: (fd: number) => void;
  readonly close: (fd: number) => void;
  /** Atomic no-clobber exposure: must fail with EEXIST when the target exists. */
  readonly link: (from: string, to: string) => void;
  readonly unlink: (path: string) => void;
  /** Open an EXISTING file without following a symlinked final component (reuse barrier). */
  readonly openExistingFile: (path: string) => number;
  /** Open the parent directory for fsync (returns a directory fd). */
  readonly openDirectory: (path: string) => number;
  readonly fsyncDirectory: (fd: number) => void;
}

/** The fixed production I/O implementation. */
export const realDurableIo: DurableIo = Object.freeze({
  write: writeSync,
  fsync: fsyncSync,
  close: closeSync,
  link: linkSync,
  unlink: unlinkSync,
  openExistingFile: (path: string) => openSync(path, constants.O_RDONLY | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)),
  openDirectory: (path: string) => openSync(path, 'r'),
  fsyncDirectory: fsyncSync,
});

function systemCause(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== undefined) return code;
  return (err as Error).message || 'unknown error';
}

function isEexist(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'EEXIST';
}

/** Best-effort temp cleanup; never obscures the original failure. */
function bestEffortTempCleanup(tmp: string, io: DurableIo): void {
  try {
    io.unlink(tmp);
  } catch {
    // best-effort; the original failure result stands
  }
}

/**
 * Existing-object durability barrier (MN-B-02b): the reuse path must prove
 * BOTH the existing FILE's content durability AND its directory-entry
 * durability. File-data durability and directory-entry durability are
 * separate POSIX barriers.
 *
 * Sequence:
 *   safely open the existing final file with O_NOFOLLOW
 *     -> fstat-verify it is still the EXACT regular file already accepted
 *        (type, dev/ino binding against the safely-read object, owner,
 *        exact mode)
 *     -> fsync(existing file)
 *     -> close(existing file)
 *     -> fsync(parent directory)
 *     -> close(parent directory)
 *
 * The dev/ino binding is the no-follow identity binding: if the final path
 * is replaced between the safe read and the open (or between the open and
 * the fstat), verification fails closed and the substituted object is
 * never fsynced or accepted. If replacement happens after the FD is
 * opened, fsync applies to the opened inode (same-UID race model,
 * unchanged). A file fsync/close failure or parent barrier failure is
 * POST-publication class: this attempt has chosen to rely on the existing
 * authoritative object — it is never deleted, replaced, or re-published
 * over. First-error-preserving close handling (a close error never masks
 * an earlier fsync error).
 */
function existingObjectDurabilityBarrier(path: string, accepted: Stats, uid: number, requiredMode: number, io: DurableIo): DurableWriteResult {
  let operation = 'open-existing-file';
  let fd: number | undefined;
  try {
    fd = io.openExistingFile(path);
    operation = 'verify-existing-file';
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('not a regular file');
    if (stat.dev !== accepted.dev || stat.ino !== accepted.ino) {
      throw new Error('file was replaced between safe verification and the durability barrier (dev/ino mismatch)');
    }
    if (stat.uid !== uid) throw new Error('file is not owned by the effective user');
    if ((stat.mode & 0o7777) !== requiredMode) throw new Error('file mode changed since safe verification');
    operation = 'fsync-existing-file';
    io.fsync(fd);
    operation = 'close-existing-file';
    let closeError: unknown = null;
    try {
      io.close(fd);
    } catch (err) {
      closeError = err;
    }
    fd = undefined;
    if (closeError !== null) throw closeError;
    // Directory-entry barrier (both barriers are required for reuse).
    operation = 'open-parent-dir';
    const parent = io.openDirectory(dirname(path));
    operation = 'fsync-parent-dir';
    let dirError: unknown = null;
    try {
      io.fsyncDirectory(parent);
    } catch (err) {
      dirError = err;
    }
    try {
      io.close(parent);
    } catch (err) {
      if (dirError === null) dirError = err;
    }
    if (dirError !== null) throw dirError;
    return { ok: true, published: true };
  } catch (err) {
    if (fd !== undefined) {
      try {
        io.close(fd);
      } catch {
        // best-effort; the barrier failure result stands
      }
    }
    return {
      ok: false,
      code: 'ERR-MN-DURABILITY-POST-RENAME',
      operation,
      path,
      cause: systemCause(err),
      message: `existing authoritative object at ${path} is visible and valid, but its durability barrier failed (${operation}: ${systemCause(err)}); the object is preserved — no recovery is attempted`,
    };
  }
}

/**
 * The POSIX durable publish sequence with atomic no-clobber exposure.
 * `finalVisible` is the ONLY internal visibility state; it is set
 * immediately after a successful link(temp, final), before the temp
 * directory entry is removed and the parent directory is fsynced.
 *
 * PRE-publication: best-effort temp cleanup; typed pre-rename error; the
 * original failure is preserved; unrelated objects are never touched.
 * EEXIST: the attempt temp is cleaned up and the typed EEXIST result is
 * returned — a competing target won and must enter existing-object
 * verification; it is never overwritten.
 * POST-publication: typed post-rename error; the final authoritative file
 * is never deleted, replaced, rolled back, or re-written; nothing it
 * references is touched; no durability inference is made.
 */
export function durablePublish(path: string, bytes: Buffer, io: DurableIo = realDurableIo): DurableWriteResult {
  let operation = 'mkdir-parent';
  try {
    // Parent directories are created 0700 only when missing; existing
    // directories are never chmod'd or repaired. The final path itself is
    // never created by mkdir (publication is link-only).
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Unique temporary regular file in the destination directory.
    const tmp = `${path}.mn-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    let fd: number | undefined;
    let finalVisible = false;
    try {
      operation = 'open-temp';
      fd = openSync(tmp, 'wx', 0o600);
      operation = 'chmod-temp';
      fchmodSync(fd, 0o600);
      operation = 'write-temp';
      let written = 0;
      while (written < bytes.length) {
        const n = io.write(fd, bytes, written, bytes.length - written);
        if (n <= 0) throw new Error(`write made no progress after ${written} of ${bytes.length} bytes`);
        written += n;
      }
      operation = 'fsync-temp';
      io.fsync(fd);
      operation = 'close-temp';
      io.close(fd);
      fd = undefined;
      // Atomic no-clobber exposure: link() fails with EEXIST if a target
      // appeared after the initial absence observation — it can never
      // replace a competing target.
      operation = 'link-final';
      io.link(tmp, path);
      finalVisible = true;
      // Remove the temporary directory entry (same inode as the final).
      operation = 'unlink-temp';
      io.unlink(tmp);
      // Durability barrier: the directory mutation set is now final.
      operation = 'open-parent-dir';
      const parent = io.openDirectory(dirname(path));
      operation = 'fsync-parent-dir';
      // Preserve the FIRST parent-directory failure: close runs regardless,
      // but a close error must not mask a preceding fsync error.
      let dirError: unknown = null;
      try {
        io.fsyncDirectory(parent);
      } catch (err) {
        dirError = err;
      }
      try {
        io.close(parent);
      } catch (err) {
        if (dirError === null) dirError = err;
      }
      if (dirError !== null) throw dirError;
      return { ok: true, published: true };
    } catch (err) {
      if (!finalVisible) {
        // PRE-publication. EEXIST is a distinct outcome, not a failure:
        // the competing target is never touched.
        if (isEexist(err) && operation === 'link-final') {
          if (fd !== undefined) {
            try {
              io.close(fd);
            } catch {
              // best-effort
            }
          }
          bestEffortTempCleanup(tmp, io);
          return {
            ok: false,
            code: 'ERR-MN-DURABILITY-EEXIST',
            path,
            message: `a competing object already exists at ${path}; the attempt temporary was removed and the existing object is preserved (EEXIST)`,
          };
        }
        // Other pre-publication failure: best-effort cleanup of the
        // attempt-owned temporary file only; cleanup failure must not
        // obscure the original error.
        if (fd !== undefined) {
          try {
            io.close(fd);
          } catch {
            // best-effort
          }
        }
        bestEffortTempCleanup(tmp, io);
        return {
          ok: false,
          code: 'ERR-MN-DURABILITY-PRE-RENAME',
          operation,
          path,
          cause: systemCause(err),
          message: `could not ${operation} for ${path} before the authoritative exposure (${systemCause(err)}); no final file was published`,
        };
      }
      // POST-publication: the authoritative file is visible. Fail fast and
      // preserve everything it references — no deletion, no rollback.
      return {
        ok: false,
        code: 'ERR-MN-DURABILITY-POST-RENAME',
        operation,
        path,
        cause: systemCause(err),
        message: `${path} was durably linked but ${operation} failed (${systemCause(err)}); the published file and all state it references are preserved — no recovery is attempted`,
      };
    }
  } catch (err) {
    // mkdir-parent failure: nothing was created authoritatively.
    return {
      ok: false,
      code: 'ERR-MN-DURABILITY-PRE-RENAME',
      operation,
      path,
      cause: systemCause(err),
      message: `could not ${operation} for ${path} (${systemCause(err)}); no final file was published`,
    };
  }
}

export type PublicationResult =
  | { readonly ok: true; readonly published: boolean; readonly path: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Existing-object disposition for an already-visible target (initial
 * observation, or after an EEXIST race): byte identity + safe semantic
 * verification; identical -> reuse THROUGH the parent durability barrier;
 * anything else -> typed conflict, never overwritten.
 */
function reuseOrConflict(path: string, existingText: string, acceptedStat: Stats, bytes: Buffer, io: DurableIo, uid: number, requiredMode: number, conflictCode: string, conflictPrefix: string): PublicationResult {
  if (!Buffer.from(existingText, 'utf8').equals(bytes)) {
    return { ok: false, code: conflictCode, message: `${conflictPrefix} at ${path} differs from the intended content; refusing to overwrite` };
  }
  // MN-B-02b: reuse requires the existing FILE content barrier AND the
  // parent directory-entry barrier, bound to the exact verified inode.
  const barrier = existingObjectDurabilityBarrier(path, acceptedStat, uid, requiredMode, io);
  if (!barrier.ok) return { ok: false, code: barrier.code, message: barrier.message };
  return { ok: true, published: false, path };
}

/**
 * Durable publication of the manifest-native signed selection-chain cache.
 *
 * Identity is (releaseId, releaseManifestSha256) only; the target path is
 * derived from the manifest-native layout — the caller cannot provide a
 * path. Content is the canonical cache serialization (JCS + one trailing
 * newline), bounded by MAX_CACHE_BYTES.
 *
 * Target semantics: immutable, no-clobber. An existing target is reused
 * ONLY after a full safe read (regular file, owner == uid, exact 0600,
 * no-follow) with exact byte identity AND successful cache parse, and the
 * reuse establishes the parent-directory durability barrier. A
 * differing/unsafe/malformed target fails closed and is never
 * overwritten. A target that appears between the absence observation and
 * the atomic link (EEXIST) enters the same verification path.
 */
export function publishManifestNativeCache(
  layout: ManifestNativeLayout,
  releaseId: string,
  releaseManifestSha256: string,
  cache: ManifestNativeCacheDocument,
  io: DurableIo = realDurableIo,
  uid: number = process.getuid?.() ?? -1,
): PublicationResult {
  if (!RELEASE_ID_RE.test(releaseId) || !SHA256_HEX_RE.test(releaseManifestSha256)) {
    return { ok: false, code: 'ERR-MN-CACHE-IDENTITY', message: 'cache identity (releaseId, releaseManifestSha256) is not canonical' };
  }
  const path = deriveCachePath(layout, releaseId, releaseManifestSha256);
  if (path === null) return { ok: false, code: 'ERR-MN-CACHE-IDENTITY', message: 'cache identity cannot derive a canonical cache path' };
  const text = serializeManifestNativeCache(cache);
  if (Buffer.byteLength(text, 'utf8') > MAX_CACHE_BYTES) {
    return { ok: false, code: 'ERR-MN-CACHE-SIZE', message: `cache exceeds the ${MAX_CACHE_BYTES}-byte ceiling` };
  }
  const bytes = Buffer.from(text, 'utf8');
  const existing = readBoundedNativeFile(path, MAX_CACHE_BYTES, uid, 0o600);
  if (existing.ok) {
    return reuseOrConflict(path, existing.text, existing.stat, bytes, io, uid, 0o600, 'ERR-MN-CACHE-CONFLICT', 'existing cache object');
  }
  if (existing.code !== 'absent') {
    return { ok: false, code: 'ERR-MN-CACHE-CONFLICT', message: `existing cache target at ${path} is unsafe (${existing.code}): ${existing.message}` };
  }
  const written = durablePublish(path, bytes, io);
  if (!written.ok) {
    if (written.code === 'ERR-MN-DURABILITY-EEXIST') {
      // A competing target won the race: verify it, never overwrite it.
      const raced = readBoundedNativeFile(path, MAX_CACHE_BYTES, uid, 0o600);
      if (raced.ok) return reuseOrConflict(path, raced.text, raced.stat, bytes, io, uid, 0o600, 'ERR-MN-CACHE-CONFLICT', 'existing cache object');
      return { ok: false, code: 'ERR-MN-CACHE-CONFLICT', message: `competing cache target at ${path} appeared and cannot be safely read (${raced.code}): ${raced.message}` };
    }
    return { ok: false, code: written.code, message: written.message };
  }
  return { ok: true, published: true, path };
}

/**
 * Durable publication of the manifest-native receipt (fixed layout path;
 * the caller cannot provide a path). The receipt is authoritative
 * selection and MUST be the last authoritative step of a future
 * fresh-install flow; this Slice provides the primitive and its safety
 * tests only — production fresh-install orchestration is NOT wired.
 *
 * An existing identical receipt is reused after a full safe read and the
 * parent durability barrier; an existing DIFFERENT/unsafe/malformed
 * receipt fails closed (intentional replacement is future fresh-install
 * orchestration, not this Slice). A target that appears between the
 * absence observation and the atomic link (EEXIST) enters the same
 * verification path and is never overwritten.
 */
export function publishManifestNativeReceipt(
  layout: ManifestNativeLayout,
  receipt: ParsedManifestNativeReceipt,
  io: DurableIo = realDurableIo,
  uid: number = process.getuid?.() ?? -1,
): PublicationResult {
  const path = layout.receiptPath;
  const text = serializeManifestNativeReceipt(receipt);
  if (Buffer.byteLength(text, 'utf8') > MAX_RECEIPT_BYTES) {
    return { ok: false, code: 'ERR-MN-RECEIPT-SIZE', message: `receipt exceeds the ${MAX_RECEIPT_BYTES}-byte ceiling` };
  }
  const bytes = Buffer.from(text, 'utf8');
  const existing = readBoundedNativeFile(path, MAX_RECEIPT_BYTES, uid, 0o600);
  if (existing.ok) {
    return reuseOrConflict(path, existing.text, existing.stat, bytes, io, uid, 0o600, 'ERR-MN-RECEIPT-CONFLICT', 'existing receipt');
  }
  if (existing.code !== 'absent') {
    return { ok: false, code: 'ERR-MN-RECEIPT-CONFLICT', message: `existing receipt target at ${path} is unsafe (${existing.code}): ${existing.message}` };
  }
  const written = durablePublish(path, bytes, io);
  if (!written.ok) {
    if (written.code === 'ERR-MN-DURABILITY-EEXIST') {
      const raced = readBoundedNativeFile(path, MAX_RECEIPT_BYTES, uid, 0o600);
      if (raced.ok) return reuseOrConflict(path, raced.text, raced.stat, bytes, io, uid, 0o600, 'ERR-MN-RECEIPT-CONFLICT', 'existing receipt');
      return { ok: false, code: 'ERR-MN-RECEIPT-CONFLICT', message: `competing receipt target at ${path} appeared and cannot be safely read (${raced.code}): ${raced.message}` };
    }
    return { ok: false, code: written.code, message: written.message };
  }
  return { ok: true, published: true, path };
}
