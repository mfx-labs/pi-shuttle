/** Focused SLICE 1 tests: authenticated keyring, channel, and Gateway release trust. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as productionTrust from '../../src/installer/release/trust.js';
import {
  canonicalizeJcs,
  GATEWAY_TRUST_POLICY,
  verifyGatewayReleaseManifest as verifyProductionRelease,
  verifyRootSignedKeyring as verifyProductionKeyring,
} from '../../src/installer/release/trust.js';
import type { VerifiedChannel, VerifiedGatewayRelease, VerifiedKeyring } from '../../src/installer/release/trust.js';
import { createTrustVerifier } from '../../src/installer/release/trust-internal.js';
import type { TrustVerifier } from '../../src/installer/release/trust-internal.js';
import {
  FIXTURE_NOW,
  FIXTURE_POLICY,
  FIXTURE_RELEASE_KEY_ID,
  FIXTURE_RELEASE_PUBLIC,
  FIXTURE_REVOKED_KEY_ID,
  FIXTURE_REVOKED_PUBLIC,
  fixturePrivateKeys,
  fixtureVerifier,
  gatewayReleasePayload,
  keyringPayload,
  signedDocument,
  signedGatewayRelease,
  signedKeyring,
  signedStableChannel,
} from '../helpers/release-trust-fixtures.js';

function authority(now: unknown = FIXTURE_NOW, payload = keyringPayload()): { verifier: TrustVerifier; keyring: VerifiedKeyring } {
  const verifier = fixtureVerifier(now);
  const result = verifier.verifyRootSignedKeyring(signedKeyring(payload));
  assert.equal(result.ok, true, result.ok ? 'fixture keyring verified' : `${result.code}: ${result.message}`);
  if (!result.ok) throw new Error('fixture keyring did not verify');
  return { verifier, keyring: result.value };
}

function channelAndRelease(now: unknown = FIXTURE_NOW) {
  const { verifier, keyring } = authority(now);
  const release = signedGatewayRelease();
  const checkedChannel = verifier.verifyChannelManifest(signedStableChannel(release), keyring);
  assert.equal(checkedChannel.ok, true);
  if (!checkedChannel.ok) throw new Error('fixture channel did not verify');
  return { verifier, keyring, release, channel: checkedChannel.value };
}

function errorCode(result: { readonly ok: true } | { readonly ok: false; readonly code: string }): string {
  assert.equal(result.ok, false);
  return result.ok ? '' : result.code;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test('trust: production APIs expose only compiled policy and reject fixture-root substitution', () => {
  assert.equal(Object.isFrozen(GATEWAY_TRUST_POLICY), true);
  assert.equal(Object.isFrozen(GATEWAY_TRUST_POLICY.laneContracts), true);
  assert.equal(Object.hasOwn(productionTrust, 'createTrustVerifier'), false);
  assert.equal(errorCode(verifyProductionKeyring(signedKeyring())), 'ERR-TRUST-UNKNOWN-KEY');

  // Extra JavaScript arguments cannot reactivate the removed policy/clock seam.
  const unsafeCall = verifyProductionKeyring as unknown as (...args: unknown[]) => ReturnType<typeof verifyProductionKeyring>;
  assert.equal(errorCode(unsafeCall(signedKeyring(), FIXTURE_POLICY, FIXTURE_NOW)), 'ERR-TRUST-UNKNOWN-KEY');
  assert.equal(verifyProductionKeyring.length, 1);
});

test('trust: root-signed keyring verifies with active and revoked keys', () => {
  const { keyring } = authority();
  assert.deepEqual(keyring.keys.map((key) => [key.keyId, key.status]), [[FIXTURE_RELEASE_KEY_ID, 'active'], [FIXTURE_REVOKED_KEY_ID, 'revoked']]);
  assertDeepFrozen(keyring);
});

test('trust: runtime provenance rejects fabricated and cross-verifier authority', () => {
  const first = authority();
  const second = authority();
  const fabricatedKeyring = {
    generation: 1,
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    keys: [],
  } as unknown as VerifiedKeyring;
  assert.equal(errorCode(first.verifier.verifyGatewayReleaseManifest(signedGatewayRelease(), fabricatedKeyring)), 'ERR-TRUST-AUTHORITY');
  assert.equal(errorCode(first.verifier.verifyGatewayReleaseManifest(signedGatewayRelease(), second.keyring)), 'ERR-TRUST-AUTHORITY');
  assert.equal(errorCode(verifyProductionRelease(signedGatewayRelease(), first.keyring)), 'ERR-TRUST-AUTHORITY');

  const fabricatedChannel = {
    channel: 'stable',
    releaseId: 'gateway-macos-release-001',
    releaseManifestSha256: '0'.repeat(64),
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2028-01-01T00:00:00.000Z',
    signerKeyId: FIXTURE_RELEASE_KEY_ID,
  } as unknown as VerifiedChannel;
  assert.equal(errorCode(first.verifier.verifyReleaseSelection(fabricatedChannel, signedGatewayRelease(), first.keyring)), 'ERR-TRUST-AUTHORITY');
});

test('trust: verified authority is deeply immutable and detached from raw inputs', () => {
  const rawKeyring = keyringPayload();
  const { verifier, keyring } = authority(FIXTURE_NOW, rawKeyring);
  (rawKeyring.keys as Array<Record<string, unknown>>)[0]!.status = 'revoked';
  assert.equal(keyring.keys[0]!.status, 'active');
  assertDeepFrozen(keyring);
  assert.throws(() => { (keyring.keys[1] as { status: string }).status = 'active'; }, TypeError);

  const rawRelease = gatewayReleasePayload();
  const releaseResult = verifier.verifyGatewayReleaseManifest(signedGatewayRelease(rawRelease), keyring);
  assert.equal(releaseResult.ok, true);
  if (!releaseResult.ok) return;
  rawRelease.releaseId = 'gateway-macos-release-mutated';
  assert.equal(releaseResult.value.releaseId, 'gateway-macos-release-001');
  assertDeepFrozen(releaseResult.value);
  assert.throws(() => { (releaseResult.value as unknown as { releaseId: string }).releaseId = 'forged'; }, TypeError);
});

test('trust: RFC 8785 vectors, UTF-16 sorting, numbers, and nested values canonicalize exactly', () => {
  const primary = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\nA\'B\\\"\\\\\\\\\\\"/","literals":[null,true,false]}') as unknown;
  assert.equal(canonicalizeJcs(primary), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\\\\\"/"}');
  const sorting = JSON.parse('{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji","\\u0080":"Control","\\u00f6":"Latin"}') as unknown;
  assert.equal(canonicalizeJcs(sorting), '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin","€":"Euro Sign","😀":"Emoji","דּ":"Hebrew Letter Dalet With Dagesh"}');
  assert.equal(canonicalizeJcs(-0), '0');
  assert.equal(canonicalizeJcs({ z: [], a: [{}, [null]] }), '{"a":[{},[null]],"z":[]}');
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => canonicalizeJcs(value));
});

test('trust: JCS rejects lone or malformed surrogates in values and property names', () => {
  for (const value of ['\ud800', '\udc00', '\ud800x', 'x\udc00']) assert.throws(() => canonicalizeJcs(value), /invalid Unicode/);
  assert.throws(() => canonicalizeJcs({ ['\ud800']: true }), /invalid Unicode/);
  assert.throws(() => canonicalizeJcs({ ['\udc00']: true }), /invalid Unicode/);
  assert.equal(canonicalizeJcs('😀'), '"😀"');
  assert.equal(canonicalizeJcs({ '😀': 'ok' }), '{"😀":"ok"}');

  const { verifier, keyring } = authority();
  const changed = JSON.parse(signedGatewayRelease()) as { payload: Record<string, unknown> };
  changed.payload.version = '\ud800';
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(JSON.stringify(changed), keyring)), 'ERR-TRUST-CANONICALIZATION');
});

test('trust: duplicate JSON keys reject before parsing at every nested boundary', () => {
  const { verifier, keyring } = authority();
  const cases = [
    '{"payload":{},"payload":{},"signature":{"keyId":"pgw-fixture-root-01","value":"AA=="}}',
    '{"payload":{"keys":[{"keyId":"a","keyId":"b"}]},"signature":{"keyId":"pgw-fixture-root-01","value":"AA=="}}',
    '{"payload":{"channel":"stable","channel":"stable"},"signature":{"keyId":"pgw-fixture-release-01","value":"AA=="}}',
    '{"payload":{"releaseId":"a","releaseId":"b"},"signature":{"keyId":"pgw-fixture-release-01","value":"AA=="}}',
    '{"payload":{"upgradePolicy":{"rollback":"forbidden","rollback":"forbidden"}},"signature":{"keyId":"pgw-fixture-release-01","value":"AA=="}}',
    '{"payload":{"a":1,"\\u0061":2},"signature":{"keyId":"pgw-fixture-release-01","value":"AA=="}}',
  ];
  assert.equal(errorCode(verifier.verifyRootSignedKeyring(cases[0]!)), 'ERR-TRUST-DUPLICATE-KEY');
  assert.equal(errorCode(verifier.verifyRootSignedKeyring(cases[1]!)), 'ERR-TRUST-DUPLICATE-KEY');
  for (const text of cases.slice(2)) assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(text, keyring)), 'ERR-TRUST-DUPLICATE-KEY');
});

test('trust: protected signature binds domain, document kind, keyId, and payload', () => {
  const { verifier, keyring } = authority();
  const release = signedGatewayRelease();
  const changedPayload = JSON.parse(release) as { payload: Record<string, unknown> };
  changedPayload.payload.version = '0.1.2';
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(JSON.stringify(changedPayload), keyring)), 'ERR-TRUST-BAD-SIGNATURE');

  const aliasPayload = keyringPayload();
  aliasPayload.keys = [{ keyId: 'pgw-fixture-alias-01', publicKey: FIXTURE_RELEASE_PUBLIC, status: 'active', roles: ['release'] }];
  const aliasAuthority = authority(FIXTURE_NOW, aliasPayload);
  const relabelled = JSON.parse(release) as { signature: { keyId: string } };
  relabelled.signature.keyId = 'pgw-fixture-alias-01';
  assert.equal(errorCode(aliasAuthority.verifier.verifyGatewayReleaseManifest(JSON.stringify(relabelled), aliasAuthority.keyring)), 'ERR-TRUST-BAD-SIGNATURE');

  const channelPayload = (JSON.parse(signedStableChannel(release)) as { payload: unknown }).payload;
  const keyringAsChannel = signedDocument(channelPayload, 'keyring', FIXTURE_RELEASE_KEY_ID, fixturePrivateKeys.release);
  assert.equal(errorCode(verifier.verifyChannelManifest(keyringAsChannel, keyring)), 'ERR-TRUST-BAD-SIGNATURE');
  const wrongReleaseKind = signedDocument(gatewayReleasePayload(), 'channel', FIXTURE_RELEASE_KEY_ID, fixturePrivateKeys.release);
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(wrongReleaseKind, keyring)), 'ERR-TRUST-BAD-SIGNATURE');
  const wrongChannelKind = signedDocument(channelPayload, 'gateway-release', FIXTURE_RELEASE_KEY_ID, fixturePrivateKeys.release);
  assert.equal(errorCode(verifier.verifyChannelManifest(wrongChannelKind, keyring)), 'ERR-TRUST-BAD-SIGNATURE');
  const wrongKeyringKind = signedDocument(keyringPayload(), 'gateway-release', 'pgw-fixture-root-01', fixturePrivateKeys.root);
  assert.equal(errorCode(verifier.verifyRootSignedKeyring(wrongKeyringKind)), 'ERR-TRUST-BAD-SIGNATURE');
});

test('trust: duplicate public-key aliases reject before they can weaken signer identity', () => {
  const payload = keyringPayload();
  (payload.keys as Array<Record<string, unknown>>).push({ keyId: 'pgw-fixture-alias-01', publicKey: FIXTURE_RELEASE_PUBLIC, status: 'active', roles: ['release'] });
  const result = fixtureVerifier().verifyRootSignedKeyring(signedKeyring(payload));
  assert.equal(errorCode(result), 'ERR-TRUST-DUPLICATE-PUBLIC-KEY');
});

test('trust: exact Ed25519 SPKI and signature encodings are enforced', () => {
  const verifier = fixtureVerifier();
  const base = keyringPayload();
  const key = (base.keys as Array<Record<string, unknown>>)[0]!;
  for (const bytes of [
    Buffer.concat([Buffer.from(FIXTURE_RELEASE_PUBLIC, 'base64'), Buffer.from([0])]),
    Buffer.from(FIXTURE_RELEASE_PUBLIC, 'base64').subarray(0, 43),
    Buffer.alloc(44),
  ]) {
    const payload = keyringPayload();
    (payload.keys as Array<Record<string, unknown>>)[0] = { ...key, publicKey: bytes.toString('base64') };
    assert.equal(errorCode(verifier.verifyRootSignedKeyring(signedKeyring(payload))), 'ERR-TRUST-KEYRING-SCHEMA');
  }

  const { verifier: releaseVerifier, keyring } = authority();
  for (const value of [Buffer.alloc(63).toString('base64'), Buffer.alloc(65).toString('base64'), 'AA==', 'not base64!']) {
    const document = JSON.parse(signedGatewayRelease()) as { signature: { value: string } };
    document.signature.value = value;
    assert.equal(errorCode(releaseVerifier.verifyGatewayReleaseManifest(JSON.stringify(document), keyring)), 'ERR-TRUST-SIGNATURE-SCHEMA');
  }
});

test('trust: validity interval is issuedAt <= now < expiresAt with strict UTC timestamps', () => {
  const future = keyringPayload();
  future.issuedAt = '2027-01-01T00:00:00.001Z';
  assert.equal(errorCode(fixtureVerifier(FIXTURE_NOW).verifyRootSignedKeyring(signedKeyring(future))), 'ERR-TRUST-FUTURE-ISSUED');

  const expired = keyringPayload();
  expired.expiresAt = FIXTURE_NOW.toISOString();
  assert.equal(errorCode(fixtureVerifier(FIXTURE_NOW).verifyRootSignedKeyring(signedKeyring(expired))), 'ERR-TRUST-EXPIRED');
  assert.equal(authority(new Date('2027-12-31T23:59:59.999Z')).keyring.expiresAt, '2028-01-01T00:00:00.000Z');
  assert.equal(errorCode(fixtureVerifier(new Date(NaN)).verifyRootSignedKeyring(signedKeyring())), 'ERR-TRUST-CLOCK');

  for (const issuedAt of ['2026-02-30T00:00:00.000Z', '2023-02-29T00:00:00.000Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+00:00']) {
    const payload = keyringPayload();
    payload.issuedAt = issuedAt;
    assert.equal(errorCode(fixtureVerifier().verifyRootSignedKeyring(signedKeyring(payload))), 'ERR-TRUST-KEYRING-SCHEMA');
  }
  const emptyWindow = keyringPayload();
  emptyWindow.expiresAt = emptyWindow.issuedAt;
  assert.equal(errorCode(fixtureVerifier().verifyRootSignedKeyring(signedKeyring(emptyWindow))), 'ERR-TRUST-TIMESTAMP');

  const leap = keyringPayload();
  leap.issuedAt = '2024-02-29T00:00:00.000Z';
  assert.equal(fixtureVerifier(new Date('2024-02-29T00:00:00.000Z')).verifyRootSignedKeyring(signedKeyring(leap)).ok, true);
});

test('trust: channel freshness uses the same strict half-open interval', () => {
  const release = signedGatewayRelease();
  const base = authority();
  assert.equal(errorCode(base.verifier.verifyChannelManifest(signedStableChannel(release, { issuedAt: '2027-01-01T00:00:00.001Z' }), base.keyring)), 'ERR-TRUST-FUTURE-ISSUED');
  assert.equal(errorCode(base.verifier.verifyChannelManifest(signedStableChannel(release, { expiresAt: FIXTURE_NOW.toISOString() }), base.keyring)), 'ERR-TRUST-EXPIRED');

  const before = authority(new Date('2027-01-01T00:00:00.000Z'));
  assert.equal(before.verifier.verifyChannelManifest(signedStableChannel(release, { expiresAt: '2027-01-01T00:00:00.001Z' }), before.keyring).ok, true);
  assert.equal(errorCode(base.verifier.verifyChannelManifest(signedStableChannel(release, { issuedAt: '2026-02-30T00:00:00.000Z' }), base.keyring)), 'ERR-TRUST-CHANNEL-SCHEMA');
});

test('trust: verified keyring and channel freshness is rechecked at every authority consumption point', () => {
  let now = new Date(FIXTURE_NOW.getTime());
  const verifier = createTrustVerifier(FIXTURE_POLICY, () => new Date(now.getTime()));
  const checkedKeyring = verifier.verifyRootSignedKeyring(signedKeyring());
  assert.equal(checkedKeyring.ok, true);
  if (!checkedKeyring.ok) return;
  const keyring = checkedKeyring.value;
  const release = signedGatewayRelease();
  const channelText = signedStableChannel(release, { expiresAt: '2028-01-01T00:00:00.001Z' });
  const checkedChannel = verifier.verifyChannelManifest(channelText, keyring);
  assert.equal(checkedChannel.ok, true);
  if (!checkedChannel.ok) return;
  const channel = checkedChannel.value;
  assert.equal(verifier.verifyGatewayReleaseManifest(release, keyring).ok, true);
  assert.equal(verifier.verifyReleaseSelection(channel, release, keyring).ok, true);

  now = new Date('2027-12-31T23:59:59.999Z');
  assert.equal(verifier.verifyChannelManifest(channelText, keyring).ok, true);
  assert.equal(verifier.verifyGatewayReleaseManifest(release, keyring).ok, true);
  assert.equal(verifier.verifyReleaseSelection(channel, release, keyring).ok, true);

  now = new Date('2028-01-01T00:00:00.000Z');
  assert.equal(errorCode(verifier.verifyChannelManifest(channelText, keyring)), 'ERR-TRUST-EXPIRED');
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(release, keyring)), 'ERR-TRUST-EXPIRED');
  assert.equal(errorCode(verifier.verifyReleaseSelection(channel, release, keyring)), 'ERR-TRUST-EXPIRED');

  now = new Date('2028-01-01T00:00:00.001Z');
  assert.equal(errorCode(verifier.verifyChannelManifest(channelText, keyring)), 'ERR-TRUST-EXPIRED');
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(release, keyring)), 'ERR-TRUST-EXPIRED');
  assert.equal(errorCode(verifier.verifyReleaseSelection(channel, release, keyring)), 'ERR-TRUST-EXPIRED');
  assert.equal(errorCode(verifier.verifyReleaseSelection({ ...channel } as VerifiedChannel, release, keyring)), 'ERR-TRUST-AUTHORITY');
});

test('trust: unknown, revoked, wrong-role, and bad signatures have distinct errors', () => {
  const split = keyringPayload();
  split.keys = [
    { keyId: FIXTURE_RELEASE_KEY_ID, publicKey: FIXTURE_RELEASE_PUBLIC, status: 'active', roles: ['release'] },
    { keyId: FIXTURE_REVOKED_KEY_ID, publicKey: FIXTURE_REVOKED_PUBLIC, status: 'active', roles: ['channel'] },
  ];
  const { verifier, keyring } = authority(FIXTURE_NOW, split);
  const release = signedGatewayRelease();
  assert.equal(errorCode(verifier.verifyChannelManifest(signedStableChannel(release), keyring)), 'ERR-TRUST-WRONG-ROLE');
  assert.equal(verifier.verifyChannelManifest(signedStableChannel(release, {}, FIXTURE_REVOKED_KEY_ID, fixturePrivateKeys.revoked), keyring).ok, true);
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload(), FIXTURE_REVOKED_KEY_ID, fixturePrivateKeys.revoked), keyring)), 'ERR-TRUST-WRONG-ROLE');

  const normal = authority();
  assert.equal(errorCode(normal.verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload(), FIXTURE_REVOKED_KEY_ID, fixturePrivateKeys.revoked), normal.keyring)), 'ERR-TRUST-REVOKED-KEY');
  assert.equal(errorCode(normal.verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload(), 'pgw-fixture-unknown-01'), normal.keyring)), 'ERR-TRUST-UNKNOWN-KEY');
  const bad = JSON.parse(signedGatewayRelease()) as { signature: { value: string } };
  bad.signature.value = `${bad.signature.value[0] === 'A' ? 'B' : 'A'}${bad.signature.value.slice(1)}`;
  assert.equal(errorCode(normal.verifier.verifyGatewayReleaseManifest(JSON.stringify(bad), normal.keyring)), 'ERR-TRUST-BAD-SIGNATURE');
});

test('trust: channel is narrow and binds exact release ID plus complete signed-document digest', () => {
  const { verifier, keyring, release, channel } = channelAndRelease();
  const selection = verifier.verifyReleaseSelection(channel, release, keyring);
  assert.equal(selection.ok, true);
  if (selection.ok) assertDeepFrozen(selection.value);

  for (const field of ['url', 'path', 'binName', 'artifactFileName']) {
    assert.equal(errorCode(verifier.verifyChannelManifest(signedStableChannel(release, { [field]: 'https://evil.invalid/x' }), keyring)), 'ERR-TRUST-CHANNEL-SCHEMA');
  }
  const badId = verifier.verifyChannelManifest(signedStableChannel(release, { releaseId: 'gateway-macos-release-other' }), keyring);
  assert.equal(badId.ok, true);
  if (badId.ok) assert.equal(errorCode(verifier.verifyReleaseSelection(badId.value, release, keyring)), 'ERR-TRUST-SELECTION-RELEASE-ID');
  const badDigest = verifier.verifyChannelManifest(signedStableChannel(release, { releaseManifestSha256: '0'.repeat(64) }), keyring);
  assert.equal(badDigest.ok, true);
  if (badDigest.ok) assert.equal(errorCode(verifier.verifyReleaseSelection(badDigest.value, release, keyring)), 'ERR-TRUST-SELECTION-DIGEST');

  const changedAfterSelection = JSON.parse(release) as { payload: Record<string, unknown> };
  changedAfterSelection.payload.artifactSha256 = 'd'.repeat(64);
  assert.equal(errorCode(verifier.verifyReleaseSelection(channel, JSON.stringify(changedAfterSelection), keyring)), 'ERR-TRUST-SELECTION-DIGEST');
});

test('trust: malformed JSON, schema compatibility, and duplicate keys have typed errors', () => {
  const { verifier, keyring } = authority();
  assert.equal(errorCode(verifier.verifyRootSignedKeyring('{')), 'ERR-TRUST-JSON');
  assert.equal(errorCode(verifier.verifyRootSignedKeyring('{"a":1,"a":2}')), 'ERR-TRUST-DUPLICATE-KEY');
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload({ schemaVersion: 2 })), keyring)), 'ERR-TRUST-COMPATIBILITY');
  assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload({ artifactSha256: 'bad' })), keyring)), 'ERR-TRUST-RELEASE-SCHEMA');
});

test('trust: release compatibility errors distinguish protocol, lane, and package/bin contract', () => {
  const { verifier, keyring } = authority();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ installProtocol: 2 }, 'ERR-TRUST-UNSUPPORTED-PROTOCOL'],
    [{ runtimeProtocol: 2 }, 'ERR-TRUST-UNSUPPORTED-PROTOCOL'],
    [{ supportedLanes: ['win32-x64-posix-utf8-node22'] }, 'ERR-TRUST-UNSUPPORTED-LANE'],
    [{ packageName: 'wrong-package' }, 'ERR-TRUST-RELEASE-CONTRACT'],
    [{ binName: 'wrong-bin' }, 'ERR-TRUST-RELEASE-CONTRACT'],
  ];
  for (const [override, code] of cases) assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload(override)), keyring)), code);
});

test('trust: release identity, digests, filename, unknown fields, and upgrade policy fail closed', () => {
  const { verifier, keyring } = authority();
  for (const override of [
    { sourceCommit: 'A'.repeat(40) },
    { artifactSha256: 'g'.repeat(64) },
    { packageTreeSha256: 'abc' },
    { artifactFileName: '../gateway.tgz' },
    { extra: true },
  ]) assert.equal(verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload(override)), keyring).ok, false);

  for (const predecessors of [
    ['gateway-macos-release-000', 'gateway-macos-release-000'], ['*'], ['>=0.1.0'], ['gateway-macos-release-001'],
  ]) {
    const payload = gatewayReleasePayload({ upgradePolicy: { acceptedPredecessorReleaseIds: predecessors, rollback: 'immediate-predecessor' } });
    assert.equal(errorCode(verifier.verifyGatewayReleaseManifest(signedGatewayRelease(payload), keyring)), 'ERR-TRUST-UPGRADE-POLICY');
  }
});

test('trust: dependencies are exact immutable npm package-version evidence only', () => {
  const { verifier, keyring } = authority();
  for (const version of ['0.0.0', '1.2.3', '8.20.0']) {
    const result = verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload({ dependencies: { ajv: version } })), keyring);
    assert.equal(result.ok, true, version);
    if (result.ok) assert.equal(Object.isFrozen(result.value.dependencies), true);
  }
  for (const version of ['https://evil/x.tgz', 'git+https://evil/repo', 'file:../x', 'workspace:*', '*', '^1.2.3', '~1.2.3', '>=1.2.3', '1 || 2', '1.2.3-beta.1', '1.2.3+build.7', ' 1.2.3', '1.2.3 ', '1.2.3\n', '', '01.2.3']) {
    const result = verifier.verifyGatewayReleaseManifest(signedGatewayRelease(gatewayReleasePayload({ dependencies: { ajv: version } })), keyring);
    assert.equal(errorCode(result), 'ERR-TRUST-RELEASE-SCHEMA', version);
  }
});

test('trust: future compatible patch changes release facts without production source identity', () => {
  const { verifier, keyring } = authority();
  const future = gatewayReleasePayload({
    releaseId: 'gateway-macos-release-002',
    version: '0.1.2',
    sourceCommit: 'd'.repeat(40),
    artifactFileName: 'project-gateway-macos-core-0.1.2.tgz',
    artifactSha256: 'e'.repeat(64),
    packageTreeSha256: 'f'.repeat(64),
    upgradePolicy: { acceptedPredecessorReleaseIds: ['gateway-macos-release-001'], rollback: 'immediate-predecessor' },
  });
  const release = signedGatewayRelease(future);
  const channel = verifier.verifyChannelManifest(signedStableChannel(release), keyring);
  assert.equal(channel.ok, true);
  assert.equal(verifier.verifyGatewayReleaseManifest(release, keyring).ok, true);
  if (channel.ok) assert.equal(verifier.verifyReleaseSelection(channel.value, release, keyring).ok, true);
});
