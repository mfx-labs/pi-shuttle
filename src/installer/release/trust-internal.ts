import { createHash, createPublicKey, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { findDuplicateKey } from '../../config/json.js';
import { closedObject, RELEASE_FILE_NAME_RE, SHA256_HEX_RE } from './document.js';

export const MAX_METADATA_BYTES = 64 * 1024;
export const KEYRING_SCHEMA_VERSION = 1;
export const CHANNEL_SCHEMA_VERSION = 1;
export const GATEWAY_RELEASE_SCHEMA_VERSION = 1;
export const RELEASE_TRUST_DOMAIN = 'pi-shuttle.release-trust.v1';

const MAX_KEYS = 32;
const MAX_LANES = 8;
const MAX_DEPENDENCIES = 32;
const MAX_PREDECESSORS = 16;
const MAX_STRING = 256;
const ED25519_SPKI_BYTES = 44;
const ED25519_SIGNATURE_BYTES = 64;
const ID_RE = /^[a-z][a-z0-9._-]{2,127}$/;
const KEY_ID_RE = /^pgw-[a-z][a-z0-9-]{2,63}$/;
const REPOSITORY_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PACKAGE_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_NPM_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const verifiedKeyringType: unique symbol = Symbol('VerifiedKeyring');
const verifiedChannelType: unique symbol = Symbol('VerifiedChannel');
const verifiedReleaseType: unique symbol = Symbol('VerifiedGatewayRelease');
const verifiedSelectionType: unique symbol = Symbol('VerifiedReleaseSelection');

type UnknownRecord = Readonly<Record<string, unknown>>;
export type DocumentKind = 'keyring' | 'channel' | 'gateway-release';
export type TrustErrorCode =
  | 'ERR-TRUST-AUTHORITY'
  | 'ERR-TRUST-BAD-SIGNATURE'
  | 'ERR-TRUST-CANONICALIZATION'
  | 'ERR-TRUST-CHANNEL-SCHEMA'
  | 'ERR-TRUST-CLOCK'
  | 'ERR-TRUST-COMPATIBILITY'
  | 'ERR-TRUST-DOCUMENT-SIZE'
  | 'ERR-TRUST-DUPLICATE-KEY'
  | 'ERR-TRUST-DUPLICATE-PUBLIC-KEY'
  | 'ERR-TRUST-EXPIRED'
  | 'ERR-TRUST-FUTURE-ISSUED'
  | 'ERR-TRUST-JSON'
  | 'ERR-TRUST-KEYRING-DUPLICATE-KEY-ID'
  | 'ERR-TRUST-KEYRING-SCHEMA'
  | 'ERR-TRUST-RELEASE-CONTRACT'
  | 'ERR-TRUST-RELEASE-SCHEMA'
  | 'ERR-TRUST-REVOKED-KEY'
  | 'ERR-TRUST-SELECTION-DIGEST'
  | 'ERR-TRUST-SELECTION-RELEASE-ID'
  | 'ERR-TRUST-SIGNATURE-SCHEMA'
  | 'ERR-TRUST-SIGNED-SCHEMA'
  | 'ERR-TRUST-TIMESTAMP'
  | 'ERR-TRUST-UNKNOWN-KEY'
  | 'ERR-TRUST-UNSUPPORTED-LANE'
  | 'ERR-TRUST-UNSUPPORTED-PROTOCOL'
  | 'ERR-TRUST-UPGRADE-POLICY'
  | 'ERR-TRUST-WRONG-ROLE';

export type TrustResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: TrustErrorCode; readonly message: string };

export interface GatewayPackageContract {
  readonly packageName: string;
  readonly binName: string;
}

export interface GatewayTrustPolicy {
  readonly rootKeyId: string;
  readonly rootPublicKey: string;
  readonly supportedKeyringSchemas: readonly number[];
  readonly supportedChannelSchemas: readonly number[];
  readonly supportedReleaseSchemas: readonly number[];
  readonly supportedInstallProtocols: readonly number[];
  readonly supportedRuntimeProtocols: readonly number[];
  readonly laneContracts: Readonly<Record<string, GatewayPackageContract>>;
}

export interface Signature {
  readonly keyId: string;
  readonly value: string;
}

