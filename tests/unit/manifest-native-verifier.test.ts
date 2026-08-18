/** NEW-STATE Slice A — installed-evidence verification purpose tests (trust boundary). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as productionTrust from '../../src/installer/release/trust.js';
import { createTrustVerifier } from '../../src/installer/release/trust-internal.js';
import type { TrustVerifier } from '../../src/installer/release/trust-internal.js';
import {
  FIXTURE_POLICY,
  FIXTURE_RELEASE_KEY_ID,
  FIXTURE_REVOKED_KEY_ID,
  fixturePrivateKeys,
  fixtureVerifier,
  gatewayReleasePayload,
  keyringPayload,
  signedGatewayRelease,
  signedKeyring,
  signedStableChannel,
} from '../helpers/release-trust-fixtures.js';

function errorCode(result: { readonly ok: boolean; readonly code?: string }): string {
  assert.equal(result.ok, false);
  return result.ok ? '' : result.code!;
}

function chain(verifier: TrustVerifier, releaseText = signedGatewayRelease(), channelOverrides: Record<string, unknown> = {}, keyringPayloadOverride?: Record<string, unknown>): { input: { keyringText: string; channelText: string; releaseText: string }; releaseText: string } {
  const keyringText = signedKeyring(keyringPayloadOverride);
  const channelText = signedStableChannel(releaseText, channelOverrides);
  return { input: { keyringText, channelText, releaseText }, releaseText };
}

test('installed-evidence: valid cached chain succeeds offline', () => {
  const verifier = fixtureVerifier();
  const { input } = chain(verifier);
  const result = verifier.verifyInstalledEvidence(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.releaseManifestSha256.length, 64);
  assert.equal(result.value.channel.releaseId, result.value.release.releaseId);
  assert.equal(Object.isFrozen(result.value), true);
});

test('installed-evidence: expired keyring/channel still succeeds; fresh selection rejects (regression)', () => {
  // Wall clock far beyond the keyring/channel expiry (2028-01-01).
  const expiredNow = new Date('2035-06-01T00:00:00.000Z');
  const verifier = fixtureVerifier(expiredNow);
  const { input } = chain(verifier);
  const installed = verifier.verifyInstalledEvidence(input);
  assert.equal(installed.ok, true, 'installed evidence must not use expiration as a liveness gate');
  // The SAME expired keyring must fail the fresh root-signed keyring path.
  const keyringResult = verifier.verifyRootSignedKeyring(input.keyringText);
  assert.equal(keyringResult.ok, false);
  assert.equal(keyringResult.ok ? '' : keyringResult.code, 'ERR-TRUST-EXPIRED');
});

test('installed-evidence: far-future issuedAt is accepted structurally; fresh selection rejects (F-04)', () => {
  const releaseText = signedGatewayRelease();
  // Keyring/channel valid 2040-2045; fixture clock is 2027.
  const farFutureKeyring = signedKeyring({
    ...keyringPayload(),
    issuedAt: '2040-01-01T00:00:00.000Z',
    expiresAt: '2045-01-01T00:00:00.000Z',
  });
  const farFutureChannel = signedStableChannel(releaseText, {
    issuedAt: '2040-01-01T00:00:00.000Z',
    expiresAt: '2045-01-01T00:00:00.000Z',
  });
  const verifier = fixtureVerifier();
  const installed = verifier.verifyInstalledEvidence({ keyringText: farFutureKeyring, channelText: farFutureChannel, releaseText });
  assert.equal(installed.ok, true, 'installed evidence accepts structurally valid far-future metadata (no clock)');
  // Fresh selection on the same metadata rejects (not yet valid).
  const fresh = verifier.verifyRootSignedKeyring(farFutureKeyring);
  assert.equal(fresh.ok, false);
  assert.equal(fresh.ok ? '' : fresh.code, 'ERR-TRUST-FUTURE-ISSUED');
});

test('installed-evidence: fresh selection on expired metadata rejects via the production flow', () => {
  const expiredNow = new Date('2035-06-01T00:00:00.000Z');
  const verifier = fixtureVerifier(expiredNow);
  const keyringResult = verifier.verifyRootSignedKeyring(signedKeyring());
  assert.equal(keyringResult.ok, false);
  assert.equal(keyringResult.ok ? '' : keyringResult.code, 'ERR-TRUST-EXPIRED');
});

test('installed-evidence: invalid timestamp syntax and ordering reject', () => {
  const verifier = fixtureVerifier();
  const releaseText = signedGatewayRelease();
  const badSyntax = chain(verifier, releaseText, { issuedAt: '2027/01/01T00:00:00.000Z' });
  assert.equal(errorCode(verifier.verifyInstalledEvidence(badSyntax.input)), 'ERR-TRUST-CHANNEL-SCHEMA');
  const badOrder = chain(verifier, releaseText, { issuedAt: '2029-01-01T00:00:00.000Z', expiresAt: '2028-01-01T00:00:00.000Z' });
  assert.equal(errorCode(verifier.verifyInstalledEvidence(badOrder.input)), 'ERR-TRUST-TIMESTAMP');
  const sameInstant = chain(verifier, releaseText, { issuedAt: '2028-01-01T00:00:00.000Z', expiresAt: '2028-01-01T00:00:00.000Z' });
  assert.equal(errorCode(verifier.verifyInstalledEvidence(sameInstant.input)), 'ERR-TRUST-TIMESTAMP');
});

test('installed-evidence: wrong root key rejects', () => {
  const verifier = fixtureVerifier();
  const releaseText = signedGatewayRelease();
  // Keyring envelope signed under an unknown root key ID.
  const unknownRootKeyring = signedKeyring().replace('"pgw-fixture-root-01"', '"pgw-unknown-root-99"');
  const input = { keyringText: unknownRootKeyring, channelText: signedStableChannel(releaseText), releaseText };
  const result = verifier.verifyInstalledEvidence(input);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'ERR-TRUST-UNKNOWN-KEY');
});

test('installed-evidence: revoked signer inside the cached keyring rejects', () => {
  const verifier = fixtureVerifier();
  const releaseText = signedGatewayRelease();
  const revokedChannel = signedStableChannel(releaseText, {}, FIXTURE_REVOKED_KEY_ID, fixturePrivateKeys.revoked);
  const result = verifier.verifyInstalledEvidence({ keyringText: signedKeyring(), channelText: revokedChannel, releaseText });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'ERR-TRUST-REVOKED-KEY');
});

test('installed-evidence: wrong role rejects', () => {
  const verifier = fixtureVerifier();
  const releaseText = signedGatewayRelease();
  // A keyring whose only channel-capable key is release-role-only.
  const payload = keyringPayload();
  payload['keys'] = [
    { keyId: FIXTURE_RELEASE_KEY_ID, publicKey: (payload['keys'] as Array<{ publicKey: string }>)[0]!.publicKey, status: 'active', roles: ['release'] },
  ];
  const channelText = signedStableChannel(releaseText, {}, FIXTURE_RELEASE_KEY_ID, fixturePrivateKeys.release);
  const result = verifier.verifyInstalledEvidence({ keyringText: signedKeyring(payload), channelText, releaseText });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'ERR-TRUST-WRONG-ROLE');
});

test('installed-evidence: bad signature rejects', () => {
  const verifier = fixtureVerifier();
  const { input } = chain(verifier);
  // Flip the first base64 character of the CHANNEL signature (stays valid base64).
  const channel = JSON.parse(input.channelText) as { signature: { value: string } };
  const flipped = channel.signature.value[0] === 'A' ? `B${channel.signature.value.slice(1)}` : `A${channel.signature.value.slice(1)}`;
  const tamperedChannel = JSON.stringify({ ...JSON.parse(input.channelText), signature: { ...channel.signature, value: flipped } });
  const result = verifier.verifyInstalledEvidence({ ...input, channelText: tamperedChannel });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'ERR-TRUST-BAD-SIGNATURE');
});

test('installed-evidence: cross-document replay rejects', () => {
  const verifier = fixtureVerifier();
  // Release A channel + release B document: digest binding rejects.
  const releaseA = signedGatewayRelease({ ...gatewayReleasePayload(), releaseId: 'gateway-test-release-aaa', version: '1.0.0', sourceCommit: '1'.repeat(40), artifactFileName: 'a-1.0.0.tgz', artifactSha256: '1'.repeat(64), packageTreeSha256: '2'.repeat(64), upgradePolicy: { acceptedPredecessorReleaseIds: [], rollback: 'forbidden' } });
  const releaseB = signedGatewayRelease({ ...gatewayReleasePayload(), releaseId: 'gateway-test-release-bbb', version: '2.0.0', sourceCommit: '3'.repeat(40), artifactFileName: 'b-2.0.0.tgz', artifactSha256: '3'.repeat(64), packageTreeSha256: '4'.repeat(64), upgradePolicy: { acceptedPredecessorReleaseIds: ['gateway-test-release-aaa'], rollback: 'immediate-predecessor' } });
  const keyringText = signedKeyring();
  const channelForA = signedStableChannel(releaseA);
  let result = verifier.verifyInstalledEvidence({ keyringText, channelText: channelForA, releaseText: releaseB });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'ERR-TRUST-SELECTION-DIGEST');
  // Channel claims a different releaseId while the digest matches: binding rejects.
  const mismatchedChannel = signedStableChannel(releaseB, { releaseId: 'gateway-test-release-ccc' });
  result = verifier.verifyInstalledEvidence({ keyringText, channelText: mismatchedChannel, releaseText: releaseB });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'ERR-TRUST-SELECTION-RELEASE-ID');
});

test('installed-evidence: unsupported schema, protocol, lane, and package/bin contract reject', () => {
  const verifier = fixtureVerifier();
  const base = {
    keyringText: signedKeyring(),
  };
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ schemaVersion: 99 }, 'ERR-TRUST-COMPATIBILITY'],
    [{ installProtocol: 2 }, 'ERR-TRUST-UNSUPPORTED-PROTOCOL'],
    [{ runtimeProtocol: 2 }, 'ERR-TRUST-UNSUPPORTED-PROTOCOL'],
    [{ supportedLanes: ['not-a-lane-1'] }, 'ERR-TRUST-UNSUPPORTED-LANE'],
    [{ packageName: 'not-the-contract-package' }, 'ERR-TRUST-RELEASE-CONTRACT'],
    [{ binName: 'not-the-contract-bin' }, 'ERR-TRUST-RELEASE-CONTRACT'],
  ];
  for (const [overrides, code] of cases) {
    const releaseText = signedGatewayRelease({ ...gatewayReleasePayload(), packageName: '@project-gateway/macos-core', binName: 'project-gateway-macos-mcp', supportedLanes: ['darwin-x86_64-posix-utf8-node22'], ...overrides });
    const channelText = signedStableChannel(releaseText);
    const result = verifier.verifyInstalledEvidence({ ...base, channelText, releaseText });
    assert.equal(result.ok, false, `overrides ${JSON.stringify(Object.keys(overrides))} must reject`);
    assert.equal(result.ok ? '' : result.code, code, `overrides ${JSON.stringify(Object.keys(overrides))}`);
  }
});

test('installed-evidence: fixture policy cannot substitute production policy', () => {
  const { input } = chain(fixtureVerifier());
  const result = productionTrust.verifyInstalledEvidence(input);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.code, 'ERR-TRUST-UNKNOWN-KEY');
  // The production boundary exposes no arbitrary-policy construction.
  assert.equal(Object.hasOwn(productionTrust, 'createTrustVerifier'), false);
});

test('installed-evidence: static-only verification never consults the clock', () => {
  // A clock that throws must not matter: installed evidence has no clock.
  const brokenClockVerifier = createTrustVerifier(FIXTURE_POLICY, () => { throw new Error('clock unavailable'); });
  const { input } = chain(brokenClockVerifier);
  const result = brokenClockVerifier.verifyInstalledEvidence(input);
  assert.equal(result.ok, true, 'installed evidence must not require a clock');
});
