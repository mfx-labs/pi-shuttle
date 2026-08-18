/**
 * PS-3 artifact acquisition/integrity model. Local-file artifact source
 * only in this gate; the future remote source is a documented seam that
 * stays DISABLED until official release artifacts/URLs exist (no
 * speculative endpoints, no network).
 *
 * Digest policy (truthful distinction): the release manifest represents
 * official artifact digests as `null` (not yet computed). When an expected
 * digest is provided (release manifest at PS-8, or a local strict
 * verification), a mismatch REFUSES the artifact. When no expected digest
 * is available, the SHA-256 is computed and recorded as a LOCAL verified
 * digest — never presented as an official release digest.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, createReadStream, fstatSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readJsonFileIfRegular } from './archive.js';

export type ArtifactResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

export interface ComponentArtifactSpec {
  /** Expected package name inside the artifact (identity pin). */
  readonly name: string;
  /** Expected package version (exact pin; never ranges). */
  readonly version: string;
  /** Expected artifact file name in the artifact directory. */
  readonly fileName: string;
  /** Optional strict digest expectation (release/local-lane verification). */
  readonly expectedSha256?: string;
}

/** The artifact file path for a component under a local artifact directory. */
export function artifactFilePath(artifactDir: string, spec: ComponentArtifactSpec): string {
  return join(artifactDir, spec.fileName);
}

/** SHA-256 of a file (streamed; bounded memory). */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (d: Buffer) => hash.update(d));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Deterministic byte/inventory digest of an extracted or installed
 * package tree (package-tree SHA-256 v1, NEW-STATE Slice A hardening of
 * the existing framing):
 *
 *   - root entry represented as "."; relative paths use "/";
 *   - accepted entries: directories and regular files only (symlinks,
 *     hardlinks where deterministically detectable, devices, FIFOs,
 *     sockets, and other special files are rejected);
 *   - valid Unicode scalar sequences only; no normalization; no case
 *     folding;
 *   - traversal order: unsigned UTF-8 byte order of the relative path;
 *   - framing: `directory NUL rel NUL` / `file NUL rel NUL sha256 NUL`;
 *   - file digest: SHA-256 of the exact file bytes; aggregate: SHA-256 of
 *     the framed entry stream;
 *   - excluded from identity: size, UID/GID, timestamps, inode, xattrs,
 *     permission modes, executable bit;
 *   - bounds: 100,000 entries max, enforced DURING traversal (the walk
 *     stops the moment the next accepted entry would exceed the limit,
 *     bounding inventory/inode-set allocation and recursion); 1 GiB total
 *     regular-file bytes max, enforced incrementally while reading;
 *   - no-follow: regular files are opened with O_NOFOLLOW (where the host
 *     abstraction supports it) and the opened descriptor is fstat'd to
 *     confirm it is still the exact enumerated object (dev/ino) — a
 *     substituted or raced entry fails closed.
 *
 * The optional `bounds` argument is a test seam for exercising the
 * ceilings; production callers never pass it.
 */
export interface PackageTreeBounds {
  readonly maxEntries?: number;
  readonly maxFileBytes?: number;
}

export const PACKAGE_TREE_MAX_ENTRIES = 100_000;
export const PACKAGE_TREE_MAX_FILE_BYTES = 1024 * 1024 * 1024; // 1 GiB

export const PACKAGE_TREE_MAX_RELATIVE_PATH_BYTES = 4096;

interface TreeEntry {
  readonly rel: string;
  readonly kind: 'directory' | 'file';
  readonly dev: number;
  readonly ino: number;
}

function hasValidUnicodeScalars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Unsigned UTF-8 byte order (Buffer.compare is unsigned byte-wise). */
function utf8ByteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Hash one regular file through a no-follow descriptor, verifying identity. */
function hashTreeFile(path: string, expected: { readonly dev: number; readonly ino: number }, maxFileBytes: number, alreadyHashed: number): { readonly sha256: string; readonly bytes: number } {
  const flags = constants.O_RDONLY | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
  const fd = openSync(path, flags);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`entry is no longer a regular file: ${path}`);
    if (stat.dev !== expected.dev || stat.ino !== expected.ino) throw new Error(`entry changed between enumeration and hashing: ${path}`);
    if (stat.size > maxFileBytes - alreadyHashed) throw new Error('package tree exceeds the total regular-file byte ceiling');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n <= 0) break;
      bytes += n;
      if (alreadyHashed + bytes > maxFileBytes) throw new Error('package tree exceeds the total regular-file byte ceiling');
      hash.update(buffer.subarray(0, n));
    }
    return { sha256: hash.digest('hex'), bytes };
  } finally {
    closeSync(fd);
  }
}

