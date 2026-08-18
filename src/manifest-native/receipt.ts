/**
 * Manifest-native receipt Schema 1 (NEW-STATE Slice A). A NEW closed
 * schema — deliberately unrelated to any previous installation-receipt
 * format. A parsed receipt is LOCAL EVIDENCE ONLY: it can never launch or
 * install anything. Only the reconciliation boundary
 * (reconcile.ts) produces a runtime-provenance installation value.
 *
 * Signed release facts (version, commit, artifact digest, protocols,
 * upgrade policy, ...) stay in the cached signed release manifest; the
 * receipt deliberately does not duplicate them.
 */
import { parseJsonRejectingDuplicates } from '../config/json.js';
import { canonicalizeJcs, GATEWAY_TRUST_POLICY, requireVerifiedInstalledEvidence as productionRequireInstalledEvidence, requireVerifiedReleaseSelection as productionRequireReleaseSelection } from '../installer/release/trust.js';
import type { TrustResult, VerifiedInstalledEvidence, VerifiedReleaseSelection } from '../installer/release/trust.js';
import type { PackageIdentity } from '../installer/artifact.js';
import type { ManifestNativeLayout } from '../host/environment.js';
import {
  deriveBinPath,
  derivePackageRoot,
  isCanonicalAbsolutePath,
  isStrictDescendant,
  RELEASE_ID_RE,
  SHA256_HEX_RE,
} from './paths.js';

export const RECEIPT_SCHEMA_VERSION = 1;
export const MANIFEST_NATIVE_LIFECYCLE = 'manifest-native';
/** Receipt document byte ceiling: 16 KiB. */
export const MAX_RECEIPT_BYTES = 16 * 1024;

const parsedReceiptType: unique symbol = Symbol('ParsedManifestNativeReceipt');

/** A parsed Schema-1 receipt. Branded: only parse/build can construct it. */
export interface ParsedManifestNativeReceipt {
  readonly [parsedReceiptType]: true;
  readonly schemaVersion: 1;
  readonly lifecycle: 'manifest-native';
  readonly gateway: {
    readonly releaseId: string;
    readonly releaseManifestSha256: string;
    readonly packageTreeSha256: string;
    readonly selectedLane: string;
    readonly packageRoot: string;
    readonly binPath: string;
  };
}

export type ReceiptResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

