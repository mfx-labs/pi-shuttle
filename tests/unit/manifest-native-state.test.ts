/** NEW-STATE Slice A — state model tests: CLEAN / VALID / MALFORMED with exactly three outcomes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveManifestNativeLayout } from '../../src/host/environment.js';
import { classifyManifestNativeState } from '../../src/manifest-native/state.js';
import {
  materializeNativeNamespace,
  mkdirp0700,
  nativeBaseDir,
  nativeClassifyDeps,
  removeNativeBase,
} from '../helpers/manifest-native-fixtures.js';

const LANE = 'linux-x86_64-posix-utf8-node22';

test('state: absent native namespace is CLEAN', async () => {
  const base = nativeBaseDir();
  try {
    const layout = resolveManifestNativeLayout(base);
    const verdict = await classifyManifestNativeState(layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'CLEAN');
  } finally {
    removeNativeBase(base);
  }
});

test('state: complete valid receipt/cache/tree fixture is VALID', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'VALID_MANIFEST_NATIVE_INSTALLATION');
    if (verdict.kind !== 'VALID_MANIFEST_NATIVE_INSTALLATION') return;
    assert.equal(verdict.installation.packageRoot, ns.packageRoot);
    assert.equal(verdict.installation.binPath, ns.binPath);
    assert.equal(verdict.installation.packageTreeSha256, ns.packageTreeSha256);
    assert.equal(verdict.installation.receipt.gateway.releaseId, ns.chain.releaseId);
  } finally {
    removeNativeBase(base);
  }
});

test('state: malformed receipt content is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    writeFileSync(ns.layout.receiptPath, '{not json');
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('state: unexpected native entry is MALFORMED, never CLEAN', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    writeFileSync(join(ns.layout.authorityRoot, 'mystery'), 'x');
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('state: orphan bounded native objects do not establish an installation (CLEAN)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    // Cache + tree orphans without a receipt.
    rmSync(ns.layout.receiptPath);
    let verdict = await classifyManifestNativeState(ns.layout, LANE, deps);
    assert.equal(verdict.kind, 'CLEAN', 'orphan cache/tree without receipt must stay CLEAN');
    // Tree-only orphans.
    rmSync(ns.layout.manifestsRoot, { recursive: true, force: true });
    mkdirp0700(ns.layout.manifestsRoot);
    verdict = await classifyManifestNativeState(ns.layout, LANE, deps);
    assert.equal(verdict.kind, 'CLEAN');
    // Cache-only orphans (empty tree namespace).
    rmSync(ns.layout.packagesRoot, { recursive: true, force: true });
    mkdirp0700(ns.layout.packagesRoot);
    verdict = await classifyManifestNativeState(ns.layout, LANE, deps);
    assert.equal(verdict.kind, 'CLEAN');
  } finally {
    removeNativeBase(base);
  }
});

test('state: receipt without cache is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('state: receipt with cache but no package tree is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.packageRoot, { recursive: true, force: true });
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('state: conflicting content-addressed cache objects are MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    // A second cache file (same release dir, different digest name).
    writeFileSync(join(join(ns.layout.manifestsRoot, ns.receipt.gateway.releaseId), `${'d'.repeat(64)}.json`), '{}');
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('state: conflicting package-tree objects are MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    mkdirp0700(join(ns.layout.packagesSha256Root, 'e'.repeat(64)));
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('state: cache at a non-canonical path is MALFORMED (digest/path and release-ID/path binding)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    // Digest/path mismatch: move the cache to a digest-named path that does not match.
    const wrongDigestPath = join(join(ns.layout.manifestsRoot, ns.receipt.gateway.releaseId), `${'f'.repeat(64)}.json`);
    renameSync(ns.cachePath, wrongDigestPath);
    let verdict = await classifyManifestNativeState(ns.layout, LANE, deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', 'digest/path mismatch must be rejected');
    // Release-ID/path mismatch: restore, then move to a different releaseId directory.
    renameSync(wrongDigestPath, ns.cachePath);
    mkdirp0700(join(ns.layout.manifestsRoot, 'gateway-other-release-001'));
    renameSync(ns.cachePath, join(ns.layout.manifestsRoot, 'gateway-other-release-001', `${ns.receipt.gateway.releaseManifestSha256}.json`));
    verdict = await classifyManifestNativeState(ns.layout, LANE, deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', 'release-ID/path mismatch must be rejected');
  } finally {
    removeNativeBase(base);
  }
});

test('state: tampered cached chain fails closed (never CLEAN, never VALID)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    // Tamper the embedded release document payload without re-signing.
    const cacheText = (await import('node:fs')).readFileSync(ns.cachePath, 'utf8');
    const envelope = JSON.parse(cacheText) as { releaseManifest: string };
    const release = JSON.parse(envelope.releaseManifest) as { payload: { version: string } };
    release.payload.version = '9.9.9';
    envelope.releaseManifest = JSON.stringify(release);
    writeFileSync(ns.cachePath, JSON.stringify(envelope));
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('state: tree content drift fails closed', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    writeFileSync(join(ns.packageRoot, 'lib', 'core.js'), 'export const core = 2;\n');
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', 'drifted tree bytes must fail closed');
  } finally {
    removeNativeBase(base);
  }
});

test('state: symlinked tree entry fails closed', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    mkdirSync(join(ns.packageRoot, 'lib'), { recursive: true });
    symlinkSync(join(ns.packageRoot, 'package.json'), join(ns.packageRoot, 'lib', 'linked.json'));
    const verdict = await classifyManifestNativeState(ns.layout, LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});
