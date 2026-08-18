/** NEW-STATE Slice A — signed selection-chain cache Schema 1 tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CACHE_SCHEMA_VERSION,
  MAX_CACHE_BYTES,
  parseManifestNativeCache,
  serializeManifestNativeCache,
} from '../../src/manifest-native/cache.js';
import { deriveCachePath } from '../../src/manifest-native/paths.js';
import { classifyManifestNativeState } from '../../src/manifest-native/state.js';
import {
  buildNativeChain,
  materializeNativeNamespace,
  nativeBaseDir,
  nativeClassifyDeps,
  removeNativeBase,
} from '../helpers/manifest-native-fixtures.js';

function errorCode(result: { readonly ok: boolean; readonly code?: string }): string | undefined {
  assert.equal(result.ok, false);
  return result.ok ? undefined : result.code;
}

function cacheText(chain: { keyringText: string; channelText: string; releaseText: string }): string {
  return serializeManifestNativeCache({ cacheSchemaVersion: CACHE_SCHEMA_VERSION, keyringText: chain.keyringText, channelText: chain.channelText, releaseManifestText: chain.releaseText });
}

test('cache: valid signed-chain cache parses with immutable identity', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const raw = (await import('node:fs')).readFileSync(ns.cachePath, 'utf8');
    const parsed = parseManifestNativeCache(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.cacheSchemaVersion, 1);
    assert.equal(parsed.value.keyringText, ns.chain.keyringText);
    assert.equal(parsed.value.channelText, ns.chain.channelText);
    assert.equal(parsed.value.releaseManifestText, ns.chain.releaseText);
    assert.equal(Object.isFrozen(parsed.value), true);
    // Deterministic serialization round-trips byte-exact.
    assert.equal(serializeManifestNativeCache(parsed.value), raw);
    assert.equal(raw.endsWith('\n'), true);
  } finally {
    removeNativeBase(base);
  }
});

test('cache: malformed envelopes reject (unknown fields, schema version, document shape)', () => {
  const chain = buildNativeChain();
  const valid = cacheText(chain);
  assert.equal(parseManifestNativeCache(valid).ok, true);
  assert.equal(errorCode(parseManifestNativeCache('{"cacheSchemaVersion":1,"keyring":"{}","channel":"{}","releaseManifest":"{}","extra":1}')), 'ERR-MN-CACHE-SCHEMA');
  assert.equal(errorCode(parseManifestNativeCache(valid.replace('"cacheSchemaVersion":1', '"cacheSchemaVersion":2'))), 'ERR-MN-CACHE-SCHEMA');
  assert.equal(errorCode(parseManifestNativeCache(JSON.stringify({ cacheSchemaVersion: 1, keyring: 7, channel: '{}', releaseManifest: '{}' }))), 'ERR-MN-CACHE-SCHEMA');
  assert.equal(errorCode(parseManifestNativeCache(JSON.stringify({ cacheSchemaVersion: 1, keyring: 'not json', channel: '{}', releaseManifest: '{}' }))), 'ERR-MN-CACHE-SCHEMA');
  assert.equal(errorCode(parseManifestNativeCache('{not json')), 'ERR-MN-CACHE-JSON');
});

test('cache: duplicate keys reject (including escaped-equivalent)', () => {
  const chain = buildNativeChain();
  const duplicate = '{"cacheSchemaVersion":1,"cacheSchemaVersion":1,"keyring":"{}","channel":"{}","releaseManifest":"{}"}';
  assert.equal(errorCode(parseManifestNativeCache(duplicate)), 'ERR-MN-CACHE-DUPLICATE-KEY');
  const escaped = '{"cacheSchemaVersion":1,"\\u0063acheSchemaVersion":1,"keyring":"{}","channel":"{}","releaseManifest":"{}"}';
  assert.equal(errorCode(parseManifestNativeCache(escaped)), 'ERR-MN-CACHE-DUPLICATE-KEY');
  // Duplicate keys inside an embedded signed document are rejected at parse.
  const dupDoc = '{"payload":{"a":1},"payload":{"a":2},"signature":{"keyId":"pgw-x-1","value":"AA=="}}';
  assert.equal(errorCode(parseManifestNativeCache(JSON.stringify({ cacheSchemaVersion: 1, keyring: dupDoc, channel: '{}', releaseManifest: '{}' }))), 'ERR-MN-CACHE-SCHEMA');
  void chain;
});

test('cache: oversized cache rejects at the 200 KiB ceiling', () => {
  const chain = buildNativeChain();
  const valid = cacheText(chain);
  const padding = ' '.repeat(MAX_CACHE_BYTES + 1 - Buffer.byteLength(valid, 'utf8'));
  const oversized = valid.replace('{', `{${padding}`);
  assert.equal(Buffer.byteLength(oversized, 'utf8') > MAX_CACHE_BYTES, true);
  assert.equal(errorCode(parseManifestNativeCache(oversized)), 'ERR-MN-CACHE-SIZE');
});

test('cache: canonical path derives from release ID and digest only', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const expected = join(ns.layout.manifestsRoot, ns.chain.releaseId, `${ns.receipt.gateway.releaseManifestSha256}.json`);
    assert.equal(ns.cachePath, expected);
    assert.equal(deriveCachePath(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256), expected);
    // Non-canonical identity cannot derive a path.
    assert.equal(deriveCachePath(ns.layout, 'BAD-ID', ns.receipt.gateway.releaseManifestSha256), null);
    assert.equal(deriveCachePath(ns.layout, ns.chain.releaseId, 'zz'.repeat(32)), null);
    // Digest and release-ID path mismatches fail classification.
    const deps = nativeClassifyDeps();
    const { renameSync, mkdirSync } = await import('node:fs');
    const wrongPath = join(ns.layout.manifestsRoot, ns.chain.releaseId, `${'9'.repeat(64)}.json`);
    renameSync(ns.cachePath, wrongPath);
    let verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
    renameSync(wrongPath, ns.cachePath);
    const otherId = 'gateway-other-id-0001';
    mkdirSync(join(ns.layout.manifestsRoot, otherId));
    renameSync(ns.cachePath, join(ns.layout.manifestsRoot, otherId, `${ns.receipt.gateway.releaseManifestSha256}.json`));
    verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('cache: signed document tampering rejects (digest binding and envelope corruption)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    // Payload tampering without re-signing breaks the channel digest binding.
    const envelope = JSON.parse((await import('node:fs')).readFileSync(ns.cachePath, 'utf8')) as { releaseManifest: string };
    const release = JSON.parse(envelope.releaseManifest) as { payload: { version: string } };
    release.payload.version = '0.2.0';
    envelope.releaseManifest = JSON.stringify(release);
    writeFileSync(ns.cachePath, JSON.stringify(envelope));
    const verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});