const RECEIPT_KEYS: readonly string[] = ['schemaVersion', 'lifecycle', 'gateway'];
const GATEWAY_KEYS: readonly string[] = ['releaseId', 'releaseManifestSha256', 'packageTreeSha256', 'selectedLane', 'packageRoot', 'binPath'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function closed(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> | null {
  if (!isRecord(value)) return null;
  return Object.keys(value).every((key) => allowed.includes(key)) ? value : null;
}

/** Parse Schema-1 receipt text. Duplicate keys (escaped-equivalent included) reject first. */
export function parseManifestNativeReceipt(text: string): ReceiptResult<ParsedManifestNativeReceipt> {
  if (Buffer.byteLength(text, 'utf8') > MAX_RECEIPT_BYTES) {
    return { ok: false, code: 'ERR-MN-RECEIPT-SIZE', message: `receipt exceeds the ${MAX_RECEIPT_BYTES}-byte ceiling` };
  }
  const parsed = parseJsonRejectingDuplicates(text);
  if (!parsed.ok) {
    return { ok: false, code: parsed.message.startsWith('duplicate object key') ? 'ERR-MN-RECEIPT-DUPLICATE-KEY' : 'ERR-MN-RECEIPT-JSON', message: parsed.message };
  }
  const root = closed(parsed.value, RECEIPT_KEYS);
  if (root === null) return { ok: false, code: 'ERR-MN-RECEIPT-SCHEMA', message: 'receipt has unknown fields or is not an object' };
  if (root['schemaVersion'] !== RECEIPT_SCHEMA_VERSION) return { ok: false, code: 'ERR-MN-RECEIPT-SCHEMA', message: `receipt schemaVersion must be exactly ${RECEIPT_SCHEMA_VERSION}` };
  if (root['lifecycle'] !== MANIFEST_NATIVE_LIFECYCLE) return { ok: false, code: 'ERR-MN-RECEIPT-SCHEMA', message: `receipt lifecycle must be exactly "${MANIFEST_NATIVE_LIFECYCLE}"` };
  const gateway = closed(root['gateway'], GATEWAY_KEYS);
  if (gateway === null) return { ok: false, code: 'ERR-MN-RECEIPT-SCHEMA', message: 'receipt.gateway has unknown fields or is not an object' };

  const releaseId = gateway['releaseId'];
  const releaseManifestSha256 = gateway['releaseManifestSha256'];
  const packageTreeSha256 = gateway['packageTreeSha256'];
  const selectedLane = gateway['selectedLane'];
  const packageRoot = gateway['packageRoot'];
  const binPath = gateway['binPath'];
  if (typeof releaseId !== 'string' || !RELEASE_ID_RE.test(releaseId)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-RELEASE-ID', message: 'receipt releaseId does not match the accepted release-ID grammar' };
  }
  if (typeof releaseManifestSha256 !== 'string' || !SHA256_HEX_RE.test(releaseManifestSha256)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-SHA', message: 'receipt releaseManifestSha256 must be lowercase 64-hex' };
  }
  if (typeof packageTreeSha256 !== 'string' || !SHA256_HEX_RE.test(packageTreeSha256)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-SHA', message: 'receipt packageTreeSha256 must be lowercase 64-hex' };
  }
  if (typeof selectedLane !== 'string' || !Object.hasOwn(GATEWAY_TRUST_POLICY.laneContracts, selectedLane)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-LANE', message: 'receipt selectedLane is not one of the compiled supported lanes' };
  }
  if (typeof packageRoot !== 'string' || !isCanonicalAbsolutePath(packageRoot)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-PATH', message: 'receipt packageRoot must be a canonical absolute path' };
  }
  if (typeof binPath !== 'string' || !isCanonicalAbsolutePath(binPath) || !isStrictDescendant(packageRoot, binPath)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-PATH', message: 'receipt binPath must be a canonical absolute path strictly inside packageRoot' };
  }

  const value = Object.freeze({
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    lifecycle: MANIFEST_NATIVE_LIFECYCLE,
    gateway: Object.freeze({
      releaseId,
      releaseManifestSha256,
      packageTreeSha256,
      selectedLane,
      packageRoot,
      binPath,
    }),
  }) as ParsedManifestNativeReceipt;
  return { ok: true, value };
}

/** Deterministic serialization: canonical JCS with exactly one trailing newline. */
export function serializeManifestNativeReceipt(receipt: ParsedManifestNativeReceipt): string {
  const gateway = receipt.gateway;
  return `${canonicalizeJcs({
    schemaVersion: receipt.schemaVersion,
    lifecycle: receipt.lifecycle,
    gateway: {
      releaseId: gateway.releaseId,
      releaseManifestSha256: gateway.releaseManifestSha256,
      packageTreeSha256: gateway.packageTreeSha256,
      selectedLane: gateway.selectedLane,
      packageRoot: gateway.packageRoot,
      binPath: gateway.binPath,
    },
  })}\n`;
}

export type ReceiptBuildResult = { readonly ok: true; readonly receipt: ParsedManifestNativeReceipt } | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Runtime-provenance dependencies for receipt construction. Defaults are
 * the production trust boundary; tests inject the matching fixture
 * verifier instance. Production callers must NOT pass these.
 */
export interface ReceiptBuildDependencies {
  readonly requireReleaseSelection?: (value: unknown) => TrustResult<VerifiedReleaseSelection>;
  readonly requireInstalledEvidence?: (value: unknown) => TrustResult<VerifiedInstalledEvidence>;
}

/**
 * Narrow receipt construction boundary. The receipt is generated ONLY
 * from:
 *   - a VerifiedReleaseSelection / VerifiedInstalledEvidence produced by
 *     the trust architecture (release ID, manifest digest, package/bin
 *     contract);
 *   - canonical installer-derived layout paths (package root from the
 *     content-address key, bin path from the verified package `bin`);
 *   - a verified package-tree identity (digest + package.json identity).
 *
 * RUNTIME PROVENANCE (F-01): before any authoritative release field is
 * read, the supplied selection must pass the verifier-owned runtime
 * provenance gate for its declared purpose — fresh-selection authority
 * for VerifiedReleaseSelection, installed-evidence authority for
 * VerifiedInstalledEvidence. Structural lookalikes, casts, copies, JSON
 * round-trips, cross-verifier values, and cross-purpose values are
 * rejected with ERR-TRUST-AUTHORITY; authority is never reconstructed
 * from object contents.
 *
 * Caller input cannot directly populate authoritative receipt fields:
 * paths are re-derived, digests re-validated, and the signed contract is
 * re-checked against the compiled policy before anything is recorded.
 */
export function buildManifestNativeReceipt(
  input: {
    readonly selection: VerifiedReleaseSelection | VerifiedInstalledEvidence;
    readonly layout: ManifestNativeLayout;
    readonly hostLane: string;
    readonly packageTreeSha256: string;
    readonly packageIdentity: PackageIdentity;
  },
  deps: ReceiptBuildDependencies = {},
): ReceiptBuildResult {
  const requireReleaseSelection = deps.requireReleaseSelection ?? productionRequireReleaseSelection;
  const requireInstalledEvidence = deps.requireInstalledEvidence ?? productionRequireInstalledEvidence;
  // Provenance first: fresh-selection authority, else installed-evidence
  // authority, else fail closed. Never reconstruct authority from fields.
  const fresh = requireReleaseSelection(input.selection);
  let selection: VerifiedReleaseSelection | VerifiedInstalledEvidence;
  if (fresh.ok) {
    selection = fresh.value;
  } else {
    const installed = requireInstalledEvidence(input.selection);
    if (!installed.ok) {
      return { ok: false, code: 'ERR-TRUST-AUTHORITY', message: 'release selection lacks runtime verifier provenance for receipt construction' };
    }
    selection = installed.value;
  }
  const release = selection.release;
  if (!SHA256_HEX_RE.test(input.packageTreeSha256)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-SHA', message: 'verified package-tree digest must be lowercase 64-hex' };
  }
  if (input.packageTreeSha256 !== release.packageTreeSha256) {
    return { ok: false, code: 'ERR-MN-RECEIPT-TREE-BINDING', message: 'verified package-tree digest does not match the signed release declaration' };
  }
  const contract = GATEWAY_TRUST_POLICY.laneContracts[input.hostLane];
  if (contract === undefined || !release.supportedLanes.includes(input.hostLane)) {
    return { ok: false, code: 'ERR-MN-RECEIPT-LANE', message: 'host lane is not supported by the signed release' };
  }
  if (contract.packageName !== release.packageName || contract.binName !== release.binName) {
    return { ok: false, code: 'ERR-MN-RECEIPT-CONTRACT', message: 'signed package/bin contract does not match the compiled lane contract' };
  }
  if (input.packageIdentity.name !== release.packageName || input.packageIdentity.version !== release.version) {
    return { ok: false, code: 'ERR-MN-RECEIPT-PACKAGE', message: 'verified package identity does not match the signed release declaration' };
  }
  const binEntry = input.packageIdentity.bin[release.binName];
  if (binEntry === undefined) {
    return { ok: false, code: 'ERR-MN-RECEIPT-PACKAGE', message: 'verified package does not declare the signed bin name' };
  }
  const packageRoot = derivePackageRoot(input.layout, input.packageTreeSha256);
  if (packageRoot === null) {
    return { ok: false, code: 'ERR-MN-RECEIPT-SHA', message: 'package-root content-address key is not canonical' };
  }
  const binPath = deriveBinPath(packageRoot, binEntry);
  if (binPath === null) {
    return { ok: false, code: 'ERR-MN-RECEIPT-PATH', message: 'signed bin entry cannot be a canonical in-package path' };
  }
  return {
    ok: true,
    receipt: Object.freeze({
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      lifecycle: MANIFEST_NATIVE_LIFECYCLE,
      gateway: Object.freeze({
        releaseId: selection.channel.releaseId,
        releaseManifestSha256: selection.releaseManifestSha256,
        packageTreeSha256: input.packageTreeSha256,
        selectedLane: input.hostLane,
        packageRoot,
        binPath,
      }),
    }) as ParsedManifestNativeReceipt,
  };
}