export interface SignedDocument<T> {
  readonly payload: T;
  readonly signature: Signature;
}

export interface SigningKey {
  readonly keyId: string;
  readonly publicKey: string;
  readonly status: 'active' | 'revoked';
  readonly roles: readonly ('channel' | 'release')[];
}

export interface VerifiedKeyring {
  readonly [verifiedKeyringType]: true;
  readonly generation: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly keys: readonly SigningKey[];
}

export interface VerifiedChannel {
  readonly [verifiedChannelType]: true;
  readonly channel: 'stable';
  readonly releaseId: string;
  readonly releaseManifestSha256: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signerKeyId: string;
}

export interface UpgradePolicy {
  readonly acceptedPredecessorReleaseIds: readonly string[];
  readonly rollback: 'immediate-predecessor' | 'forbidden';
}

export interface VerifiedGatewayRelease {
  readonly [verifiedReleaseType]: true;
  readonly releaseId: string;
  readonly repository: string;
  readonly packageName: string;
  readonly version: string;
  readonly sourceCommit: string;
  readonly artifactFileName: string;
  readonly artifactSha256: string;
  readonly packageTreeSha256: string;
  readonly binName: string;
  readonly supportedLanes: readonly string[];
  readonly installProtocol: number;
  readonly runtimeProtocol: number;
  /** Exact package-version evidence only; never package acquisition authority. */
  readonly dependencies: Readonly<Record<string, string>>;
  readonly upgradePolicy: UpgradePolicy;
  readonly signerKeyId: string;
}

export interface VerifiedReleaseSelection {
  readonly [verifiedSelectionType]: true;
  readonly channel: VerifiedChannel;
  readonly release: VerifiedGatewayRelease;
  readonly releaseManifestSha256: string;
}

export interface TrustVerifier {
  verifyRootSignedKeyring(text: string): TrustResult<VerifiedKeyring>;
  verifyChannelManifest(text: string, keyring: VerifiedKeyring): TrustResult<VerifiedChannel>;
  verifyGatewayReleaseManifest(text: string, keyring: VerifiedKeyring): TrustResult<VerifiedGatewayRelease>;
  verifyReleaseSelection(channel: VerifiedChannel, releaseText: string, keyring: VerifiedKeyring): TrustResult<VerifiedReleaseSelection>;
}

function fail<T = never>(code: TrustErrorCode, message: string): TrustResult<T> {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: UnknownRecord, key: string, max = MAX_STRING): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function integerField(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function uniqueStrings(value: unknown, maximum: number, check: (entry: string) => boolean): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maximum || value.some((entry) => typeof entry !== 'string' || !check(entry))) return null;
  const entries = [...value] as string[];
  return new Set(entries).size === entries.length ? entries : null;
}

