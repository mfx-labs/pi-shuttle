/**
 * Manifest-native Slice-A test fixtures: signed native namespaces built
 * with the SAME production Slice-A code (receipt builder, cache
 * serializer, path derivation, package-tree hashing, classifier). All
 * release identity (release IDs, versions, commits, digests) lives HERE
 * in test code only — no manifest-native release literal exists in
 * production source.
 */
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveManifestNativeLayout } from '../../src/host/environment.js';
import type { ManifestNativeLayout } from '../../src/host/environment.js';
import { GATEWAY_TRUST_POLICY } from '../../src/installer/release/trust.js';
import type { TrustResult, VerifiedInstalledEvidence, VerifiedReleaseSelection } from '../../src/installer/release/trust.js';
import type { TrustVerifier } from '../../src/installer/release/trust-internal.js';
import { hashPackageTree, readPackageIdentity } from '../../src/installer/artifact.js';
import type { PackageIdentity } from '../../src/installer/artifact.js';
import { buildManifestNativeReceipt, serializeManifestNativeReceipt } from '../../src/manifest-native/receipt.js';
import type { ParsedManifestNativeReceipt } from '../../src/manifest-native/receipt.js';
import { serializeManifestNativeCache } from '../../src/manifest-native/cache.js';
import { deriveCachePath, derivePackageRoot } from '../../src/manifest-native/paths.js';
import {
  FIXTURE_NOW,
  fixtureVerifier,
  gatewayReleasePayload,
  signedGatewayRelease,
  signedKeyring,
  signedStableChannel,
} from './release-trust-fixtures.js';

/** Fixed portable test lane (linux x64; present in the compiled policy on every host). */
export const TEST_LANE = 'linux-x86_64-posix-utf8-node22';

export function testLaneContract(): { readonly packageName: string; readonly binName: string } {
  const contract = GATEWAY_TRUST_POLICY.laneContracts[TEST_LANE];
  assert.ok(contract !== undefined, 'test lane must be a compiled supported lane');
  return contract;
}

export interface NativeChain {
  readonly keyringText: string;
  readonly channelText: string;
  readonly releaseText: string;
  readonly releaseId: string;
}

/** Sign a fresh keyring/channel/release chain for the test lane. */
export function buildNativeChain(releaseOverrides: Record<string, unknown> = {}): NativeChain {
  const contract = testLaneContract();
  const releaseText = signedGatewayRelease({
    ...gatewayReleasePayload(),
    packageName: contract.packageName,
    binName: contract.binName,
    supportedLanes: [TEST_LANE],
    ...releaseOverrides,
  });
  const keyringText = signedKeyring();
  const channelText = signedStableChannel(releaseText);
  const releaseId = ((JSON.parse(releaseText) as { payload: { releaseId: string } }).payload).releaseId;
  return { keyringText, channelText, releaseText, releaseId };
}

/** Default package tree contents for the test lane contract. */
export function nativeTreeFiles(extra: Record<string, string> = {}, version = '0.1.1'): Record<string, string> {
  const contract = testLaneContract();
  return {
    'package.json': JSON.stringify({ name: contract.packageName, version, bin: { [contract.binName]: 'bin/run.js' } }),
    'lib/core.js': 'export const core = 1;\n',
    'bin/run.js': '#!/usr/bin/env node\nconsole.log("gateway");\n',
    ...extra,
  };
}

/** Write a package tree (all files mode 0600, dirs 0700). */
export function writeNativeTree(root: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(root, rel);
    mkdirSync(join(target, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(target, content);
  }
  chmodTree(root);
}

/** Enforce the manifest-native directory/file mode contract on a tree. */
export function chmodTree(root: string): void {
  chmodSync(root, 0o700);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const stat = lstatSync(p);
      if (stat.isDirectory()) {
        chmodSync(p, 0o700);
        walk(p);
      } else {
        chmodSync(p, 0o600);
      }
    }
  };
  walk(root);
}

