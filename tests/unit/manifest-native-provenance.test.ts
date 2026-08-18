/**
 * NEW-STATE Slice A correction — F-01 adversarial provenance tests.
 *
 * Proves that buildManifestNativeReceipt() and
 * reconcileManifestNativeInstallation() reject every structurally forged
 * or cross-verifier/cross-purpose authority value with
 * ERR-TRUST-AUTHORITY, and that genuine verifier-produced values (with
 * the matching runtime provenance gate) still succeed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_NOW, fixtureVerifier } from '../helpers/release-trust-fixtures.js';
import type { TrustVerifier } from '../../src/installer/release/trust-internal.js';
import {
  buildManifestNativeReceipt,
  serializeManifestNativeReceipt,
} from '../../src/manifest-native/receipt.js';
import { reconcileManifestNativeInstallation } from '../../src/manifest-native/reconcile.js';
import type { ReconciliationInput } from '../../src/manifest-native/reconcile.js';
import {
  requireVerifiedInstalledEvidence as productionRequireInstalledEvidence,
  requireVerifiedReleaseSelection as productionRequireReleaseSelection,
} from '../../src/installer/release/trust.js';
import type { VerifiedInstalledEvidence, VerifiedReleaseSelection } from '../../src/installer/release/trust.js';
import {
  buildNativeChain,
  materializeNativeNamespace,
  nativeBaseDir,
  removeNativeBase,
  TEST_LANE,
} from '../helpers/manifest-native-fixtures.js';

/** Materialize a namespace with an explicitly created verifier instance. */
async function namespaceWithVerifier(verifier: TrustVerifier): Promise<Awaited<ReturnType<typeof materializeNativeNamespace>>> {
  const base = nativeBaseDir();
  try {
    return await materializeNativeNamespace(base, {}, undefined, verifier);
  } catch (err) {
    removeNativeBase(base);
    throw err;
  }
}

/** Genuine fresh VerifiedReleaseSelection from `verifier` (fixture chain). */
function freshSelection(verifier: TrustVerifier, releaseOverrides: Record<string, unknown> = {}): VerifiedReleaseSelection {
  const chain = buildNativeChain(releaseOverrides);
  const keyring = verifier.verifyRootSignedKeyring(chain.keyringText);
  assert.equal(keyring.ok, true);
  if (!keyring.ok) throw new Error('keyring did not verify');
  const channel = verifier.verifyChannelManifest(chain.channelText, keyring.value);
  assert.equal(channel.ok, true);
  if (!channel.ok) throw new Error('channel did not verify');
  const selection = verifier.verifyReleaseSelection(channel.value, chain.releaseText, keyring.value);
  assert.equal(selection.ok, true);
  if (!selection.ok) throw new Error('selection did not verify');
  return selection.value;
}

function authorityCode(result: { readonly ok: boolean; readonly code?: string }): string {
  assert.equal(result.ok, false);
  return result.ok ? '' : result.code!;
}

test('provenance: forged selection object literals reject at the builder (production and fixture gates)', async () => {
  const verifier = fixtureVerifier(FIXTURE_NOW);
  const ns = await namespaceWithVerifier(verifier);
  try {
    const deps = {
      requireReleaseSelection: (v: unknown) => verifier.requireVerifiedReleaseSelection(v),
      requireInstalledEvidence: (v: unknown) => verifier.requireVerifiedInstalledEvidence(v),
    };
    const input = {
      selection: {} as unknown as VerifiedInstalledEvidence,
      layout: ns.layout,
      hostLane: TEST_LANE,
      packageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
    };
    // Plain object literal (A/B) and cast structural value (C): same runtime shape.
    const forgedFresh = {
      channel: { channel: 'stable', releaseId: ns.chain.releaseId, releaseManifestSha256: 'a'.repeat(64), issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2028-01-01T00:00:00.000Z', signerKeyId: 'pgw-x' },
      release: { releaseId: ns.chain.releaseId },
      releaseManifestSha256: 'a'.repeat(64),
    } as unknown as VerifiedReleaseSelection;
    const forgedInstalled = {
      keyring: { generation: 1, issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2028-01-01T00:00:00.000Z', keys: [] },
      channel: forgedFresh.channel,
      release: forgedFresh.release,
      releaseManifestSha256: 'a'.repeat(64),
    } as unknown as VerifiedInstalledEvidence;
    // Production default gate.
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: forgedFresh })), 'ERR-TRUST-AUTHORITY');
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: forgedInstalled })), 'ERR-TRUST-AUTHORITY');
    // Fixture gate (same rejection: the gate is runtime, not policy-specific).
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: forgedFresh }, deps)), 'ERR-TRUST-AUTHORITY');
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: forgedInstalled }, deps)), 'ERR-TRUST-AUTHORITY');
    // Production gate also rejects genuine FIXTURE-verifier values (test
    // verifier output must never become production manifest-native authority).
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: ns.selection })), 'ERR-TRUST-AUTHORITY');
  } finally {
    removeNativeBase(ns.baseDir);
  }
});

