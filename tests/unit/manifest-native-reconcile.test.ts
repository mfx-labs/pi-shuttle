/** NEW-STATE Slice A — pure receipt/cache/release reconciliation tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeJcs } from '../../src/installer/release/trust.js';
import { createTrustVerifier } from '../../src/installer/release/trust-internal.js';
import { FIXTURE_NOW, FIXTURE_POLICY } from '../helpers/release-trust-fixtures.js';
import { parseManifestNativeReceipt } from '../../src/manifest-native/receipt.js';
import { reconcileManifestNativeInstallation } from '../../src/manifest-native/reconcile.js';
import type { ReconciliationInput } from '../../src/manifest-native/reconcile.js';
import {
  materializeNativeNamespace,
  nativeBaseDir,
  removeNativeBase,
  TEST_LANE,
} from '../helpers/manifest-native-fixtures.js';

const OTHER_LANE = 'darwin-arm64-posix-utf8-node22';

/** Edit a receipt field while keeping the document parseable (re-serialized JCS). */
function editedReceipt(receiptText: string, edits: Record<string, unknown>, gatewayEdits: Record<string, unknown> = {}): string {
  const doc = JSON.parse(receiptText) as { gateway: Record<string, unknown> };
  return `${canonicalizeJcs({ ...doc, ...edits, gateway: { ...doc.gateway, ...gatewayEdits } })}\n`;
}

/** Reconciliation input from a materialized namespace, with per-test overrides. */
function reconcileInput(ns: Awaited<ReturnType<typeof materializeNativeNamespace>>, overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    receipt: ns.receipt,
    selection: ns.selection,
    layout: ns.layout,
    hostLane: TEST_LANE,
    verifiedPackageTreeSha256: ns.packageTreeSha256,
    packageIdentity: ns.packageIdentity,
    requireInstalledEvidence: ns.requireInstalledEvidence,
    ...overrides,
  };
}

