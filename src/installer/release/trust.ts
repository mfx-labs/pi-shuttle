/**
 * Production Gateway release-manifest trust boundary. Public verification
 * always uses the compiled root/protocol policy and the system clock.
 * No fetching, installation, receipt, or filesystem mutation belongs here.
 */
import {
  CHANNEL_SCHEMA_VERSION,
  createTrustVerifier,
  GATEWAY_RELEASE_SCHEMA_VERSION,
  KEYRING_SCHEMA_VERSION,
} from './trust-internal.js';
import type {
  GatewayTrustPolicy,
  TrustResult,
  VerifiedChannel,
  VerifiedGatewayRelease,
  VerifiedKeyring,
  VerifiedReleaseSelection,
} from './trust-internal.js';
import type { InstalledEvidence, VerifiedInstalledEvidence } from './trust-internal.js';

export {
  canonicalBytes,
  canonicalSha256,
  canonicalizeJcs,
  CHANNEL_SCHEMA_VERSION,
  GATEWAY_RELEASE_SCHEMA_VERSION,
  KEYRING_SCHEMA_VERSION,
  MAX_METADATA_BYTES,
  RELEASE_TRUST_DOMAIN,
} from './trust-internal.js';
export type {
  DocumentKind,
  GatewayPackageContract,
  GatewayTrustPolicy,
  InstalledEvidence,
  Signature,
  SignedDocument,
  SigningKey,
  TrustErrorCode,
  TrustResult,
  UpgradePolicy,
  VerifiedChannel,
  VerifiedGatewayRelease,
  VerifiedInstalledEvidence,
  VerifiedKeyring,
  VerifiedReleaseSelection,
} from './trust-internal.js';

/** Stable compiled trust/protocol policy; contains no Gateway release identity. */
export const GATEWAY_TRUST_POLICY: GatewayTrustPolicy = Object.freeze({
  rootKeyId: 'pgw-root-2026-01',
  rootPublicKey: 'MCowBQYDK2VwAyEAzR+q5eDjA+KXrwkw1sPlKBOBQcnhkdv9mI+PX0kZl4Y=',
  supportedKeyringSchemas: Object.freeze([KEYRING_SCHEMA_VERSION]),
  supportedChannelSchemas: Object.freeze([CHANNEL_SCHEMA_VERSION]),
  supportedReleaseSchemas: Object.freeze([GATEWAY_RELEASE_SCHEMA_VERSION]),
  supportedInstallProtocols: Object.freeze([1]),
  supportedRuntimeProtocols: Object.freeze([1]),
  laneContracts: Object.freeze({
    'linux-x86_64-posix-utf8-node22': Object.freeze({ packageName: '@project-gateway/artifact-core', binName: 'project-gateway-mcp' }),
    'darwin-arm64-posix-utf8-node22': Object.freeze({ packageName: '@project-gateway/macos-core', binName: 'project-gateway-macos-mcp' }),
    'darwin-x86_64-posix-utf8-node22': Object.freeze({ packageName: '@project-gateway/macos-core', binName: 'project-gateway-macos-mcp' }),
  }),
});

const productionVerifier = createTrustVerifier(GATEWAY_TRUST_POLICY, () => new Date());

export function verifyRootSignedKeyring(text: string): TrustResult<VerifiedKeyring> {
  return productionVerifier.verifyRootSignedKeyring(text);
}

export function verifyChannelManifest(text: string, keyring: VerifiedKeyring): TrustResult<VerifiedChannel> {
  return productionVerifier.verifyChannelManifest(text, keyring);
}

export function verifyGatewayReleaseManifest(text: string, keyring: VerifiedKeyring): TrustResult<VerifiedGatewayRelease> {
  return productionVerifier.verifyGatewayReleaseManifest(text, keyring);
}

export function verifyReleaseSelection(channel: VerifiedChannel, releaseText: string, keyring: VerifiedKeyring): TrustResult<VerifiedReleaseSelection> {
  return productionVerifier.verifyReleaseSelection(channel, releaseText, keyring);
}

/**
 * Installed-evidence verification purpose (NEW-STATE Slice A): verifies a
 * cached signed selection chain against the compiled policy WITHOUT the
 * keyring/channel expiration liveness gate. This is a narrow offline
 * purpose for locally cached metadata only — it never weakens
 * fresh-selection verification, never fetches network revocation, and is
 * bound to the exact cached root-signed keyring snapshot. The result is
 * branded VerifiedInstalledEvidence and is NOT a fresh-selection
 * authority.
 */
export function verifyInstalledEvidence(input: InstalledEvidence): TrustResult<VerifiedInstalledEvidence> {
  return productionVerifier.verifyInstalledEvidence(input);
}

/**
 * Narrow production provenance gate (NEW-STATE Slice A correction):
 * accepts ONLY values produced by the fixed production verifier's
 * verifyReleaseSelection(). Rejects structural lookalikes, casts,
 * copies, JSON round-trips, test/fixture verifier output, and any other
 * verifier instance. This is the ONLY provenance API exported here — no
 * runtime-authority-set access, no mutation, no verifier construction,
 * no policy/clock/root override is exposed.
 */
export function requireVerifiedReleaseSelection(value: unknown): TrustResult<VerifiedReleaseSelection> {
  return productionVerifier.requireVerifiedReleaseSelection(value);
}

/**
 * Narrow production provenance gate (NEW-STATE Slice A correction):
 * accepts ONLY values produced by the fixed production verifier's
 * verifyInstalledEvidence(). Rejects structural lookalikes, casts,
 * copies, JSON round-trips, test/fixture verifier output, and any other
 * verifier instance.
 */
export function requireVerifiedInstalledEvidence(value: unknown): TrustResult<VerifiedInstalledEvidence> {
  return productionVerifier.requireVerifiedInstalledEvidence(value);
}