function hasValidUnicode(value: string): boolean {
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

/** RFC 8785/JCS serialization, including the I-JSON Unicode constraint. */
export function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    if (!hasValidUnicode(value)) throw new Error('invalid Unicode string');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number is not JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalizeJcs(entry)).join(',')}]`;
  if (!isRecord(value)) throw new Error('value is not JSON');
  const keys = Object.keys(value).sort();
  for (const key of keys) if (!hasValidUnicode(key)) throw new Error('invalid Unicode property name');
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`).join(',')}}`;
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalizeJcs(value), 'utf8');
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalBytes(value)).digest('hex');
}

export function protectedSigningValue(kind: DocumentKind, keyId: string, payload: unknown): Readonly<Record<string, unknown>> {
  return { domain: RELEASE_TRUST_DOMAIN, documentKind: kind, keyId, payload };
}

function base64Bytes(value: string): Buffer | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > 0 && bytes.toString('base64') === value ? bytes : null;
}

function ed25519PublicKey(value: string): KeyObject | null {
  const bytes = base64Bytes(value);
  if (bytes === null || bytes.length !== ED25519_SPKI_BYTES) return null;
  try {
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    const canonical = key.export({ format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' && Buffer.isBuffer(canonical) && canonical.equals(bytes) ? key : null;
  } catch {
    return null;
  }
}

function parseTimestamp(value: string): number | null {
  if (!ISO_UTC_RE.test(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function parseDocument(text: unknown): TrustResult<unknown> {
  if (typeof text !== 'string') return fail('ERR-TRUST-JSON', 'metadata document must be JSON text');
  if (Buffer.byteLength(text, 'utf8') > MAX_METADATA_BYTES) return fail('ERR-TRUST-DOCUMENT-SIZE', `metadata document exceeds ${MAX_METADATA_BYTES} bytes`);
  const duplicate = findDuplicateKey(text);
  if (duplicate !== null) return fail('ERR-TRUST-DUPLICATE-KEY', `metadata document contains duplicate object key: ${duplicate}`);
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return fail('ERR-TRUST-JSON', 'metadata document is not valid JSON');
  }
}

function signedDocument(raw: unknown): TrustResult<SignedDocument<unknown>> {
  const root = closedObject(raw, ['payload', 'signature'], 'signed document');
  const signature = root === null ? null : closedObject(root['signature'], ['keyId', 'value'], 'signature');
  if (root === null || signature === null) return fail('ERR-TRUST-SIGNED-SCHEMA', 'signed document must contain only payload and signature.keyId/value');
  const keyId = stringField(signature, 'keyId', 72);
  const value = stringField(signature, 'value', 128);
  const signatureBytes = value === null ? null : base64Bytes(value);
  if (keyId === null || !KEY_ID_RE.test(keyId) || signatureBytes === null || signatureBytes.length !== ED25519_SIGNATURE_BYTES) {
    return fail('ERR-TRUST-SIGNATURE-SCHEMA', 'signature keyId or Ed25519 signature encoding is malformed');
  }
  return { ok: true, value: { payload: root['payload'], signature: { keyId, value: value! } } };
}

function verifySignature(kind: DocumentKind, payload: unknown, signature: Signature, publicKey: string): TrustResult<true> {
  const key = ed25519PublicKey(publicKey);
  const bytes = base64Bytes(signature.value);
  if (key === null || bytes === null || bytes.length !== ED25519_SIGNATURE_BYTES) return fail('ERR-TRUST-SIGNATURE-SCHEMA', 'Ed25519 key or signature encoding is malformed');
  try {
    return verify(null, canonicalBytes(protectedSigningValue(kind, signature.keyId, payload)), key, bytes)
      ? { ok: true, value: true }
      : fail('ERR-TRUST-BAD-SIGNATURE', `${kind} signature is invalid`);
  } catch {
    return fail('ERR-TRUST-CANONICALIZATION', `${kind} payload cannot be canonicalized as RFC 8785 JSON`);
  }
}

function snapshotPolicy(policy: GatewayTrustPolicy): GatewayTrustPolicy {
  const laneContracts: Record<string, GatewayPackageContract> = {};
  for (const [lane, contract] of Object.entries(policy.laneContracts)) laneContracts[lane] = Object.freeze({ packageName: contract.packageName, binName: contract.binName });
  return Object.freeze({
    rootKeyId: policy.rootKeyId,
    rootPublicKey: policy.rootPublicKey,
    supportedKeyringSchemas: Object.freeze([...policy.supportedKeyringSchemas]),
    supportedChannelSchemas: Object.freeze([...policy.supportedChannelSchemas]),
    supportedReleaseSchemas: Object.freeze([...policy.supportedReleaseSchemas]),
    supportedInstallProtocols: Object.freeze([...policy.supportedInstallProtocols]),
    supportedRuntimeProtocols: Object.freeze([...policy.supportedRuntimeProtocols]),
    laneContracts: Object.freeze(laneContracts),
  });
}

/** Internal construction boundary. Production exports only one compiled instance; tests build a separate instance from test-only code. */
export function createTrustVerifier(policyInput: GatewayTrustPolicy, clock: () => unknown): TrustVerifier {
  const policy = snapshotPolicy(policyInput);
  const keyringAuthority = new WeakSet<object>();
  const channelAuthority = new WeakSet<object>();
  const releaseAuthority = new WeakSet<object>();
  const selectionAuthority = new WeakSet<object>();

  function nowMilliseconds(): TrustResult<number> {
    let value: unknown;
    try { value = clock(); } catch { return fail('ERR-TRUST-CLOCK', 'trusted clock failed'); }
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return fail('ERR-TRUST-CLOCK', 'trusted clock returned an invalid instant');
    return { ok: true, value: value.getTime() };
  }

  function freshness(issuedAt: string, expiresAt: string): TrustResult<true> {
    const issued = parseTimestamp(issuedAt);
    const expires = parseTimestamp(expiresAt);
    if (issued === null || expires === null || expires <= issued) return fail('ERR-TRUST-TIMESTAMP', 'metadata validity window is malformed or empty');
    const now = nowMilliseconds();
    if (!now.ok) return now;
    if (now.value < issued) return fail('ERR-TRUST-FUTURE-ISSUED', 'metadata document is not yet valid');
    if (now.value >= expires) return fail('ERR-TRUST-EXPIRED', 'metadata validity window has expired');
    return { ok: true, value: true };
  }

  function parseKeyringPayload(payload: unknown): TrustResult<VerifiedKeyring> {
    const root = closedObject(payload, ['schemaVersion', 'generation', 'issuedAt', 'expiresAt', 'keys'], 'keyring');
    if (root === null) return fail('ERR-TRUST-KEYRING-SCHEMA', 'keyring payload has unknown fields or is not an object');
    const schemaVersion = integerField(root, 'schemaVersion');
    if (schemaVersion === null) return fail('ERR-TRUST-KEYRING-SCHEMA', 'keyring schemaVersion is malformed');
    if (!policy.supportedKeyringSchemas.includes(schemaVersion)) return fail('ERR-TRUST-COMPATIBILITY', 'keyring schemaVersion is unsupported');
    const generation = integerField(root, 'generation');
    const issuedAt = stringField(root, 'issuedAt', 32);
    const expiresAt = stringField(root, 'expiresAt', 32);
    if (generation === null || issuedAt === null || expiresAt === null || parseTimestamp(issuedAt) === null || parseTimestamp(expiresAt) === null) return fail('ERR-TRUST-KEYRING-SCHEMA', 'keyring generation or validity timestamp is malformed');
    const valid = freshness(issuedAt, expiresAt);
    if (!valid.ok) return valid;
    if (!Array.isArray(root['keys']) || root['keys'].length === 0 || root['keys'].length > MAX_KEYS) return fail('ERR-TRUST-KEYRING-SCHEMA', 'keyring keys must be a non-empty bounded array');
    const keys: SigningKey[] = [];
    for (const rawKey of root['keys']) {
      const key = closedObject(rawKey, ['keyId', 'publicKey', 'status', 'roles'], 'keyring key');
      if (key === null) return fail('ERR-TRUST-KEYRING-SCHEMA', 'keyring key has unknown fields or is malformed');
      const keyId = stringField(key, 'keyId', 72);
      const publicKey = stringField(key, 'publicKey', 128);
      const status = key['status'];
      const roles = uniqueStrings(key['roles'], 2, (role) => role === 'channel' || role === 'release');
      if (keyId === null || !KEY_ID_RE.test(keyId) || publicKey === null || ed25519PublicKey(publicKey) === null || (status !== 'active' && status !== 'revoked') || roles === null || roles.length === 0) return fail('ERR-TRUST-KEYRING-SCHEMA', 'keyring key is malformed');
      keys.push(Object.freeze({ keyId, publicKey, status, roles: Object.freeze(roles as ('channel' | 'release')[]) }));
    }
    if (new Set(keys.map((key) => key.keyId)).size !== keys.length) return fail('ERR-TRUST-KEYRING-DUPLICATE-KEY-ID', 'keyring contains duplicate key IDs');
    if (new Set(keys.map((key) => key.publicKey)).size !== keys.length) return fail('ERR-TRUST-DUPLICATE-PUBLIC-KEY', 'keyring contains the same public key under multiple IDs');
    const value = Object.freeze({ generation, issuedAt, expiresAt, keys: Object.freeze(keys) }) as VerifiedKeyring;
    keyringAuthority.add(value);
    return { ok: true, value };
  }

  function requireKeyring(value: VerifiedKeyring): TrustResult<VerifiedKeyring> {
    if (typeof value !== 'object' || value === null || !keyringAuthority.has(value as object)) return fail('ERR-TRUST-AUTHORITY', 'keyring was not produced by this verifier');
    const current = freshness(value.issuedAt, value.expiresAt);
    return current.ok ? { ok: true, value } : current;
  }

  function authorizedKey(keyring: VerifiedKeyring, keyId: string, role: 'channel' | 'release'): TrustResult<SigningKey> {
    const key = keyring.keys.find((candidate) => candidate.keyId === keyId);
    if (key === undefined) return fail('ERR-TRUST-UNKNOWN-KEY', `signer key is unknown for ${role} metadata`);
    if (key.status === 'revoked') return fail('ERR-TRUST-REVOKED-KEY', `signer key is revoked for ${role} metadata`);
    if (!key.roles.includes(role)) return fail('ERR-TRUST-WRONG-ROLE', `signer key lacks the ${role} role`);
    return { ok: true, value: key };
  }

  function verifyRootSignedKeyring(text: string): TrustResult<VerifiedKeyring> {
    const parsed = parseDocument(text);
    if (!parsed.ok) return parsed;
    const signed = signedDocument(parsed.value);
    if (!signed.ok) return signed;
    if (signed.value.signature.keyId !== policy.rootKeyId) return fail('ERR-TRUST-UNKNOWN-KEY', 'keyring signer is not the compiled root key ID');
    const signature = verifySignature('keyring', signed.value.payload, signed.value.signature, policy.rootPublicKey);
    if (!signature.ok) return signature;
    return parseKeyringPayload(signed.value.payload);
  }

  function parseChannelPayload(payload: unknown): TrustResult<Omit<VerifiedChannel, typeof verifiedChannelType | 'signerKeyId'>> {
    const root = closedObject(payload, ['schemaVersion', 'channel', 'releaseId', 'releaseManifestSha256', 'issuedAt', 'expiresAt'], 'channel');
    if (root === null) return fail('ERR-TRUST-CHANNEL-SCHEMA', 'channel payload has unknown fields or is malformed');
    const schemaVersion = integerField(root, 'schemaVersion');
    if (schemaVersion === null) return fail('ERR-TRUST-CHANNEL-SCHEMA', 'channel schemaVersion is malformed');
    if (!policy.supportedChannelSchemas.includes(schemaVersion)) return fail('ERR-TRUST-COMPATIBILITY', 'channel schemaVersion is unsupported');
    const channel = root['channel'];
    const releaseId = stringField(root, 'releaseId', 128);
    const releaseManifestSha256 = stringField(root, 'releaseManifestSha256', 64);
    const issuedAt = stringField(root, 'issuedAt', 32);
    const expiresAt = stringField(root, 'expiresAt', 32);
    if (channel !== 'stable' || releaseId === null || !ID_RE.test(releaseId) || releaseManifestSha256 === null || !SHA256_HEX_RE.test(releaseManifestSha256) || issuedAt === null || expiresAt === null || parseTimestamp(issuedAt) === null || parseTimestamp(expiresAt) === null) return fail('ERR-TRUST-CHANNEL-SCHEMA', 'channel payload is malformed');
    const valid = freshness(issuedAt, expiresAt);
    if (!valid.ok) return valid;
    return { ok: true, value: { channel, releaseId, releaseManifestSha256, issuedAt, expiresAt } };
  }

  function verifyChannelManifest(text: string, keyring: VerifiedKeyring): TrustResult<VerifiedChannel> {
    const trustedKeyring = requireKeyring(keyring);
    if (!trustedKeyring.ok) return trustedKeyring;
    const parsed = parseDocument(text);
    if (!parsed.ok) return parsed;
    const signed = signedDocument(parsed.value);
    if (!signed.ok) return signed;
    const key = authorizedKey(keyring, signed.value.signature.keyId, 'channel');
    if (!key.ok) return key;
    const signature = verifySignature('channel', signed.value.payload, signed.value.signature, key.value.publicKey);
    if (!signature.ok) return signature;
    const channel = parseChannelPayload(signed.value.payload);
    if (!channel.ok) return channel;
    const value = Object.freeze({ ...channel.value, signerKeyId: key.value.keyId }) as VerifiedChannel;
    channelAuthority.add(value);
    return { ok: true, value };
  }

  function parseDependencies(value: unknown): TrustResult<Readonly<Record<string, string>>> {
    if (!isRecord(value) || Object.keys(value).length > MAX_DEPENDENCIES) return fail('ERR-TRUST-RELEASE-SCHEMA', 'dependencies must be a bounded object');
    const dependencies: Record<string, string> = {};
    for (const [name, version] of Object.entries(value)) {
      if (!PACKAGE_RE.test(name) || typeof version !== 'string' || version.length > MAX_STRING || !EXACT_NPM_VERSION_RE.test(version)) return fail('ERR-TRUST-RELEASE-SCHEMA', 'dependencies must be exact npm package/version evidence');
      dependencies[name] = version;
    }
    return { ok: true, value: Object.freeze(dependencies) };
  }

  function parseUpgradePolicy(value: unknown, releaseId: string): TrustResult<UpgradePolicy> {
    const root = closedObject(value, ['acceptedPredecessorReleaseIds', 'rollback'], 'upgradePolicy');
    if (root === null) return fail('ERR-TRUST-UPGRADE-POLICY', 'upgradePolicy has unknown fields or is malformed');
    const predecessors = uniqueStrings(root['acceptedPredecessorReleaseIds'], MAX_PREDECESSORS, (id) => ID_RE.test(id) && id !== releaseId);
    const rollback = root['rollback'];
    if (predecessors === null || rollback !== 'immediate-predecessor' && rollback !== 'forbidden') return fail('ERR-TRUST-UPGRADE-POLICY', 'upgradePolicy predecessor IDs or rollback mode is invalid');
    return { ok: true, value: Object.freeze({ acceptedPredecessorReleaseIds: Object.freeze([...predecessors]), rollback }) };
  }

  function parseReleasePayload(payload: unknown): TrustResult<Omit<VerifiedGatewayRelease, typeof verifiedReleaseType | 'signerKeyId'>> {
    const root = closedObject(payload, ['schemaVersion', 'releaseId', 'component', 'repository', 'packageName', 'version', 'sourceCommit', 'artifactFileName', 'artifactSha256', 'packageTreeSha256', 'binName', 'supportedLanes', 'installProtocol', 'runtimeProtocol', 'dependencies', 'upgradePolicy'], 'gateway release');
    if (root === null) return fail('ERR-TRUST-RELEASE-SCHEMA', 'gateway release has unknown fields or is malformed');
    const schemaVersion = integerField(root, 'schemaVersion');
    if (schemaVersion === null) return fail('ERR-TRUST-RELEASE-SCHEMA', 'release schemaVersion is malformed');
    if (!policy.supportedReleaseSchemas.includes(schemaVersion)) return fail('ERR-TRUST-COMPATIBILITY', 'release schemaVersion is unsupported');
    const releaseId = stringField(root, 'releaseId', 128);
    const repository = stringField(root, 'repository', 193);
    const packageName = stringField(root, 'packageName', 214);
    const version = stringField(root, 'version', 128);
    const sourceCommit = stringField(root, 'sourceCommit', 40);
    const artifactFileName = stringField(root, 'artifactFileName', 255);
    const artifactSha256 = stringField(root, 'artifactSha256', 64);
    const packageTreeSha256 = stringField(root, 'packageTreeSha256', 64);
    const binName = stringField(root, 'binName', 128);
    const installProtocol = integerField(root, 'installProtocol');
    const runtimeProtocol = integerField(root, 'runtimeProtocol');
    const lanes = uniqueStrings(root['supportedLanes'], MAX_LANES, (lane) => lane.length > 0 && lane.length <= 128);
    if (releaseId === null || !ID_RE.test(releaseId) || root['component'] !== 'gateway' || repository === null || !REPOSITORY_RE.test(repository) || packageName === null || !PACKAGE_RE.test(packageName) || version === null || sourceCommit === null || !/^[0-9a-f]{40}$/.test(sourceCommit) || artifactFileName === null || !RELEASE_FILE_NAME_RE.test(artifactFileName) || artifactSha256 === null || !SHA256_HEX_RE.test(artifactSha256) || packageTreeSha256 === null || !SHA256_HEX_RE.test(packageTreeSha256) || binName === null || installProtocol === null || runtimeProtocol === null || lanes === null || lanes.length === 0) return fail('ERR-TRUST-RELEASE-SCHEMA', 'gateway release identity or digest is malformed');
    if (!policy.supportedInstallProtocols.includes(installProtocol) || !policy.supportedRuntimeProtocols.includes(runtimeProtocol)) return fail('ERR-TRUST-UNSUPPORTED-PROTOCOL', 'gateway release protocol is unsupported');
    if (lanes.some((lane) => !Object.hasOwn(policy.laneContracts, lane))) return fail('ERR-TRUST-UNSUPPORTED-LANE', 'gateway release lane is unsupported');
    if (lanes.some((lane) => {
      const contract = policy.laneContracts[lane]!;
      return contract.packageName !== packageName || contract.binName !== binName;
    })) return fail('ERR-TRUST-RELEASE-CONTRACT', 'gateway package/bin contract does not match every declared lane');
    const dependencies = parseDependencies(root['dependencies']);
    if (!dependencies.ok) return dependencies;
    const upgradePolicy = parseUpgradePolicy(root['upgradePolicy'], releaseId);
    if (!upgradePolicy.ok) return upgradePolicy;
    return { ok: true, value: { releaseId, repository, packageName, version, sourceCommit, artifactFileName, artifactSha256, packageTreeSha256, binName, supportedLanes: Object.freeze([...lanes]), installProtocol, runtimeProtocol, dependencies: dependencies.value, upgradePolicy: upgradePolicy.value } };
  }

  function verifyGatewayReleaseManifest(text: string, keyring: VerifiedKeyring): TrustResult<VerifiedGatewayRelease> {
    const trustedKeyring = requireKeyring(keyring);
    if (!trustedKeyring.ok) return trustedKeyring;
    const parsed = parseDocument(text);
    if (!parsed.ok) return parsed;
    const signed = signedDocument(parsed.value);
    if (!signed.ok) return signed;
    const key = authorizedKey(keyring, signed.value.signature.keyId, 'release');
    if (!key.ok) return key;
    const signature = verifySignature('gateway-release', signed.value.payload, signed.value.signature, key.value.publicKey);
    if (!signature.ok) return signature;
    const release = parseReleasePayload(signed.value.payload);
    if (!release.ok) return release;
    const value = Object.freeze({ ...release.value, signerKeyId: key.value.keyId }) as VerifiedGatewayRelease;
    releaseAuthority.add(value);
    return { ok: true, value };
  }

  function verifyReleaseSelection(channel: VerifiedChannel, releaseText: string, keyring: VerifiedKeyring): TrustResult<VerifiedReleaseSelection> {
    if (typeof channel !== 'object' || channel === null || !channelAuthority.has(channel as object)) return fail('ERR-TRUST-AUTHORITY', 'channel was not produced by this verifier');
    const currentChannel = freshness(channel.issuedAt, channel.expiresAt);
    if (!currentChannel.ok) return currentChannel;
    const trustedKeyring = requireKeyring(keyring);
    if (!trustedKeyring.ok) return trustedKeyring;
    const parsed = parseDocument(releaseText);
    if (!parsed.ok) return parsed;
    let digest: string;
    try { digest = canonicalSha256(parsed.value); } catch { return fail('ERR-TRUST-CANONICALIZATION', 'release document cannot be canonicalized as RFC 8785 JSON'); }
    if (digest !== channel.releaseManifestSha256) return fail('ERR-TRUST-SELECTION-DIGEST', 'channel release-manifest digest does not match the supplied manifest');
    const release = verifyGatewayReleaseManifest(releaseText, keyring);
    if (!release.ok) return release;
    if (!releaseAuthority.has(release.value as object)) return fail('ERR-TRUST-AUTHORITY', 'release was not produced by this verifier');
    if (release.value.releaseId !== channel.releaseId) return fail('ERR-TRUST-SELECTION-RELEASE-ID', 'channel releaseId does not match the supplied release manifest');
    const value = Object.freeze({ channel, release: release.value, releaseManifestSha256: digest }) as VerifiedReleaseSelection;
    selectionAuthority.add(value);
    return { ok: true, value };
  }

  return Object.freeze({ verifyRootSignedKeyring, verifyChannelManifest, verifyGatewayReleaseManifest, verifyReleaseSelection });
}