test('reconcile: valid reconciled installation succeeds with runtime provenance', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const result = reconcileManifestNativeInstallation({
      receipt: ns.receipt,
      selection: ns.selection,
      layout: ns.layout,
      hostLane: TEST_LANE,
      verifiedPackageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
      requireInstalledEvidence: ns.requireInstalledEvidence,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.packageRoot, ns.packageRoot);
    assert.equal(result.value.binPath, ns.binPath);
    assert.equal(result.value.packageTreeSha256, ns.packageTreeSha256);
    assert.equal(result.value.receipt.gateway.releaseId, ns.chain.releaseId);
    assert.equal(Object.isFrozen(result.value), true);
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: receipt/releaseId mismatch rejects', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const receipt = parseManifestNativeReceipt(editedReceipt(ns.receiptText, {}, { releaseId: 'gateway-tampered-id-001' }));
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    const result = reconcileManifestNativeInstallation(reconcileInput(ns, { receipt: receipt.value }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.code, 'ERR-MN-RECEIPT-RELEASE-ID');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: receipt/release-manifest digest mismatch rejects', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const receipt = parseManifestNativeReceipt(editedReceipt(ns.receiptText, {}, { releaseManifestSha256: 'a'.repeat(64) }));
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    const result = reconcileManifestNativeInstallation(reconcileInput(ns, { receipt: receipt.value }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.code, 'ERR-MN-RECEIPT-MANIFEST-DIGEST');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: receipt/tree digest mismatch rejects (receipt vs signed release, receipt vs verified tree)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const receipt = parseManifestNativeReceipt(editedReceipt(ns.receiptText, {}, { packageTreeSha256: 'b'.repeat(64) }));
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    const result = reconcileManifestNativeInstallation(reconcileInput(ns, { receipt: receipt.value }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.code, 'ERR-MN-RECEIPT-TREE-DIGEST');
    // Verified tree digest disagreement (tree bytes drifted) also rejects.
    const drifted = reconcileManifestNativeInstallation(reconcileInput(ns, { verifiedPackageTreeSha256: 'c'.repeat(64) }));
    assert.equal(drifted.ok, false);
    assert.equal(drifted.ok ? '' : drifted.code, 'ERR-MN-TREE-DIGEST');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: selected-lane and host-lane mismatch reject', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const receipt = parseManifestNativeReceipt(editedReceipt(ns.receiptText, {}, { selectedLane: OTHER_LANE }));
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    const result = reconcileManifestNativeInstallation(reconcileInput(ns, { receipt: receipt.value }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.code, 'ERR-MN-HOST-LANE');
    // Host lane passed differently from the receipt.
    const hostMismatch = reconcileManifestNativeInstallation(reconcileInput(ns, { hostLane: OTHER_LANE }));
    assert.equal(hostMismatch.ok, false);
    assert.equal(hostMismatch.ok ? '' : hostMismatch.code, 'ERR-MN-HOST-LANE');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: packageRoot mismatch rejects (stored path text is never trusted)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const receipt = parseManifestNativeReceipt(editedReceipt(ns.receiptText, {}, { packageRoot: '/tmp/forged-package-root', binPath: '/tmp/forged-package-root/bin/run.js' }));
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    const result = reconcileManifestNativeInstallation(reconcileInput(ns, { receipt: receipt.value }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.code, 'ERR-MN-PACKAGE-ROOT');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: binPath mismatch rejects', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const receipt = parseManifestNativeReceipt(editedReceipt(ns.receiptText, {}, { binPath: `${ns.packageRoot}/bin/other.js` }));
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    const result = reconcileManifestNativeInstallation(reconcileInput(ns, { receipt: receipt.value }));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.code, 'ERR-MN-BIN-PATH');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: package/bin metadata mismatch rejects', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const binName = Object.keys(ns.packageIdentity.bin)[0]!;
    const wrongName = reconcileManifestNativeInstallation(reconcileInput(ns, { packageIdentity: { name: 'forged-name', version: ns.packageIdentity.version, bin: ns.packageIdentity.bin } }));
    assert.equal(wrongName.ok, false);
    assert.equal(wrongName.ok ? '' : wrongName.code, 'ERR-MN-PACKAGE-NAME');
    const wrongVersion = reconcileManifestNativeInstallation(reconcileInput(ns, { packageIdentity: { name: ns.packageIdentity.name, version: '0.0.0', bin: ns.packageIdentity.bin } }));
    assert.equal(wrongVersion.ok, false);
    assert.equal(wrongVersion.ok ? '' : wrongVersion.code, 'ERR-MN-PACKAGE-VERSION');
    const missingBin = reconcileManifestNativeInstallation(reconcileInput(ns, { packageIdentity: { name: ns.packageIdentity.name, version: ns.packageIdentity.version, bin: {} } }));
    assert.equal(missingBin.ok, false);
    assert.equal(missingBin.ok ? '' : missingBin.code, 'ERR-MN-PACKAGE-BIN');
    const escapedBin = reconcileManifestNativeInstallation(reconcileInput(ns, { packageIdentity: { name: ns.packageIdentity.name, version: ns.packageIdentity.version, bin: { [binName]: '../escape.js' } } }));
    assert.equal(escapedBin.ok, false);
    assert.equal(escapedBin.ok ? '' : escapedBin.code, 'ERR-MN-BIN-PATH');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: protocol mismatch rejects against the compiled production policy', async () => {
  const base = nativeBaseDir();
  try {
    // A fixture verifier whose policy allows install protocol 2; the whole
    // namespace (chain, receipt, cache) is built against that policy.
    const permissivePolicy = { ...FIXTURE_POLICY, supportedInstallProtocols: [1, 2] as readonly number[] };
    const permissiveVerifier = createTrustVerifier(permissivePolicy, () => new Date(FIXTURE_NOW.getTime()));
    const ns = await materializeNativeNamespace(base, { installProtocol: 2 }, undefined, permissiveVerifier);
    // Reconciliation re-binds against the COMPILED production policy and rejects.
    const result = reconcileManifestNativeInstallation(reconcileInput(ns));
    assert.equal(result.ok, false);
    assert.equal(result.ok ? '' : result.code, 'ERR-MN-INSTALL-PROTOCOL');
  } finally {
    removeNativeBase(base);
  }
});

test('reconcile: a parsed receipt alone is never a reconciled installation', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const forged = {
      receipt: ns.receipt,
      selection: ns.selection,
      layout: ns.layout,
      hostLane: TEST_LANE,
      verifiedPackageTreeSha256: 'd'.repeat(64),
      packageIdentity: ns.packageIdentity,
    };
    const result = reconcileManifestNativeInstallation(forged);
    assert.equal(result.ok, false);
  } finally {
    removeNativeBase(base);
  }
});
