/**
 * Manifest-native pure reconciliation (NEW-STATE Slice A). A parsed
 * receipt alone is NOT a reconciled installation: reconciliation requires
 * exact agreement between the parsed Schema-1 receipt, the
 * installed-evidence-verified cached selection, the canonical layout
 * derivation, and the verified package-tree result — then produces a
 * branded runtime-provenance value that only this boundary can construct.
 *
 * Every binding is cryptographic/derived, never textual: digests are
 * recomputed by the trust verifier, paths are re-derived from identity
 * components, and the compiled production policy re-gates lane/protocol/
 * package/bin compatibility (defense in depth: a selection verified under
 * any non-production policy still cannot reconcile).
 */
import { GATEWAY_TRUST_POLICY, requireVerifiedInstalledEvidence as productionRequireInstalledEvidence } from '../installer/release/trust.js';
import type { TrustResult, VerifiedInstalledEvidence } from '../installer/release/trust.js';
import type { PackageIdentity } from '../installer/artifact.js';
import type { ManifestNativeLayout } from '../host/environment.js';
import type { ParsedManifestNativeReceipt } from './receipt.js';
import { deriveBinPath, derivePackageRoot } from './paths.js';

const reconciledType: unique symbol = Symbol('ReconciledManifestNativeInstallation');

/**
 * Private runtime authority for reconciled output (F-01 correction).
 * Only reconcileManifestNativeInstallation() adds to this set, so only it
 * can produce a runtime-recognized reconciled installation. No public
 * check API is exposed in this slice; a narrow require function for
 * Slice-B consumers can be added later without any new authority seam.
 */
const reconciledAuthority = new WeakSet<object>();

/**
 * Runtime-provenance value. Branded AND registered in the private
 * reconciledAuthority set by reconcileManifestNativeInstallation() only.
 * This is the value a future doctor/start consumer is expected to
 * require; a narrow runtime check API for it is deferred to Slice B.
 */
export interface ReconciledManifestNativeInstallation {
  readonly [reconciledType]: true;
  readonly receipt: ParsedManifestNativeReceipt;
  readonly selection: VerifiedInstalledEvidence;
  readonly hostLane: string;
  /** Derived canonical package root (equals receipt.gateway.packageRoot). */
  readonly packageRoot: string;
  /** Derived canonical bin path (equals receipt.gateway.binPath). */
  readonly binPath: string;
  readonly packageTreeSha256: string;
  readonly packageIdentity: PackageIdentity;
}

export type ReconciliationResult =
  | { readonly ok: true; readonly value: ReconciledManifestNativeInstallation }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface ReconciliationInput {
  readonly receipt: ParsedManifestNativeReceipt;
  readonly selection: VerifiedInstalledEvidence;
  readonly layout: ManifestNativeLayout;
  readonly hostLane: string;
  /** Result of hashing the installed package tree (verified content). */
  readonly verifiedPackageTreeSha256: string;
  /** Identity read from the verified installed package tree. */
  readonly packageIdentity: PackageIdentity;
  /**
   * Installed-evidence runtime provenance gate (F-01). Default: the
   * production trust boundary. Tests inject the fixture verifier instance
   * that produced `selection`. Production callers must NOT pass this.
   */
  readonly requireInstalledEvidence?: (value: unknown) => TrustResult<VerifiedInstalledEvidence>;
}

function fail(code: string, message: string): ReconciliationResult {
  return { ok: false, code, message };
}

