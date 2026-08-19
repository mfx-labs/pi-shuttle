/**
 * PUBLICATION-LAYOUT correction — flat Gateway metadata release-asset
 * naming contract tests. GitHub Release assets cannot represent
 * slash-bearing names, so every signed metadata document is published as
 * ONE flat filename directly under the release tag. The constructor is
 * pure and fails closed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_FILE_NAME_RE } from '../../src/installer/release/document.js';
import {
  flatGatewayMetadataAssets,
  GATEWAY_META_KEYRING_ASSET,
  GATEWAY_META_RELEASE_ASSET_PREFIX,
  GATEWAY_META_STABLE_CHANNEL_ASSET,
  releaseManifestAssetName,
} from '../../src/manifest-native/release-assets.js';

const RELEASE_ID = 'gateway-macos-release-002';
const MANIFEST_SHA = '6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd6630';
const EXPECTED_MANIFEST_ASSET = 'gateway-meta-release-gateway-macos-release-002-6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd6630.json';

test('release-assets: fixed keyring/channel names are single flat filenames', () => {
  for (const name of [GATEWAY_META_KEYRING_ASSET, GATEWAY_META_STABLE_CHANNEL_ASSET]) {
    assert.equal(RELEASE_FILE_NAME_RE.test(name), true, name);
    assert.equal(name.includes('/'), false, name);
    assert.equal(name.includes('\\'), false, name);
    assert.equal(name.includes('..'), false, name);
  }
  assert.equal(GATEWAY_META_KEYRING_ASSET, 'gateway-meta-keyring.json');
  assert.equal(GATEWAY_META_STABLE_CHANNEL_ASSET, 'gateway-meta-stable-channel.json');
});

test('release-assets: valid release selection derives the exact flat manifest asset name', () => {
  const name = releaseManifestAssetName(RELEASE_ID, MANIFEST_SHA);
  assert.equal(name, EXPECTED_MANIFEST_ASSET);
  if (name === null) return;
  assert.equal(RELEASE_FILE_NAME_RE.test(name), true, name);
  assert.equal(name.includes('/'), false);
  assert.equal(name.includes('\\'), false);
  assert.equal(name.includes('..'), false);
  // One filename component only: no path separator, no dot path component.
  assert.equal(name.split('.').length, 2);
  assert.equal(name.startsWith(GATEWAY_META_RELEASE_ASSET_PREFIX), true);
});

test('release-assets: non-canonical release IDs fail closed', () => {
  for (const releaseId of [
    '', 'x', 'ab', // too short for the grammar (needs >= 3 chars)
    'Uppercase', 'with/Uppercase', 'with\\Backslash', 'space here',
    '-leading', 'has#hash', 'has?question', 'has%percent', 'has&', 'has=equal',
    'a'.repeat(129), '🙂',
  ]) {
    assert.equal(releaseManifestAssetName(releaseId, MANIFEST_SHA), null, `releaseId ${JSON.stringify(releaseId)} must fail closed`);
    assert.equal(flatGatewayMetadataAssets(releaseId, MANIFEST_SHA), null, `releaseId ${JSON.stringify(releaseId)} must fail closed`);
  }
});

test('release-assets: grammar-valid odd release IDs still yield exactly one flat filename', () => {
  for (const releaseId of ['trailing-', 'double..dot', 'xn--', 'lone-', 'a.1-2', 'gateway-macos-release-002']) {
    const name = releaseManifestAssetName(releaseId, MANIFEST_SHA);
    assert.notEqual(name, null, releaseId);
    if (name === null) continue;
    assert.equal(RELEASE_FILE_NAME_RE.test(name), true, name);
    assert.equal(name.includes('/'), false, name);
    assert.equal(name.includes('\\'), false, name);
  }
});

test('release-assets: non-canonical manifest digests fail closed', () => {
  const hex = MANIFEST_SHA;
  for (const digest of [
    '', hex.toUpperCase(), hex.slice(1), hex + '0', hex.replace('a', 'z'), hex.replace('0', 'g'),
    'https://evil/x', '../'+hex, hex + '.json', hex + '/..', '0'.repeat(63), '0'.repeat(65),
  ]) {
    assert.equal(releaseManifestAssetName(RELEASE_ID, digest), null, `digest ${JSON.stringify(digest)} must fail closed`);
    assert.equal(flatGatewayMetadataAssets(RELEASE_ID, digest), null, `digest ${JSON.stringify(digest)} must fail closed`);
  }
});

test('release-assets: flat metadata asset set mirrors the production origin contract', () => {
  const set = flatGatewayMetadataAssets(RELEASE_ID, MANIFEST_SHA);
  assert.deepEqual(set, {
    keyring: 'gateway-meta-keyring.json',
    stableChannel: 'gateway-meta-stable-channel.json',
    releaseManifest: EXPECTED_MANIFEST_ASSET,
  });
  if (set === null) return;
  for (const name of Object.values(set)) {
    assert.equal(RELEASE_FILE_NAME_RE.test(name), true, name);
    assert.equal(name.includes('/'), false, name);
    assert.equal(name.includes('\\'), false, name);
  }
});
