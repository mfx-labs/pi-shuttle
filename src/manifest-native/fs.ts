/**
 * Manifest-native no-follow filesystem validation (NEW-STATE Slice A).
 * Read-only helpers: open without following symlinks where the host
 * abstraction supports it (O_NOFOLLOW on Linux/macOS), fstat the opened
 * descriptor, and enforce the manifest-native object contract:
 *
 *   - expected regular-file or directory type;
 *   - no symlink following (final component via O_NOFOLLOW, any component
 *     via the structural lstat walk in the caller);
 *   - owner must equal the effective UID;
 *   - exact required mode (directories 0700, receipt/cache files 0600);
 *   - byte ceilings on document reads.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import type { Stats } from 'node:fs';

export type NativeObjectResult =
  | { readonly ok: true; readonly stat: Stats }
  | { readonly ok: false; readonly code: 'absent' | 'symlink' | 'type' | 'owner' | 'mode' | 'stat-failed'; readonly message: string };

/**
 * lstat-based no-follow object check. `kind` is the expected type and
 * `mode` the exact required permission bits (0o777 mask plus setuid/
 * sticky bits). Never follows symlinks.
 */
export function checkNativeObject(path: string, uid: number, kind: 'directory' | 'file', mode: number): NativeObjectResult {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, code: code === 'ENOENT' ? 'absent' : 'stat-failed', message: `${path} could not be inspected (${code ?? 'unknown error'})` };
  }
  if (stat.isSymbolicLink()) return { ok: false, code: 'symlink', message: `${path} is a symbolic link` };
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
    return { ok: false, code: 'type', message: `${path} is not the expected ${kind}` };
  }
  if (stat.uid !== uid) return { ok: false, code: 'owner', message: `${path} is not owned by the effective user` };
  if ((stat.mode & 0o7777) !== mode) {
    return { ok: false, code: 'mode', message: `${path} mode ${(stat.mode & 0o7777).toString(8)} does not match the required ${mode.toString(8)}` };
  }
  return { ok: true, stat };
}

export type NativeReadResult =
  | { readonly ok: true; readonly text: string; readonly stat: Stats }
  | { readonly ok: false; readonly code: 'absent' | 'symlink' | 'type' | 'owner' | 'mode' | 'too-large' | 'read-failed'; readonly message: string };

/**
 * Read a bounded document without following a symlinked final component:
 * open with O_NOFOLLOW (when available), fstat the opened descriptor,
 * enforce regular-file type, owner, exact mode, and the byte ceiling.
 */
export function readBoundedNativeFile(path: string, ceiling: number, uid: number, requiredMode: number): NativeReadResult {
  let fd: number | undefined;
  try {
    const flags = constants.O_RDONLY | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
    fd = openSync(path, flags);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { ok: false, code: 'type', message: `${path} is not a regular file` };
    if (stat.uid !== uid) return { ok: false, code: 'owner', message: `${path} is not owned by the effective user` };
    if ((stat.mode & 0o7777) !== requiredMode) {
      return { ok: false, code: 'mode', message: `${path} mode ${(stat.mode & 0o7777).toString(8)} does not match the required ${requiredMode.toString(8)}` };
    }
    if (stat.size > ceiling) return { ok: false, code: 'too-large', message: `${path} exceeds the ${ceiling}-byte ceiling` };
    const buffer = Buffer.allocUnsafe(ceiling + 1);
    let total = 0;
    while (total <= ceiling) {
      const n = readSync(fd, buffer, total, ceiling + 1 - total, total);
      if (n <= 0) break;
      total += n;
    }
    if (total > ceiling) return { ok: false, code: 'too-large', message: `${path} exceeds the ${ceiling}-byte ceiling` };
    // The fstat'd identity (dev/ino/type/owner/mode) of the object actually
    // read is returned so later durability barriers can bind to the exact
    // verified inode (MN-B-02b).
    return { ok: true, text: buffer.subarray(0, total).toString('utf8'), stat };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return {
      ok: false,
      code: code === 'ENOENT' ? 'absent' : code === 'ELOOP' ? 'symlink' : 'read-failed',
      message: `${path} could not be read (${code ?? 'unknown error'})`,
    };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort close; the result stands
      }
    }
  }
}
