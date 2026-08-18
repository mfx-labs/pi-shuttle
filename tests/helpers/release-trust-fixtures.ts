/** Test-only Ed25519 material and signed Gateway release metadata. */
import { createPrivateKey, sign } from 'node:crypto';
import { canonicalSha256, canonicalBytes, GATEWAY_TRUST_POLICY } from '../../src/installer/release/trust.js';
import { createTrustVerifier, protectedSigningValue } from '../../src/installer/release/trust-internal.js';
import type { DocumentKind, GatewayTrustPolicy, TrustVerifier } from '../../src/installer/release/trust-internal.js';

export const FIXTURE_ROOT_KEY_ID = 'pgw-fixture-root-01';
export const FIXTURE_RELEASE_KEY_ID = 'pgw-fixture-release-01';
export const FIXTURE_REVOKED_KEY_ID = 'pgw-fixture-revoked-01';

const ROOT_PRIVATE = 'MC4CAQAwBQYDK2VwBCIEIEPXbdJoWog+6A9MI3TTUJEuGSThDwjNTxLJv4WqFso0';
export const FIXTURE_ROOT_PUBLIC = 'MCowBQYDK2VwAyEAZv8hf/jP1Mtyw2qVS7FJHXkRs5DCr/NVn0sVwBXTDi4=';
const RELEASE_PRIVATE = 'MC4CAQAwBQYDK2VwBCIEIII+X7Apu/42/Rpm1lH58my+19yFDN8iJblJDSYhnIRO';
export const FIXTURE_RELEASE_PUBLIC = 'MCowBQYDK2VwAyEAqEanfDCPBt+YfXDRaLdHdqnk8l4G2iixeC5VgMRzA1s=';
const REVOKED_PRIVATE = 'MC4CAQAwBQYDK2VwBCIEIG2j7YYYJyWWQA5+d69u5rFsRQYsRt7b7SMpe/AQ4WiB';
export const FIXTURE_REVOKED_PUBLIC = 'MCowBQYDK2VwAyEAkpWyePNGB4uQDLJdSJwZz27lXOVgw3G2ucwRUgoublI=';

const privateKey = (value: string) => createPrivateKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'pkcs8' });

export const FIXTURE_POLICY: GatewayTrustPolicy = Object.freeze({
  ...GATEWAY_TRUST_POLICY,
  rootKeyId: FIXTURE_ROOT_KEY_ID,
  rootPublicKey: FIXTURE_ROOT_PUBLIC,
});

export const FIXTURE_NOW = new Date('2027-01-01T00:00:00.000Z');

/** Separate test-only authority instance; never exported by the production trust module. */
export function fixtureVerifier(now: unknown = FIXTURE_NOW): TrustVerifier {
  const clockValue = now instanceof Date ? new Date(now.getTime()) : now;
  return createTrustVerifier(FIXTURE_POLICY, () => clockValue);
}

export function signedDocument(payload: unknown, kind: DocumentKind, keyId: string, privateDer: string, indent?: number): string {
  const protectedValue = protectedSigningValue(kind, keyId, payload);
  return JSON.stringify({
    payload,
    signature: { keyId, value: sign(null, canonicalBytes(protectedValue), privateKey(privateDer)).toString('base64') },
  }, null, indent);
}

export function keyringPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    generation: 2,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    keys: [
      { keyId: FIXTURE_RELEASE_KEY_ID, publicKey: FIXTURE_RELEASE_PUBLIC, status: 'active', roles: ['channel', 'release'] },
      { keyId: FIXTURE_REVOKED_KEY_ID, publicKey: FIXTURE_REVOKED_PUBLIC, status: 'revoked', roles: ['channel', 'release'] },
    ],
  };
}

export function gatewayReleasePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    releaseId: 'gateway-macos-release-001',
    component: 'gateway',
    repository: 'mfx-labs/project-gateway-macos',
    packageName: '@project-gateway/macos-core',
    version: '0.1.1',
    sourceCommit: 'a'.repeat(40),
    artifactFileName: 'project-gateway-macos-core-0.1.1.tgz',
    artifactSha256: 'b'.repeat(64),
    packageTreeSha256: 'c'.repeat(64),
    binName: 'project-gateway-macos-mcp',
    supportedLanes: ['darwin-x86_64-posix-utf8-node22'],
    installProtocol: 1,
    runtimeProtocol: 1,
    dependencies: { ajv: '8.20.0', zod: '4.4.3' },
    upgradePolicy: { acceptedPredecessorReleaseIds: ['gateway-macos-release-000'], rollback: 'immediate-predecessor' },
    ...overrides,
  };
}

export function signedKeyring(payload = keyringPayload()): string {
  return signedDocument(payload, 'keyring', FIXTURE_ROOT_KEY_ID, ROOT_PRIVATE);
}

export function signedGatewayRelease(payload = gatewayReleasePayload(), keyId = FIXTURE_RELEASE_KEY_ID, privateDer = RELEASE_PRIVATE, indent?: number): string {
  return signedDocument(payload, 'gateway-release', keyId, privateDer, indent);
}

export function signedStableChannel(releaseText: string, overrides: Record<string, unknown> = {}, keyId = FIXTURE_RELEASE_KEY_ID, privateDer = RELEASE_PRIVATE): string {
  const releaseDocument = JSON.parse(releaseText) as unknown;
  const release = (releaseDocument as { payload: { releaseId: string } }).payload;
  return signedDocument({
    schemaVersion: 1,
    channel: 'stable',
    releaseId: release.releaseId,
    releaseManifestSha256: canonicalSha256(releaseDocument),
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    ...overrides,
  }, 'channel', keyId, privateDer);
}

export const fixturePrivateKeys = Object.freeze({ root: ROOT_PRIVATE, release: RELEASE_PRIVATE, revoked: REVOKED_PRIVATE });
