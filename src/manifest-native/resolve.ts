/**
 * Manifest-native lifecycle resolution boundary (NEW-STATE Slice B).
 *
 * The production resolution chain for a valid installation is exactly:
 *
 *   bounded receipt read
 *     -> cache path derivation
 *     -> cache verification (closed schema, duplicate-key rejection)
 *     -> installed-evidence cryptographic verification
 *     -> installed package-tree hash (deterministic, bounded, no-follow)
 *     -> reconciliation (exact receipt/cache/release/tree/lane/path binding)
 *     -> reconciled runtime provenance gate
 *
 * Allowed results remain exactly CLEAN / VALID / MALFORMED. No package
 * presence alone establishes an installation. The final runtime-consumable
 * value is the runtime-proven reconciled installation (exact object
 * identity in the private reconciledAuthority set).
 *
 * The optional `deps` argument is the established Slice-A test seam
 * (defaults: the production trust boundary); production callers never
 * pass it.
 */
import { lstatSync } from 'node:fs';
import type { ManifestNativeLayout } from '../host/environment.js';
import { requireReconciledManifestNativeInstallation } from './reconcile.js';
import type { ReconciledManifestNativeInstallation } from './reconcile.js';
import { isCanonicalAbsolutePath, isStrictDescendant } from './paths.js';
import { classifyManifestNativeState } from './state.js';
import type { ClassifyDependencies } from './state.js';

export type ManifestNativeResolution =
  | { readonly kind: 'CLEAN' }
  | { readonly kind: 'VALID'; readonly installation: ReconciledManifestNativeInstallation }
  | { readonly kind: 'MALFORMED'; readonly reason: string };

/** Resolve the manifest-native lifecycle (production defaults; deps = test seam). */
export async function resolveManifestNativeLifecycle(layout: ManifestNativeLayout, hostLane: string, deps: ClassifyDependencies = {}): Promise<ManifestNativeResolution> {
  const verdict = await classifyManifestNativeState(layout, hostLane, deps);
  if (verdict.kind === 'CLEAN') return { kind: 'CLEAN' };
  if (verdict.kind === 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE') {
    return { kind: 'MALFORMED', reason: verdict.reason };
  }
  // The classifier produced a reconciled value; prove its runtime
  // provenance before anything consumes it (defense in depth: only the
  // reconciliation boundary can register values).
  const gated = requireReconciledManifestNativeInstallation(verdict.installation);
  if (!gated.ok) {
    return { kind: 'MALFORMED', reason: `reconciled runtime provenance gate rejected the classified installation: ${gated.message}` };
  }
  return { kind: 'VALID', installation: gated.value };
}

export type RuntimeBinResult =
  | { readonly ok: true; readonly binPath: string }
  | { readonly ok: false; readonly code: 'ERR-MN-START-BIN' | 'ERR-MN-START-BIN-PATH' | 'ERR-MN-START-BIN-OWNER' | 'ERR-MN-START-BIN-MODE'; readonly message: string };

/**
 * Final runtime bin validation (Slice-B TOCTOU boundary). The complete
 * package tree was already verified by the resolver; this re-validates the
 * exact final bin immediately before spawn:
 *
 *   - canonical expected path (strict descendant of the confined package root);
 *   - regular file, not a symlink, not a special file;
 *   - owner == effective UID;
 *   - owner-private mode (no group/world read/write/execute bits).
 *
 * Per-file mode normalization belongs to the future fresh-install
 * materializer; doctor/start fail closed on unsafe existing modes here at
 * the consumption point. Residual race (reported honestly): Node offers no
 * dirfd-confined exec; between this validation and the spawn open a
 * same-user actor could still swap the file. Same-user actors can already
 * rewrite the package tree itself, so no authority is added by that
 * window; the tree digest remains the authenticated runtime integrity
 * unit.
 */
export function validateFinalBin(installation: ReconciledManifestNativeInstallation, uid: number): RuntimeBinResult {
  const binPath = installation.binPath;
  if (!isCanonicalAbsolutePath(binPath) || !isStrictDescendant(installation.packageRoot, binPath)) {
    return { ok: false, code: 'ERR-MN-START-BIN-PATH', message: `bin path is not a canonical path confined inside the package root: ${binPath}` };
  }
  let stat;
  try {
    stat = lstatSync(binPath);
  } catch (err) {
    return { ok: false, code: 'ERR-MN-START-BIN', message: `bin could not be inspected (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${binPath}` };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { ok: false, code: 'ERR-MN-START-BIN', message: `bin is not a regular file (symlink/special replaced): ${binPath}` };
  }
  if (stat.uid !== uid) {
    return { ok: false, code: 'ERR-MN-START-BIN-OWNER', message: `bin is not owned by the effective user: ${binPath}` };
  }
  if ((stat.mode & 0o077) !== 0) {
    return { ok: false, code: 'ERR-MN-START-BIN-MODE', message: `bin exposes group/world access (mode ${(stat.mode & 0o777).toString(8).padStart(4, '0')}); owner-private 0600 required: ${binPath}` };
  }
  return { ok: true, binPath };
}