export function mkdirp0700(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export interface NativeNamespace {
  readonly baseDir: string;
  readonly layout: ManifestNativeLayout;
  readonly chain: NativeChain;
  readonly receipt: ParsedManifestNativeReceipt;
  readonly receiptText: string;
  readonly selection: VerifiedInstalledEvidence;
  readonly packageTreeSha256: string;
  readonly packageIdentity: PackageIdentity;
  readonly packageRoot: string;
  readonly binPath: string;
  readonly cachePath: string;
  /**
   * Installed-evidence provenance gate bound to the verifier instance
   * that produced `selection` (F-01): consumers of the namespace must
   * pass this when reconciliation provenance is required.
   */
  readonly requireInstalledEvidence: (value: unknown) => TrustResult<VerifiedInstalledEvidence>;
  /**
   * Fresh-selection provenance gate bound to the same verifier instance
   * (needed by receipt construction when fresh authority is consumed).
   */
  readonly requireReleaseSelection: (value: unknown) => TrustResult<VerifiedReleaseSelection>;
}

/** Fresh temp base directory for one namespace (layout derives under it). */
export function nativeBaseDir(): string {
  return join(tmpdir(), `pi-shuttle-mn-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
}

/** Remove a namespace base directory. */
export function removeNativeBase(baseDir: string): void {
  rmSync(baseDir, { recursive: true, force: true });
}

/**
 * Materialize a complete VALID native namespace: signed chain, cache at
 * the derived content-addressed path, package tree at the derived
 * content-addressed root, and a receipt built by the production builder.
 * One verifier instance is used for BOTH verification and the runtime
 * provenance gate, so the produced selection is provenance-consistent.
 */
export async function materializeNativeNamespace(
  baseDir: string,
  releaseOverrides: Record<string, unknown> = {},
  treeFiles?: Record<string, string>,
  verifier: TrustVerifier = fixtureVerifier(FIXTURE_NOW),
): Promise<NativeNamespace> {
  const layout = resolveManifestNativeLayout(baseDir);
  const files = treeFiles ?? nativeTreeFiles();

  // Tree first (content-addressed): stage, hash with the production
  // algorithm, then materialize at the derived root.
  const staging = join(baseDir, '__staging__');
  writeNativeTree(staging, files);
  const treeHash = await hashPackageTree(staging);
  assert.equal(treeHash.ok, true, treeHash.ok ? 'tree hashed' : `${treeHash.code}: ${treeHash.message}`);
  if (!treeHash.ok) throw new Error('fixture tree did not hash');

  // Sign the chain binding the REAL tree digest (never the placeholder).
  const chain = buildNativeChain({ ...releaseOverrides, packageTreeSha256: treeHash.value });
  const verified = verifier.verifyInstalledEvidence({
    keyringText: chain.keyringText,
    channelText: chain.channelText,
    releaseText: chain.releaseText,
  });
  assert.equal(verified.ok, true, verified.ok ? 'chain verified' : `${verified.code}: ${verified.message}`);
  if (!verified.ok) throw new Error('fixture chain did not verify');
  const selection = verified.value;
  const version = ((JSON.parse(chain.releaseText) as { payload: { version: string } }).payload).version;

  const packageRoot = derivePackageRoot(layout, treeHash.value);
  assert.ok(packageRoot !== null);
  mkdirp0700(layout.packagesRoot);
  mkdirp0700(layout.packagesSha256Root);
  mkdirp0700(packageRoot);
  writeNativeTree(packageRoot, files);

  const packageIdentity = readPackageIdentity(packageRoot);
  assert.ok(packageIdentity !== null, 'fixture tree must expose a package identity');
  assert.equal(packageIdentity.version, version, 'fixture package version must match the signed release');

  const built = buildManifestNativeReceipt(
    {
      selection,
      layout,
      hostLane: TEST_LANE,
      packageTreeSha256: treeHash.value,
      packageIdentity,
    },
    {
      requireReleaseSelection: (value) => verifier.requireVerifiedReleaseSelection(value),
      requireInstalledEvidence: (value) => verifier.requireVerifiedInstalledEvidence(value),
    },
  );
  assert.equal(built.ok, true, built.ok ? 'receipt built' : `${built.code}: ${built.message}`);
  if (!built.ok) throw new Error('fixture receipt did not build');
  const receipt = built.receipt;

  const cachePath = deriveCachePath(layout, receipt.gateway.releaseId, receipt.gateway.releaseManifestSha256);
  assert.ok(cachePath !== null);
  mkdirp0700(layout.manifestsRoot);
  mkdirp0700(join(cachePath, '..'));
  mkdirp0700(layout.authorityRoot);
  writeFileSync(layout.receiptPath, serializeManifestNativeReceipt(receipt));
  chmodSync(layout.receiptPath, 0o600);
  writeFileSync(cachePath, serializeManifestNativeCache({
    cacheSchemaVersion: 1,
    keyringText: chain.keyringText,
    channelText: chain.channelText,
    releaseManifestText: chain.releaseText,
  }));
  chmodSync(cachePath, 0o600);

  return {
    baseDir,
    layout,
    chain,
    receipt,
    receiptText: serializeManifestNativeReceipt(receipt),
    selection,
    packageTreeSha256: treeHash.value,
    packageIdentity,
    packageRoot,
    binPath: receipt.gateway.binPath,
    cachePath,
    requireInstalledEvidence: (value) => verifier.requireVerifiedInstalledEvidence(value),
    requireReleaseSelection: (value) => verifier.requireVerifiedReleaseSelection(value),
  };
}

/** Fixture verification seam for the classifier: one verifier instance for verify + provenance. */
export function nativeClassifyDeps(verifier = fixtureVerifier(FIXTURE_NOW)): {
  readonly uid: number;
  readonly verifyInstalledEvidence: (input: { readonly keyringText: string; readonly channelText: string; readonly releaseText: string }) => TrustResult<VerifiedInstalledEvidence>;
  readonly requireInstalledEvidence: (value: unknown) => TrustResult<VerifiedInstalledEvidence>;
} {
  return {
    uid: process.getuid?.() ?? -1,
    verifyInstalledEvidence: (input) => verifier.verifyInstalledEvidence(input),
    requireInstalledEvidence: (value) => verifier.requireVerifiedInstalledEvidence(value),
  };
}
