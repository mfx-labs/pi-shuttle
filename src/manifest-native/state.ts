/**
 * Manifest-native state classifier (NEW-STATE Slice A). Exactly three
 * outcomes: CLEAN, VALID_MANIFEST_NATIVE_INSTALLATION, or
 * MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE.
 *
 * The classifier inspects ONLY the manifest-native authority namespace
 * (H/.local/share/pi-shuttle/manifest-native). It never touches any
 * previous-generation state and never inspects the non-authoritative
 * work namespace. VALID requires a complete receipt/cache/tree
 * reconciliation; anything unexpected, unsafe, wrongly owned/moded,
 * over-ceiling, or conflicting fails closed as MALFORMED — never CLEAN.
 *
 * The verification step is a narrow seam (default: the production trust
 * boundary). The uid observation follows the OperatorContext pattern.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ManifestNativeLayout } from '../host/environment.js';
import {
  requireVerifiedInstalledEvidence as productionRequireInstalledEvidence,
  verifyInstalledEvidence as productionVerifyInstalledEvidence,
} from '../installer/release/trust.js';
import type { InstalledEvidence, TrustResult, VerifiedInstalledEvidence } from '../installer/release/trust.js';
import { hashPackageTree, readPackageIdentity } from '../installer/artifact.js';
import { parseManifestNativeReceipt, MAX_RECEIPT_BYTES } from './receipt.js';
import { parseManifestNativeCache, MAX_CACHE_BYTES } from './cache.js';
import { reconcileManifestNativeInstallation } from './reconcile.js';
import type { ReconciledManifestNativeInstallation } from './reconcile.js';
import { checkNativeObject, readBoundedNativeFile } from './fs.js';
import { deriveCachePath, derivePackageRoot, RELEASE_ID_RE, SHA256_HEX_RE } from './paths.js';

/** Bounds for the bounded authority namespace. */
export const MAX_MANIFEST_DIRS = 64;
export const MAX_CACHE_FILES_PER_MANIFEST = 4;
export const MAX_TREE_DIRS = 64;
export const MAX_ROOT_ENTRIES = 3;

