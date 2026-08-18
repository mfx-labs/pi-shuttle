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
  Signature,
  SignedDocument,
  SigningKey,
  TrustErrorCode,
  TrustResult,
  UpgradePolicy,
  VerifiedChannel,
  VerifiedGatewayRelease,
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
