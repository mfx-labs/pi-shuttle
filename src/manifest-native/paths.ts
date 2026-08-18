/**
 * Manifest-native canonical identity/path derivation (NEW-STATE Slice A).
 * Pure policy math: cache paths, package roots, and bin paths are DERIVED
 * from validated identity components — never accepted from caller input.
 * No filesystem access here; symlink/ownership/mode enforcement lives in
 * the manifest-native validation layer (fs.ts / state.ts).
 *
 * The release-ID grammar is intentionally identical to the trust-chain
 * grammar (trust-internal ID_RE) so every derived path component is
 * canonical; the trust boundary itself stays import-restricted.
 */
import { join } from 'node:path';
import type { ManifestNativeLayout } from '../host/environment.js';

/** Accepted release-ID grammar (identical to the trusted release chain). */
export const RELEASE_ID_RE = /^[a-z][a-z0-9._-]{2,127}$/;
/** Lowercase 64-hex digest grammar. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
/** UTF-8 byte ceiling for canonical paths. */
export const MAX_PATH_BYTES = 4096;
/** File-name suffix for cached signed selection chains. */
export const CACHE_FILE_SUFFIX = '.json';

/** Valid Unicode scalar sequences only (no lone surrogates). */
export function hasValidUnicode(value: string): boolean {
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

/**
 * Canonical absolute path: absolute, valid Unicode, no NUL, no empty/dot
 * components (no trailing/multiple separators), UTF-8 byte ceiling.
 */
export function isCanonicalAbsolutePath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.length === 1) return false; // bare "/" is not a package path
  if (!hasValidUnicode(value) || value.includes('\0')) return false;
  if (Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) return false;
  // Skip the empty leading component produced by the leading slash.
  const components = value.split('/').slice(1);
  for (const component of components) {
    if (component.length === 0 || component === '.' || component === '..') return false;
  }
  return true;
}

/**
 * Strict canonical containment: `candidate` is inside `parent` (never
 * equal). Fails closed on non-canonical input itself: both paths must
 * satisfy isCanonicalAbsolutePath() (so "/pkg/" and "/pkg//x" are never
 * accepted as descendant candidates), and "/pkg2/bin" is never a
 * descendant of "/pkg" (the separator boundary is enforced).
 */
export function isStrictDescendant(parent: string, candidate: string): boolean {
  return isCanonicalAbsolutePath(parent)
    && isCanonicalAbsolutePath(candidate)
    && candidate.length > parent.length
    && candidate.startsWith(`${parent}/`);
}

/**
 * Canonical cache path: manifests/<releaseId>/<releaseManifestSha256>.json.
 * Null when the identity components are not canonical (fail closed).
 */
export function deriveCachePath(layout: ManifestNativeLayout, releaseId: string, releaseManifestSha256: string): string | null {
  if (!RELEASE_ID_RE.test(releaseId) || !SHA256_HEX_RE.test(releaseManifestSha256)) return null;
  return join(layout.manifestsRoot, releaseId, `${releaseManifestSha256}${CACHE_FILE_SUFFIX}`);
}

/**
 * Canonical content-addressed package root:
 * packages/sha256/<packageTreeSha256>. Null for non-canonical digests.
 */
export function derivePackageRoot(layout: ManifestNativeLayout, packageTreeSha256: string): string | null {
  if (!SHA256_HEX_RE.test(packageTreeSha256)) return null;
  return join(layout.packagesSha256Root, packageTreeSha256);
}

/**
 * Expected bin path from the canonical package root and the verified
 * package `bin` entry: a safe relative path (no absolute, no traversal,
 * no NUL, valid Unicode, byte ceiling) joined under the package root.
 * Null when the entry cannot be a canonical in-package path.
 */
export function deriveBinPath(packageRoot: string, binEntry: string): string | null {
  if (typeof binEntry !== 'string' || binEntry.length === 0) return null;
  if (binEntry.startsWith('/') || binEntry.includes('\0') || !hasValidUnicode(binEntry)) return null;
  if (Buffer.byteLength(binEntry, 'utf8') > MAX_PATH_BYTES) return null;
  for (const component of binEntry.split('/')) {
    if (component.length === 0 || component === '.' || component === '..') return null;
  }
  const candidate = join(packageRoot, binEntry);
  return isStrictDescendant(packageRoot, candidate) ? candidate : null;
}