const ROOT_ENTRIES: readonly string[] = ['receipt.json', 'manifests', 'packages'];
const CACHE_FILE_RE = /^[0-9a-f]{64}\.json$/;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export type ManifestNativeStateVerdict =
  | { readonly kind: 'CLEAN' }
  | { readonly kind: 'VALID_MANIFEST_NATIVE_INSTALLATION'; readonly installation: ReconciledManifestNativeInstallation }
  | { readonly kind: 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE'; readonly reason: string };

export interface ClassifyDependencies {
  /** Effective UID for ownership enforcement (default: process.getuid()). */
  readonly uid?: number;
  /** Installed-evidence verification (default: the production trust boundary). */
  readonly verifyInstalledEvidence?: (input: InstalledEvidence) => TrustResult<VerifiedInstalledEvidence>;
  /**
   * Installed-evidence runtime provenance gate (F-01; default: the
   * production trust boundary). Must match the verifier instance that
   * produced `verifyInstalledEvidence` results.
   */
  readonly requireInstalledEvidence?: (value: unknown) => TrustResult<VerifiedInstalledEvidence>;
}

function malformed(reason: string): ManifestNativeStateVerdict {
  return { kind: 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', reason };
}

/** Structural scan of manifests/ (and its releaseId/cache-file levels). */
function inspectManifestsRoot(layout: ManifestNativeLayout, uid: number): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const rootCheck = checkNativeObject(layout.manifestsRoot, uid, 'directory', DIR_MODE);
  if (!rootCheck.ok) {
    return rootCheck.code === 'absent' ? { ok: true } : { ok: false, reason: rootCheck.message };
  }
  let names: string[];
  try {
    names = readdirSync(layout.manifestsRoot);
  } catch (err) {
    return { ok: false, reason: `manifests could not be listed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  if (names.length > MAX_MANIFEST_DIRS) return { ok: false, reason: `manifests exceeds the ${MAX_MANIFEST_DIRS}-directory bound` };
  for (const name of names) {
    if (!RELEASE_ID_RE.test(name)) return { ok: false, reason: `unexpected manifest entry ${name}` };
    const dirCheck = checkNativeObject(join(layout.manifestsRoot, name), uid, 'directory', DIR_MODE);
    if (!dirCheck.ok) return { ok: false, reason: dirCheck.message };
    let files: string[];
    try {
      files = readdirSync(join(layout.manifestsRoot, name));
    } catch (err) {
      return { ok: false, reason: `manifest directory ${name} could not be listed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
    }
    if (files.length > MAX_CACHE_FILES_PER_MANIFEST) return { ok: false, reason: `manifest directory ${name} exceeds the ${MAX_CACHE_FILES_PER_MANIFEST}-file bound` };
    for (const file of files) {
      if (!CACHE_FILE_RE.test(file)) return { ok: false, reason: `unexpected cache entry ${name}/${file}` };
      const fileCheck = checkNativeObject(join(layout.manifestsRoot, name, file), uid, 'file', FILE_MODE);
      if (!fileCheck.ok) return { ok: false, reason: fileCheck.message };
    }
  }
  return { ok: true };
}

/** Structural scan of packages/ (and packages/sha256/ tree levels). */
function inspectPackagesRoot(layout: ManifestNativeLayout, uid: number): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const packagesCheck = checkNativeObject(layout.packagesRoot, uid, 'directory', DIR_MODE);
  if (!packagesCheck.ok) {
    return packagesCheck.code === 'absent' ? { ok: true } : { ok: false, reason: packagesCheck.message };
  }
  let names: string[];
  try {
    names = readdirSync(layout.packagesRoot);
  } catch (err) {
    return { ok: false, reason: `packages could not be listed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  if (names.some((name) => name !== 'sha256')) return { ok: false, reason: `unexpected packages entry ${names.find((name) => name !== 'sha256')}` };
  if (!names.includes('sha256')) return { ok: true };
  const sha256Check = checkNativeObject(layout.packagesSha256Root, uid, 'directory', DIR_MODE);
  if (!sha256Check.ok) return { ok: false, reason: sha256Check.message };
  let trees: string[];
  try {
    trees = readdirSync(layout.packagesSha256Root);
  } catch (err) {
    return { ok: false, reason: `packages/sha256 could not be listed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  if (trees.length > MAX_TREE_DIRS) return { ok: false, reason: `packages/sha256 exceeds the ${MAX_TREE_DIRS}-directory bound` };
  for (const name of trees) {
    if (!SHA256_HEX_RE.test(name)) return { ok: false, reason: `unexpected package-tree entry ${name}` };
    const treeCheck = checkNativeObject(join(layout.packagesSha256Root, name), uid, 'directory', DIR_MODE);
    if (!treeCheck.ok) return { ok: false, reason: treeCheck.message };
  }
  return { ok: true };
}

/**
 * Classify the manifest-native authority namespace. Async because VALID
 * classification requires hashing the installed package tree.
 */
export async function classifyManifestNativeState(layout: ManifestNativeLayout, hostLane: string, deps: ClassifyDependencies = {}): Promise<ManifestNativeStateVerdict> {
  const uid = deps.uid ?? process.getuid?.() ?? -1;
  const verify = deps.verifyInstalledEvidence ?? productionVerifyInstalledEvidence;
  const requireInstalledEvidence = deps.requireInstalledEvidence ?? productionRequireInstalledEvidence;

  // ponytail: namespace listing bounds (MAX_ROOT_ENTRIES, manifest/tree
  // directory counts) are checked after readdirSync materializes the full
  // array — Node's sync API has no incremental listing. The F-02 bounded-
  // operation guarantee is provided by the package-tree walk, which
  // enforces its ceilings during traversal; these small local namespace
  // bounds are the already-reviewed non-blocking limitation.

  const rootCheck = checkNativeObject(layout.authorityRoot, uid, 'directory', DIR_MODE);
  if (!rootCheck.ok) {
    if (rootCheck.code === 'absent') return { kind: 'CLEAN' };
    return malformed(rootCheck.message);
  }

  let names: string[];
  try {
    names = readdirSync(layout.authorityRoot);
  } catch (err) {
    return malformed(`authority root could not be listed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  if (names.length > MAX_ROOT_ENTRIES) return malformed(`authority root exceeds the ${MAX_ROOT_ENTRIES}-entry bound`);
  if (names.some((name) => !ROOT_ENTRIES.includes(name))) {
    return malformed(`unexpected authority entry ${names.find((name) => !ROOT_ENTRIES.includes(name))}`);
  }
  for (const name of names) {
    const kind = name === 'receipt.json' ? 'file' : 'directory';
    const check = checkNativeObject(join(layout.authorityRoot, name), uid, kind, kind === 'file' ? FILE_MODE : DIR_MODE);
    if (!check.ok) return malformed(check.message);
  }

  const receiptPresent = names.includes('receipt.json');
  const manifestsPresent = names.includes('manifests');
  const packagesPresent = names.includes('packages');

  if (!receiptPresent) {
    // Orphan bounded native objects (valid-shaped caches/trees) do NOT
    // establish an installation. Structural violations still fail closed.
    if (manifestsPresent) {
      const manifests = inspectManifestsRoot(layout, uid);
      if (!manifests.ok) return malformed(manifests.reason);
    }
    if (packagesPresent) {
      const packages = inspectPackagesRoot(layout, uid);
      if (!packages.ok) return malformed(packages.reason);
    }
    return { kind: 'CLEAN' };
  }

  // --- receipt present: full reconciliation required ---
  const receiptRead = readBoundedNativeFile(layout.receiptPath, MAX_RECEIPT_BYTES, uid, FILE_MODE);
  if (!receiptRead.ok) return malformed(receiptRead.message);
  const receiptParse = parseManifestNativeReceipt(receiptRead.text);
  if (!receiptParse.ok) return malformed(`receipt is invalid (${receiptParse.code}): ${receiptParse.message}`);
  const receipt = receiptParse.value;
  const gateway = receipt.gateway;

  if (!manifestsPresent) return malformed('receipt present but the manifests namespace is absent');
  const manifests = inspectManifestsRoot(layout, uid);
  if (!manifests.ok) return malformed(manifests.reason);

  const expectedCachePath = deriveCachePath(layout, gateway.releaseId, gateway.releaseManifestSha256);
  if (expectedCachePath === null) return malformed('receipt identity cannot derive a canonical cache path');
  const cacheFiles = collectCacheFiles(layout);
  if (cacheFiles === null) return malformed('cache files could not be enumerated');
  if (cacheFiles.length !== 1 || cacheFiles[0] !== expectedCachePath) {
    return malformed('receipt present but the cached selection chain is missing or conflicting');
  }

  const cacheRead = readBoundedNativeFile(expectedCachePath, MAX_CACHE_BYTES, uid, FILE_MODE);
  if (!cacheRead.ok) return malformed(cacheRead.message);
  const cacheParse = parseManifestNativeCache(cacheRead.text);
  if (!cacheParse.ok) return malformed(`cache is invalid (${cacheParse.code}): ${cacheParse.message}`);
  const verified = verify({
    keyringText: cacheParse.value.keyringText,
    channelText: cacheParse.value.channelText,
    releaseText: cacheParse.value.releaseManifestText,
  });
  if (!verified.ok) return malformed(`cached selection chain failed installed-evidence verification (${verified.code}): ${verified.message}`);
  // Cache path must equal the path derived from the VERIFIED identity (§11).
  const verifiedCachePath = deriveCachePath(layout, verified.value.channel.releaseId, verified.value.releaseManifestSha256);
  if (verifiedCachePath === null || verifiedCachePath !== expectedCachePath) {
    return malformed('cached selection identity does not match its canonical path');
  }

  if (!packagesPresent) return malformed('receipt present but the packages namespace is absent');
  const packages = inspectPackagesRoot(layout, uid);
  if (!packages.ok) return malformed(packages.reason);
  const expectedTreeRoot = derivePackageRoot(layout, gateway.packageTreeSha256);
  if (expectedTreeRoot === null) return malformed('receipt package-tree digest cannot derive a canonical package root');
  const treeDirs = collectTreeDirs(layout);
  if (treeDirs === null) return malformed('package trees could not be enumerated');
  if (treeDirs.length !== 1 || treeDirs[0] !== expectedTreeRoot) {
    return malformed('receipt present but the installed package tree is missing or conflicting');
  }

  const treeCheck = checkNativeObject(expectedTreeRoot, uid, 'directory', DIR_MODE);
  if (!treeCheck.ok) return malformed(treeCheck.message);
  const treeDigest = await hashPackageTree(expectedTreeRoot);
  if (!treeDigest.ok) return malformed(`installed package tree failed verification (${treeDigest.code}): ${treeDigest.message}`);
  const packageIdentity = readPackageIdentity(expectedTreeRoot);
  if (packageIdentity === null) return malformed('installed package tree does not expose a valid package identity');

  const reconciled = reconcileManifestNativeInstallation({
    receipt,
    selection: verified.value,
    layout,
    hostLane,
    verifiedPackageTreeSha256: treeDigest.value,
    packageIdentity,
    requireInstalledEvidence,
  });
  if (!reconciled.ok) return malformed(`reconciliation failed (${reconciled.code}): ${reconciled.message}`);
  return { kind: 'VALID_MANIFEST_NATIVE_INSTALLATION', installation: reconciled.value };
}

/** All cache files in the manifests namespace, in enumeration order. */
function collectCacheFiles(layout: ManifestNativeLayout): string[] | null {
  const files: string[] = [];
  let names: string[];
  try {
    names = readdirSync(layout.manifestsRoot);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!RELEASE_ID_RE.test(name)) continue;
    let inner: string[];
    try {
      inner = readdirSync(join(layout.manifestsRoot, name));
    } catch {
      return null;
    }
    for (const file of inner) {
      if (CACHE_FILE_RE.test(file)) files.push(join(layout.manifestsRoot, name, file));
    }
  }
  return files;
}

/** All tree directories under packages/sha256, in enumeration order. */
function collectTreeDirs(layout: ManifestNativeLayout): string[] | null {
  let names: string[];
  try {
    names = readdirSync(layout.packagesSha256Root);
  } catch {
    return null;
  }
  const dirs: string[] = [];
  for (const name of names) {
    if (SHA256_HEX_RE.test(name)) dirs.push(join(layout.packagesSha256Root, name));
  }
  return dirs;
}