test('provenance: shallow copies and JSON round-trips of genuine values reject', async () => {
  const verifier = fixtureVerifier(FIXTURE_NOW);
  const ns = await namespaceWithVerifier(verifier);
  try {
    const deps = {
      requireReleaseSelection: (v: unknown) => verifier.requireVerifiedReleaseSelection(v),
      requireInstalledEvidence: (v: unknown) => verifier.requireVerifiedInstalledEvidence(v),
    };
    const input = {
      layout: ns.layout,
      hostLane: TEST_LANE,
      packageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
    };
    const shallowCopy = { ...ns.selection } as unknown as VerifiedInstalledEvidence;
    const jsonRoundTrip = JSON.parse(JSON.stringify(ns.selection)) as VerifiedInstalledEvidence;
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: shallowCopy }, deps)), 'ERR-TRUST-AUTHORITY');
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: jsonRoundTrip }, deps)), 'ERR-TRUST-AUTHORITY');
    // Reconciliation: same rejections.
    const forged = { ...input, receipt: ns.receipt, selection: jsonRoundTrip, verifiedPackageTreeSha256: ns.packageTreeSha256, requireInstalledEvidence: ns.requireInstalledEvidence } as ReconciliationInput;
    assert.equal(authorityCode(reconcileManifestNativeInstallation(forged)), 'ERR-TRUST-AUTHORITY');
    const shallow = { ...input, receipt: ns.receipt, selection: shallowCopy, verifiedPackageTreeSha256: ns.packageTreeSha256, requireInstalledEvidence: ns.requireInstalledEvidence } as ReconciliationInput;
    assert.equal(authorityCode(reconcileManifestNativeInstallation(shallow)), 'ERR-TRUST-AUTHORITY');
  } finally {
    removeNativeBase(ns.baseDir);
  }
});

test('provenance: authority from a separate verifier instance rejects (F)', async () => {
  const verifierA = fixtureVerifier(FIXTURE_NOW);
  const verifierB = fixtureVerifier(FIXTURE_NOW);
  const ns = await namespaceWithVerifier(verifierA);
  try {
    // Selection produced by verifier B, gates from verifier A.
    const other = await namespaceWithVerifier(verifierB);
    try {
      const deps = {
        requireReleaseSelection: (v: unknown) => verifierA.requireVerifiedReleaseSelection(v),
        requireInstalledEvidence: (v: unknown) => verifierA.requireVerifiedInstalledEvidence(v),
      };
      const input = {
        layout: ns.layout,
        hostLane: TEST_LANE,
        packageTreeSha256: ns.packageTreeSha256,
        packageIdentity: ns.packageIdentity,
      };
      assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: other.selection }, deps)), 'ERR-TRUST-AUTHORITY');
      const forged = { ...input, receipt: ns.receipt, selection: other.selection, verifiedPackageTreeSha256: ns.packageTreeSha256, requireInstalledEvidence: ns.requireInstalledEvidence } as ReconciliationInput;
      assert.equal(authorityCode(reconcileManifestNativeInstallation(forged)), 'ERR-TRUST-AUTHORITY');
    } finally {
      removeNativeBase(other.baseDir);
    }
  } finally {
    removeNativeBase(ns.baseDir);
  }
});

test('provenance: fresh selection is rejected where installed evidence is required (G)', async () => {
  const verifier = fixtureVerifier(FIXTURE_NOW);
  const ns = await namespaceWithVerifier(verifier);
  try {
    const fresh = freshSelection(verifier);
    // Trust API level: fresh value fails the installed-evidence gate.
    assert.equal(authorityCode(verifier.requireVerifiedInstalledEvidence(fresh)), 'ERR-TRUST-AUTHORITY');
    // Reconciliation level: genuine fresh selection cannot compensate for
    // missing installed-evidence provenance.
    const forged = {
      receipt: ns.receipt,
      selection: fresh as unknown as VerifiedInstalledEvidence,
      layout: ns.layout,
      hostLane: TEST_LANE,
      verifiedPackageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
      requireInstalledEvidence: ns.requireInstalledEvidence,
    };
    assert.equal(authorityCode(reconcileManifestNativeInstallation(forged)), 'ERR-TRUST-AUTHORITY');
  } finally {
    removeNativeBase(ns.baseDir);
  }
});