/** Deterministic byte/inventory digest of an extracted or installed package tree. */
export async function hashPackageTree(packageRoot: string, bounds: PackageTreeBounds = {}): Promise<ArtifactResult<string>> {
  const maxEntries = bounds.maxEntries ?? PACKAGE_TREE_MAX_ENTRIES;
  const maxFileBytes = bounds.maxFileBytes ?? PACKAGE_TREE_MAX_FILE_BYTES;
  const entries: TreeEntry[] = [];
  const fileInodes = new Set<string>();
  const uid = process.getuid?.() ?? -1;
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    const rel = relative(packageRoot, path) || '.';
    if (rel !== '.' && (!hasValidUnicodeScalars(rel) || rel.includes('\0'))) throw new Error(`invalid Unicode or NUL in package path: ${rel}`);
    if (Buffer.byteLength(rel, 'utf8') > PACKAGE_TREE_MAX_RELATIVE_PATH_BYTES) throw new Error(`package path exceeds the ${PACKAGE_TREE_MAX_RELATIVE_PATH_BYTES}-byte ceiling: ${rel}`);
    if (stat.isSymbolicLink()) throw new Error(`symbolic link rejected at ${rel}`);
    if (stat.uid !== uid) throw new Error(`package entry ${rel} is not owned by the effective user`);
    // F-02: the entry ceiling is enforced DURING traversal — the moment
    // the next accepted entry would exceed the limit, work stops. This
    // bounds inventory allocation, inode-set allocation, and recursive
    // traversal; the remaining subtree is never walked. The root "."
    // entry participates in the count (it is a framed entry).
    if (entries.length >= maxEntries) throw new Error(`package tree exceeds the ${maxEntries}-entry ceiling`);
    if (stat.isDirectory()) {
      entries.push({ rel, kind: 'directory', dev: stat.dev, ino: stat.ino });
      for (const name of readdirSync(path).sort(utf8ByteOrder)) visit(join(path, name));
      return;
    }
    if (stat.isFile()) {
      const inodeKey = `${stat.dev}:${stat.ino}`;
      if (fileInodes.has(inodeKey)) throw new Error(`hard link rejected at ${rel}`);
      fileInodes.add(inodeKey);
      entries.push({ rel, kind: 'file', dev: stat.dev, ino: stat.ino });
      return;
    }
    throw new Error(`unsupported package entry type at ${rel}`);
  };
  try {
    visit(packageRoot);
    // Global unsigned UTF-8 byte order of the relative path.
    entries.sort((a, b) => utf8ByteOrder(a.rel, b.rel));
    const digest = createHash('sha256');
    let totalBytes = 0;
    for (const entry of entries) {
      digest.update(entry.kind);
      digest.update('\0');
      digest.update(entry.rel);
      digest.update('\0');
      if (entry.kind === 'file') {
        const file = hashTreeFile(join(packageRoot, entry.rel), entry, maxFileBytes, totalBytes);
        totalBytes += file.bytes;
        digest.update(file.sha256);
        digest.update('\0');
      } else {
        // Re-lstat directories: a swapped directory fails closed.
        const stat = lstatSync(join(packageRoot, entry.rel));
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== entry.dev || stat.ino !== entry.ino) {
          throw new Error(`directory changed between enumeration and hashing: ${entry.rel}`);
        }
      }
    }
    return { ok: true, value: digest.digest('hex') };
  } catch (err) {
    return { ok: false, code: 'ERR-PS3-PACKAGE-TREE', message: `package tree at ${packageRoot} could not be verified (${(err as Error).message || 'unknown error'})` };
  }
}

export interface VerifiedArtifact {
  readonly path: string;
  readonly sha256: string;
  /** True when the digest was checked against an expected value. */
  readonly digestVerifiedAgainstExpectation: boolean;
}

/** Verify the artifact file exists and its digest (when expected). */
export async function verifyArtifactFile(artifactDir: string, spec: ComponentArtifactSpec): Promise<ArtifactResult<VerifiedArtifact>> {
  const path = artifactFilePath(artifactDir, spec);
  let sha256: string;
  try {
    sha256 = await hashFile(path);
  } catch (err) {
    return { ok: false, code: 'ERR-PS3-ARTIFACT-UNAVAILABLE', message: `artifact ${path} could not be read (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  if (spec.expectedSha256 !== undefined && sha256 !== spec.expectedSha256) {
    return {
      ok: false,
      code: 'ERR-PS3-ARTIFACT-DIGEST-MISMATCH',
      message: `artifact ${path} digest mismatch: computed ${sha256}, expected ${spec.expectedSha256}`,
    };
  }
  return { ok: true, value: { path, sha256, digestVerifiedAgainstExpectation: spec.expectedSha256 !== undefined } };
}

/**
 * Locate the package root after extraction (npm-pack style `package/`
 * prefix, or bare). Only regular-file `package.json` entries are
 * accepted — a FIFO/symlink/special entry can never be opened
 * (SIR-PS3-001 defense in depth; the structural scan already rejects
 * special members before extraction).
 */
export function findPackageRoot(extractedDir: string): string | null {
  if (readJsonFileIfRegular(join(extractedDir, 'package.json')) !== null) {
    return extractedDir;
  }
  if (readJsonFileIfRegular(join(extractedDir, 'package', 'package.json')) !== null) {
    return join(extractedDir, 'package');
  }
  return null;
}

export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
  /** The declared `bin` map (string or record). */
  readonly bin: Readonly<Record<string, string>>;
}

/** Read + shape-validate package.json identity from an extracted package root. */
export function readPackageIdentity(packageRoot: string): PackageIdentity | null {
  try {
    const text = readJsonFileIfRegular(join(packageRoot, 'package.json'));
    if (text === null) return null;
    const raw = JSON.parse(text) as { name?: unknown; version?: unknown; bin?: unknown };
    if (typeof raw.name !== 'string' || raw.name.length === 0) return null;
    if (typeof raw.version !== 'string' || raw.version.length === 0) return null;
    let bin: Readonly<Record<string, string>> = {};
    if (typeof raw.bin === 'string') {
      bin = { [raw.name]: raw.bin };
    } else if (typeof raw.bin === 'object' && raw.bin !== null) {
      const entries = Object.entries(raw.bin as Record<string, unknown>);
      if (entries.some(([, v]) => typeof v !== 'string')) return null;
      bin = Object.fromEntries(entries) as Readonly<Record<string, string>>;
    }
    return { name: raw.name, version: raw.version, bin };
  } catch {
    return null;
  }
}