/** Reconcile receipt + verified cached selection + layout + verified tree. */
export function reconcileManifestNativeInstallation(input: ReconciliationInput): ReconciliationResult {
  // F-01: runtime provenance first — a valid-looking receipt/cache/tree
  // must never compensate for forged verifier authority. The selection is
  // consumed from the provenance-gate result, never from the raw input.
  const requireInstalledEvidence = input.requireInstalledEvidence ?? productionRequireInstalledEvidence;
  const provenSelection = requireInstalledEvidence(input.selection);
  if (!provenSelection.ok) {
    return fail(provenSelection.code, `installed evidence lacks runtime verifier provenance (${provenSelection.code}): ${provenSelection.message}`);
  }
  const selection = provenSelection.value;
  const gateway = input.receipt.gateway;
  const release = selection.release;

  // --- release identity binding (§11): receipt == channel == release ---
  if (gateway.releaseId !== selection.channel.releaseId) {
    return fail('ERR-MN-RECEIPT-RELEASE-ID', 'receipt releaseId does not match the verified cached channel releaseId');
  }
  if (gateway.releaseId !== release.releaseId) {
    return fail('ERR-MN-RECEIPT-RELEASE-ID', 'receipt releaseId does not match the signed release manifest releaseId');
  }
  if (gateway.releaseManifestSha256 !== selection.releaseManifestSha256) {
    return fail('ERR-MN-RECEIPT-MANIFEST-DIGEST', 'receipt release-manifest digest does not match the recomputed verified digest');
  }

  // --- package-tree binding (§12): receipt == signed release == verified tree ---
  if (gateway.packageTreeSha256 !== release.packageTreeSha256) {
    return fail('ERR-MN-RECEIPT-TREE-DIGEST', 'receipt package-tree digest does not match the signed release declaration');
  }
  if (gateway.packageTreeSha256 !== input.verifiedPackageTreeSha256) {
    return fail('ERR-MN-TREE-DIGEST', 'receipt package-tree digest does not match the verified installed tree');
  }

  // --- lane binding: receipt == host lane, signed release supports it ---
  if (gateway.selectedLane !== input.hostLane) {
    return fail('ERR-MN-HOST-LANE', 'receipt selectedLane does not match the current host lane');
  }
  if (!release.supportedLanes.includes(input.hostLane)) {
    return fail('ERR-MN-RELEASE-LANE', 'the signed release does not support the current host lane');
  }

  // --- compiled-policy compatibility (protocols, lane contract) ---
  const contract = GATEWAY_TRUST_POLICY.laneContracts[input.hostLane];
  if (contract === undefined) {
    return fail('ERR-MN-LANE-POLICY', 'the current host lane is not a compiled supported lane');
  }
  if (contract.packageName !== release.packageName || contract.binName !== release.binName) {
    return fail('ERR-MN-PACKAGE-CONTRACT', 'signed package/bin contract does not match the compiled lane contract');
  }
  if (!GATEWAY_TRUST_POLICY.supportedInstallProtocols.includes(release.installProtocol)) {
    return fail('ERR-MN-INSTALL-PROTOCOL', 'signed install protocol is not supported by the compiled policy');
  }
  if (!GATEWAY_TRUST_POLICY.supportedRuntimeProtocols.includes(release.runtimeProtocol)) {
    return fail('ERR-MN-RUNTIME-PROTOCOL', 'signed runtime protocol is not supported by the compiled policy');
  }

  // --- canonical layout derivation (§12): never trust the stored path text ---
  const derivedPackageRoot = derivePackageRoot(input.layout, gateway.packageTreeSha256);
  if (derivedPackageRoot === null || derivedPackageRoot !== gateway.packageRoot) {
    return fail('ERR-MN-PACKAGE-ROOT', 'receipt packageRoot does not equal the derived content-address path');
  }

  // --- verified package identity vs signed package/bin declaration ---
  if (input.packageIdentity.name !== release.packageName) {
    return fail('ERR-MN-PACKAGE-NAME', 'verified package name does not match the signed release declaration');
  }
  if (input.packageIdentity.version !== release.version) {
    return fail('ERR-MN-PACKAGE-VERSION', 'verified package version does not match the signed release declaration');
  }
  const binEntry = input.packageIdentity.bin[release.binName];
  if (binEntry === undefined) {
    return fail('ERR-MN-PACKAGE-BIN', 'verified package does not declare the signed bin name');
  }
  const derivedBinPath = deriveBinPath(gateway.packageRoot, binEntry);
  if (derivedBinPath === null || derivedBinPath !== gateway.binPath) {
    return fail('ERR-MN-BIN-PATH', 'receipt binPath does not equal the derived in-package bin path');
  }

  const value = Object.freeze({
    receipt: input.receipt,
    selection,
    hostLane: input.hostLane,
    packageRoot: derivedPackageRoot,
    binPath: derivedBinPath,
    packageTreeSha256: gateway.packageTreeSha256,
    packageIdentity: input.packageIdentity,
  }) as ReconciledManifestNativeInstallation;
  reconciledAuthority.add(value);
  return { ok: true, value };
}
