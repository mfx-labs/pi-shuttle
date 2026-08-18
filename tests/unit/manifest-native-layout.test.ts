/** NEW-STATE Slice A — layout tests: deterministic roots, no override, symlink/ownership/mode/bounds enforcement. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLayout, resolveManifestNativeLayout } from '../../src/host/environment.js';
import { classifyManifestNativeState } from '../../src/manifest-native/state.js';
import { MAX_MANIFEST_DIRS, MAX_TREE_DIRS } from '../../src/manifest-native/state.js';
import {
  materializeNativeNamespace,
  mkdirp0700,
  nativeBaseDir,
  nativeClassifyDeps,
  removeNativeBase,
} from '../helpers/manifest-native-fixtures.js';

test('layout: manifest-native roots derive deterministically from the operator home with no caller override', () => {
  const home = '/home/operator';
  const base = resolveLayout(home);
  const layout = resolveManifestNativeLayout(home);
  assert.equal(layout.authorityRoot, join(base.shareDir, 'manifest-native'));
  assert.equal(layout.receiptPath, join(base.shareDir, 'manifest-native', 'receipt.json'));
  assert.equal(layout.manifestsRoot, join(base.shareDir, 'manifest-native', 'manifests'));
  assert.equal(layout.packagesRoot, join(base.shareDir, 'manifest-native', 'packages'));
  assert.equal(layout.packagesSha256Root, join(base.shareDir, 'manifest-native', 'packages', 'sha256'));
  assert.equal(layout.stateRoot, join(base.stateDir, 'manifest-native'));
  assert.equal(layout.installLockPath, join(base.stateDir, 'manifest-native', 'install.lock'));
  assert.equal(layout.stagingRoot, join(base.stateDir, 'manifest-native', 'staging'));
  // The derivation seam accepts ONLY the operator home: no caller-selected root exists.
  assert.equal(resolveManifestNativeLayout.length, 1);
  const again = resolveManifestNativeLayout(home);
  assert.deepEqual(again, layout);
});

test('layout: symlinked authority root is rejected', async () => {
  const base = nativeBaseDir();
  try {
    const layout = resolveManifestNativeLayout(base);
    const deps = nativeClassifyDeps();
    const outside = join(base, 'outside');
    mkdirp0700(outside);
    mkdirp0700(join(base, '.local', 'share', 'pi-shuttle'));
    symlinkSync(outside, layout.authorityRoot);
    const verdict = await classifyManifestNativeState(layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('layout: symlinked manifests/releaseId/cache components are rejected', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    for (const target of [ns.layout.manifestsRoot, join(ns.layout.manifestsRoot, ns.receipt.gateway.releaseId)]) {
      const tmp = join(ns.baseDir, 'real-m');
      rmSync(tmp, { recursive: true, force: true });
      renameSync(target, tmp);
      symlinkSync(tmp, target);
      const verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
      assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', `symlinked ${target} must be rejected`);
      rmSync(target, { force: true });
      renameSync(tmp, target);
    }
    // Symlinked cache file.
    const cacheBackup = join(ns.baseDir, 'cache-real');
    renameSync(ns.cachePath, cacheBackup);
    symlinkSync(cacheBackup, ns.cachePath);
    const verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', 'symlinked cache file must be rejected');
  } finally {
    removeNativeBase(base);
  }
});

test('layout: ownership and mode enforcement (0700 dirs, 0600 files)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    const cases: Array<[string, number]> = [
      [ns.layout.authorityRoot, 0o755],
      [ns.layout.manifestsRoot, 0o755],
      [join(ns.layout.manifestsRoot, ns.receipt.gateway.releaseId), 0o700 | 0o077],
      [ns.layout.packagesRoot, 0o755],
      [ns.layout.packagesSha256Root, 0o755],
      [ns.packageRoot, 0o755],
      [ns.layout.receiptPath, 0o644],
      [ns.cachePath, 0o644],
    ];
    for (const [path, mode] of cases) {
      const original = statSync(path).mode & 0o7777;
      chmodSync(path, mode);
      const verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
      assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', `${path} with mode ${mode.toString(8)} must be rejected`);
      chmodSync(path, original);
    }
    // Restored modes classify VALID again.
    const restored = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(restored.kind, 'VALID_MANIFEST_NATIVE_INSTALLATION');
  } finally {
    removeNativeBase(base);
  }
});

test('layout: bounded namespace objects', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    // Too many manifest directories (orphan side, no receipt).
    renameSync(ns.layout.receiptPath, join(base, 'receipt-away'));
    for (let i = 0; i < MAX_MANIFEST_DIRS + 1; i++) mkdirp0700(join(ns.layout.manifestsRoot, `gateway-release-dir-${String(i).padStart(3, '0')}`));
    let verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', 'manifests beyond the directory bound must be rejected');

    // Too many package trees.
    rmSync(ns.layout.manifestsRoot, { recursive: true, force: true });
    mkdirp0700(ns.layout.manifestsRoot);
    for (let i = 0; i < MAX_TREE_DIRS + 1; i++) mkdirp0700(join(ns.layout.packagesSha256Root, 'a'.repeat(62) + String(i).padStart(2, '0')));
    verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', 'packages/sha256 beyond the tree bound must be rejected');
  } finally {
    removeNativeBase(base);
  }
});

test('layout: unexpected entries at every structural level are rejected', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    const cases: Array<[string, 'file' | 'dir']> = [
      [join(ns.layout.authorityRoot, 'junk'), 'file'],
      [join(ns.layout.manifestsRoot, 'NOT-a-release-id'), 'dir'],
      [join(ns.layout.manifestsRoot, ns.receipt.gateway.releaseId, 'not-a-digest.json'), 'file'],
      [join(ns.layout.packagesRoot, 'not-sha256'), 'dir'],
      [join(ns.layout.packagesSha256Root, 'not-a-digest'), 'dir'],
    ];
    for (const [path, kind] of cases) {
      if (kind === 'file') writeFileSync(path, '{}');
      else mkdirp0700(path);
      const verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
      assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE', `unexpected entry ${path} must be rejected`);
      rmSync(path, { recursive: true, force: true });
    }
    const restored = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(restored.kind, 'VALID_MANIFEST_NATIVE_INSTALLATION');
  } finally {
    removeNativeBase(base);
  }
});

test('layout: empty native namespace is CLEAN and never establishes an installation', async () => {
  const base = nativeBaseDir();
  try {
    const layout = resolveManifestNativeLayout(base);
    const deps = nativeClassifyDeps();
    const verdict = await classifyManifestNativeState(layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'CLEAN');
    // Structural dirs with nothing inside remain CLEAN.
    mkdirp0700(layout.authorityRoot);
    mkdirp0700(layout.manifestsRoot);
    mkdirp0700(layout.packagesRoot);
    mkdirp0700(layout.packagesSha256Root);
    const empty = await classifyManifestNativeState(layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(empty.kind, 'CLEAN');
  } finally {
    removeNativeBase(base);
  }
});

test('layout: MAX_ROOT_ENTRIES bound rejects an over-full authority root', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    // A fourth root entry exceeds MAX_ROOT_ENTRIES (3) and the closed
    // entry set simultaneously; the bound fires.
    writeFileSync(join(ns.layout.authorityRoot, 'extra.json'), '{}');
    const verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', nativeClassifyDeps());
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
  } finally {
    removeNativeBase(base);
  }
});

test('layout: MAX_CACHE_FILES_PER_MANIFEST bound rejects an over-full manifest directory', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    // Orphan path (no receipt): four extra cache-shaped files in one
    // releaseId directory take the total past MAX_CACHE_FILES_PER_MANIFEST
    // (4; the real cache file already occupies one slot).
    rmSync(ns.layout.receiptPath);
    const releaseDir = join(ns.layout.manifestsRoot, ns.receipt.gateway.releaseId);
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(releaseDir, `${String(i).repeat(64)}.json`), '{}', { mode: 0o600 });
    }
    const verdict = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(verdict.kind, 'MALFORMED_OR_AMBIGUOUS_MANIFEST_NATIVE_STATE');
    // Removing one extra leaves exactly four cache files: within the bound
    // (orphans stay CLEAN).
    rmSync(join(releaseDir, `${'0'.repeat(64)}.json`));
    const within = await classifyManifestNativeState(ns.layout, 'linux-x86_64-posix-utf8-node22', deps);
    assert.equal(within.kind, 'CLEAN');
  } finally {
    removeNativeBase(base);
  }
});
