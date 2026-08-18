/**
 * NEW-STATE Slice B — lifecycle resolution and reconciled runtime
 * provenance tests.
 *
 * Proves the reconciled authority gate (exact identity only; every
 * structural forgery class rejects) and the resolution boundary chain
 * (receipt -> cache -> installed evidence -> tree hash -> reconciliation
 * -> reconciled provenance gate) with exactly CLEAN / VALID / MALFORMED
 * outcomes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveManifestNativeLayout } from '../../src/host/environment.js';
import { reconcileManifestNativeInstallation, requireReconciledManifestNativeInstallation } from '../../src/manifest-native/reconcile.js';
import { hashPackageTree } from '../../src/installer/artifact.js';
import { resolveManifestNativeLifecycle, validateFinalBin } from '../../src/manifest-native/resolve.js';
import {
  materializeNativeNamespace,
  nativeBaseDir,
  nativeClassifyDeps,
  removeNativeBase,
  TEST_LANE,
} from '../helpers/manifest-native-fixtures.js';

function gateCode(result: { readonly ok: boolean; readonly code?: string }): string {
  assert.equal(result.ok, false);
  return result.ok ? '' : result.code!;
}

// ─── reconciled runtime provenance gate (requirement 28) ─────────────────

test('gate: genuine reconciled value passes; every structural forgery rejects', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const reconciled = reconcileManifestNativeInstallation({
      receipt: ns.receipt,
      selection: ns.selection,
      layout: ns.layout,
      hostLane: TEST_LANE,
      verifiedPackageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
      requireInstalledEvidence: ns.requireInstalledEvidence,
    });
    assert.equal(reconciled.ok, true);
    if (!reconciled.ok) return;
    const genuine = reconciled.value;
    // Genuine value passes.
    assert.equal(requireReconciledManifestNativeInstallation(genuine).ok, true);
    // Structural literal.
    assert.equal(gateCode(requireReconciledManifestNativeInstallation({ receipt: ns.receipt, selection: ns.selection })), 'ERR-MN-RECONCILED-AUTHORITY');
    // Shallow copy.
    assert.equal(gateCode(requireReconciledManifestNativeInstallation({ ...genuine })), 'ERR-MN-RECONCILED-AUTHORITY');
    // Object.assign / spread copies.
    assert.equal(gateCode(requireReconciledManifestNativeInstallation(Object.assign({}, genuine))), 'ERR-MN-RECONCILED-AUTHORITY');
    // JSON round-trip.
    assert.equal(gateCode(requireReconciledManifestNativeInstallation(JSON.parse(JSON.stringify(genuine)))), 'ERR-MN-RECONCILED-AUTHORITY');
    // Mutated object.
    assert.equal(gateCode(requireReconciledManifestNativeInstallation({ ...genuine, hostLane: 'other-lane' })), 'ERR-MN-RECONCILED-AUTHORITY');
    // Value from anything except the reconciliation boundary (the raw
    // verified selection, the parsed receipt, an object literal cast).
    assert.equal(gateCode(requireReconciledManifestNativeInstallation(ns.selection)), 'ERR-MN-RECONCILED-AUTHORITY');
    assert.equal(gateCode(requireReconciledManifestNativeInstallation(ns.receipt)), 'ERR-MN-RECONCILED-AUTHORITY');
    assert.equal(gateCode(requireReconciledManifestNativeInstallation(null)), 'ERR-MN-RECONCILED-AUTHORITY');
  } finally {
    removeNativeBase(base);
  }
});

// ─── lifecycle resolution (requirement 29 A–I) ───────────────────────────

test('resolve: empty native namespace is CLEAN', async () => {
  const base = nativeBaseDir();
  try {
    const layout = resolveManifestNativeLayout(base);
    const resolution = await resolveManifestNativeLifecycle(layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'CLEAN');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: valid receipt/cache/tree is VALID with a runtime-proven installation', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'VALID');
    if (resolution.kind !== 'VALID') return;
    // The resolved value is genuinely runtime-proven (exact identity).
    assert.equal(requireReconciledManifestNativeInstallation(resolution.installation).ok, true);
    assert.equal(resolution.installation.binPath, ns.binPath);
    assert.equal(resolution.installation.packageRoot, ns.packageRoot);
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: malformed receipt is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    writeFileSync(ns.layout.receiptPath, '{not json');
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: missing selected cache is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: missing package is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.packageRoot, { recursive: true, force: true });
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: tampered cache is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const text = (await import('node:fs')).readFileSync(ns.cachePath, 'utf8');
    const envelope = JSON.parse(text) as { releaseManifest: string };
    const release = JSON.parse(envelope.releaseManifest) as { payload: { version: string } };
    release.payload.version = '9.9.9';
    envelope.releaseManifest = JSON.stringify(release);
    writeFileSync(ns.cachePath, JSON.stringify(envelope));
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: tampered package tree is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    writeFileSync(join(ns.packageRoot, 'lib', 'core.js'), 'export const core = 2;\n');
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: package presence without a receipt never establishes an installation', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    // Well-formed orphan tree+cache without a receipt: CLEAN, never VALID.
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.notEqual(resolution.kind, 'VALID', 'package presence without a receipt must never establish an installation');
    assert.equal(resolution.kind, 'CLEAN');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: unexpected authority entry is MALFORMED', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    writeFileSync(join(ns.layout.authorityRoot, 'mystery'), 'x');
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
  } finally {
    removeNativeBase(base);
  }
});

test('resolve: fixture-verified namespaces never resolve VALID under production defaults', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE);
    assert.notEqual(resolution.kind, 'VALID', 'fixture provenance must never become production manifest-native authority');
    assert.equal(resolution.kind, 'MALFORMED');
  } finally {
    removeNativeBase(base);
  }
});

// ─── final bin validation (requirement 22 / start TOCTOU boundary) ───────

test('bin: final validation enforces canonical confined path, regular file, owner, and owner-private mode', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = nativeClassifyDeps();
    const reconciled = reconcileManifestNativeInstallation({
      receipt: ns.receipt,
      selection: ns.selection,
      layout: ns.layout,
      hostLane: TEST_LANE,
      verifiedPackageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
      requireInstalledEvidence: ns.requireInstalledEvidence,
    });
    assert.equal(reconciled.ok, true);
    if (!reconciled.ok) return;
    const uid = process.getuid?.() ?? -1;
    // Valid bin passes.
    assert.equal(validateFinalBin(reconciled.value, uid).ok, true);
    // Unsafe mode (group/world bits) rejects.
    const { chmodSync } = await import('node:fs');
    chmodSync(ns.binPath, 0o644);
    const unsafe = validateFinalBin(reconciled.value, uid);
    assert.equal(unsafe.ok, false);
    if (unsafe.ok) return;
    assert.equal(unsafe.code, 'ERR-MN-START-BIN-MODE');
    chmodSync(ns.binPath, 0o600);
    // Symlinked bin rejects.
    rmSync(ns.binPath);
    symlinkSync(join(ns.packageRoot, 'lib', 'core.js'), ns.binPath);
    const linked = validateFinalBin(reconciled.value, uid);
    assert.equal(linked.ok, false);
    if (linked.ok) return;
    assert.equal(linked.code, 'ERR-MN-START-BIN');
    // Non-confined path rejects.
    const forged = { ...reconciled.value, binPath: '/outside/bin' } as typeof reconciled.value;
    const escaped = validateFinalBin(forged, uid);
    assert.equal(escaped.ok, false);
    if (escaped.ok) return;
    assert.equal(escaped.code, 'ERR-MN-START-BIN-PATH');
  } finally {
    removeNativeBase(base);
  }
});

// ─── MN-B-04 complete-tree runtime mode policy ───────────────────────────

import { chmodSync } from 'node:fs';

test('mode-policy: nested directory 0777 fails closed (MALFORMED)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    chmodSync(join(ns.packageRoot, 'lib'), 0o777);
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
    if (resolution.kind !== 'MALFORMED') return;
    assert.match(resolution.reason, /mode/, resolution.reason);
  } finally {
    removeNativeBase(base);
  }
});

test('mode-policy: nested directory 0755 fails closed (exact-0700 policy)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    chmodSync(join(ns.packageRoot, 'lib'), 0o755);
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED');
    if (resolution.kind !== 'MALFORMED') return;
    assert.match(resolution.reason, /0700/, resolution.reason);
  } finally {
    removeNativeBase(base);
  }
});

test('mode-policy: imported JS file 0666 and 0644 fail closed; 0600 valid', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const imported = join(ns.packageRoot, 'lib', 'core.js');
    chmodSync(imported, 0o666);
    let resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED', 'world-writable imported module must fail closed');
    if (resolution.kind !== 'MALFORMED') return;
    assert.match(resolution.reason, /group\/world/, resolution.reason);
    chmodSync(imported, 0o644);
    resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED', 'group/world-readable imported module must fail closed (owner-private policy)');
    chmodSync(imported, 0o600);
    resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'VALID', 'owner-private 0600 imported module is valid');
  } finally {
    removeNativeBase(base);
  }
});

test('mode-policy: mode-only change leaves the digest algorithm unchanged but fails runtime validation', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const before = await hashPackageTree(ns.packageRoot);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    // Mode-only change: content/path unchanged.
    chmodSync(join(ns.packageRoot, 'lib', 'core.js'), 0o644);
    const after = await hashPackageTree(ns.packageRoot);
    assert.equal(after.ok, true, 'digest framing must ignore modes');
    if (!after.ok) return;
    assert.equal(after.value, before.value, 'a mode-only change must not alter the package-tree digest');
    // Runtime tree validation with the mode policy fails closed.
    const withPolicy = await hashPackageTree(ns.packageRoot, {}, { requireOwnerPrivateModes: true });
    assert.equal(withPolicy.ok, false, 'the mode policy must fail closed on unsafe modes');
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'MALFORMED', 'runtime resolution must fail closed on unsafe modes');
  } finally {
    removeNativeBase(base);
  }
});

test('mode-policy: fully owner-private tree (0700 dirs, 0600 files) stays VALID', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const resolution = await resolveManifestNativeLifecycle(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(resolution.kind, 'VALID');
    if (resolution.kind !== 'VALID') return;
    // ValidateFinalBin still enforces the final-bin gate independently.
    assert.equal(validateFinalBin(resolution.installation, process.getuid?.() ?? -1).ok, true);
  } finally {
    removeNativeBase(base);
  }
});