test('provenance: installed evidence is rejected where fresh selection is required (H)', async () => {
  const verifier = fixtureVerifier(FIXTURE_NOW);
  const ns = await namespaceWithVerifier(verifier);
  try {
    // Trust API level: installed value fails the fresh gate.
    assert.equal(authorityCode(verifier.requireVerifiedReleaseSelection(ns.selection)), 'ERR-TRUST-AUTHORITY');
    // Builder level: a genuine installed value passes the installed gate,
    // and the fresh gate rejects it — so it is consumed under the correct
    // purpose, never masquerading as fresh authority.
    const built = buildManifestNativeReceipt(
      {
        selection: ns.selection,
        layout: ns.layout,
        hostLane: TEST_LANE,
        packageTreeSha256: ns.packageTreeSha256,
        packageIdentity: ns.packageIdentity,
      },
      {
        requireReleaseSelection: (v) => verifier.requireVerifiedReleaseSelection(v),
        requireInstalledEvidence: (v) => verifier.requireVerifiedInstalledEvidence(v),
      },
    );
    assert.equal(built.ok, true, 'genuine installed evidence must still build through the installed purpose');
  } finally {
    removeNativeBase(ns.baseDir);
  }
});

test('provenance: genuine verifier-produced values succeed at builder and reconciliation', async () => {
  const verifier = fixtureVerifier(FIXTURE_NOW);
  const ns = await namespaceWithVerifier(verifier);
  try {
    const deps = {
      requireReleaseSelection: (v: unknown) => verifier.requireVerifiedReleaseSelection(v),
      requireInstalledEvidence: (v: unknown) => verifier.requireVerifiedInstalledEvidence(v),
    };
    const input = {
      layout: ns.layout,
      hostLane: TEST_LANE,
      packageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
    };
    // Genuine installed evidence builds and reproduces the fixture receipt.
    const builtInstalled = buildManifestNativeReceipt({ ...input, selection: ns.selection }, deps);
    assert.equal(builtInstalled.ok, true);
    if (!builtInstalled.ok) return;
    assert.equal(serializeManifestNativeReceipt(builtInstalled.receipt), ns.receiptText);
    // Genuine fresh selection builds through the fresh purpose (chain
    // binds the same real tree digest as the namespace).
    const fresh = freshSelection(verifier, { packageTreeSha256: ns.packageTreeSha256 });
    const builtFresh = buildManifestNativeReceipt({ ...input, selection: fresh }, deps);
    assert.equal(builtFresh.ok, true);
    if (!builtFresh.ok) return;
    assert.equal(builtFresh.receipt.gateway.releaseId, fresh.channel.releaseId);
    // Genuine installed evidence reconciles.
    const reconciled = reconcileManifestNativeInstallation(reconcileInput(ns));
    assert.equal(reconciled.ok, true);
    if (!reconciled.ok) return;
    assert.equal(reconciled.value.packageRoot, ns.packageRoot);
  } finally {
    removeNativeBase(ns.baseDir);
  }
});

test('provenance: production gates accept only production-verifier objects', async () => {
  const verifier = fixtureVerifier(FIXTURE_NOW);
  const ns = await namespaceWithVerifier(verifier);
  try {
    // Fixture provenance never passes the production gates.
    assert.equal(authorityCode(productionRequireInstalledEvidence(ns.selection)), 'ERR-TRUST-AUTHORITY');
    const fresh = freshSelection(verifier);
    assert.equal(authorityCode(productionRequireReleaseSelection(fresh)), 'ERR-TRUST-AUTHORITY');
    // The production default gates in the builder/reconciliation behave
    // identically (they ARE the production gates).
    const input = {
      layout: ns.layout,
      hostLane: TEST_LANE,
      packageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
    };
    assert.equal(authorityCode(buildManifestNativeReceipt({ ...input, selection: ns.selection })), 'ERR-TRUST-AUTHORITY');
  } finally {
    removeNativeBase(ns.baseDir);
  }
});

/** Local helper mirroring the reconcile-input shape used by other suites. */
function reconcileInput(ns: Awaited<ReturnType<typeof materializeNativeNamespace>>): ReconciliationInput {
  return {
    receipt: ns.receipt,
    selection: ns.selection,
    layout: ns.layout,
    hostLane: TEST_LANE,
    verifiedPackageTreeSha256: ns.packageTreeSha256,
    packageIdentity: ns.packageIdentity,
    requireInstalledEvidence: ns.requireInstalledEvidence,
  };
}
