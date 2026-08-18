/**
 * NEW-STATE Slice A — future-release decoupling proof: two test-only
 * compatible releases (A and B) differing in every release identity
 * dimension (release ID, version, source commit, artifact filename,
 * artifact SHA, package-tree SHA, predecessor relation) while keeping the
 * same manifest schema, protocols, lane, and package/bin contract. Both
 * reconcile through the SAME production Slice-A code — with no production
 * source release literal required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { classifyManifestNativeState } from '../../src/manifest-native/state.js';
import {
  materializeNativeNamespace,
  nativeBaseDir,
  nativeClassifyDeps,
  removeNativeBase,
  TEST_LANE,
  testLaneContract,
} from '../helpers/manifest-native-fixtures.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const SRC = join(REPO, 'src');

/** Release A: first compatible release. */
function releaseAOverrides(): Record<string, unknown> {
  return {
    releaseId: 'gateway-native-release-aaa',
    version: '0.1.1',
    sourceCommit: 'a'.repeat(40),
    artifactFileName: 'gateway-native-core-0.1.1.tgz',
    artifactSha256: '1'.repeat(64),
    upgradePolicy: { acceptedPredecessorReleaseIds: [], rollback: 'forbidden' },
  };
}

/** Release B: compatible successor with distinct identity everywhere. */
function releaseBOverrides(): Record<string, unknown> {
  return {
    releaseId: 'gateway-native-release-bbb',
    version: '0.2.0',
    sourceCommit: 'b'.repeat(40),
    artifactFileName: 'gateway-native-core-0.2.0.tgz',
    artifactSha256: '2'.repeat(64),
    upgradePolicy: { acceptedPredecessorReleaseIds: ['gateway-native-release-aaa'], rollback: 'immediate-predecessor' },
  };
}

function treeFilesFor(releaseOverrides: Record<string, unknown>): Record<string, string> {
  const version = releaseOverrides['version'] as string;
  const contract = testLaneContract();
  return {
    'package.json': JSON.stringify({ name: contract.packageName, version, bin: { [contract.binName]: 'bin/run.js' } }),
    'lib/core.js': `export const core = "${version}";\n`,
    'bin/run.js': '#!/usr/bin/env node\nconsole.log("gateway");\n',
    'lib/extra.js': `export const extra = "${version}";\n`,
  };
}

function collectSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSrcFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

test('proof: release A reconciles and classifies VALID through production code', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base, releaseAOverrides(), treeFilesFor(releaseAOverrides()));
    assert.equal(ns.chain.releaseId, 'gateway-native-release-aaa');
    assert.equal(ns.receipt.gateway.releaseId, ns.chain.releaseId);
    const verdict = await classifyManifestNativeState(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'VALID_MANIFEST_NATIVE_INSTALLATION');
    if (verdict.kind !== 'VALID_MANIFEST_NATIVE_INSTALLATION') return;
    assert.equal(verdict.installation.receipt.gateway.packageTreeSha256, ns.packageTreeSha256);
    assert.equal(verdict.installation.packageIdentity.version, '0.1.1');
  } finally {
    removeNativeBase(base);
  }
});

test('proof: release B reconciles and classifies VALID through the same production code', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base, releaseBOverrides(), treeFilesFor(releaseBOverrides()));
    assert.equal(ns.chain.releaseId, 'gateway-native-release-bbb');
    assert.equal(ns.receipt.gateway.releaseId, ns.chain.releaseId);
    const verdict = await classifyManifestNativeState(ns.layout, TEST_LANE, nativeClassifyDeps());
    assert.equal(verdict.kind, 'VALID_MANIFEST_NATIVE_INSTALLATION');
    if (verdict.kind !== 'VALID_MANIFEST_NATIVE_INSTALLATION') return;
    assert.equal(verdict.installation.packageIdentity.version, '0.2.0');
  } finally {
    removeNativeBase(base);
  }
});

test('proof: A and B are fully distinct identities with no production release pin', async () => {
  const baseA = nativeBaseDir();
  const baseB = nativeBaseDir();
  try {
    const nsA = await materializeNativeNamespace(baseA, releaseAOverrides(), treeFilesFor(releaseAOverrides()));
    const nsB = await materializeNativeNamespace(baseB, releaseBOverrides(), treeFilesFor(releaseBOverrides()));
    assert.notEqual(nsA.chain.releaseId, nsB.chain.releaseId);
    assert.notEqual(nsA.receipt.gateway.releaseManifestSha256, nsB.receipt.gateway.releaseManifestSha256);
    assert.notEqual(nsA.packageTreeSha256, nsB.packageTreeSha256);
    assert.notEqual(nsA.binPath, nsB.binPath);
    // Same supported manifest schema, protocols, lane, package/bin contract.
    assert.equal(nsA.selection.release.installProtocol, nsB.selection.release.installProtocol);
    assert.equal(nsA.selection.release.runtimeProtocol, nsB.selection.release.runtimeProtocol);
    assert.equal(nsA.selection.release.packageName, nsB.selection.release.packageName);
    assert.equal(nsA.selection.release.binName, nsB.selection.release.binName);
    // B upgrades from A; A has no predecessor.
    assert.deepEqual(nsA.selection.release.upgradePolicy.acceptedPredecessorReleaseIds, []);
    assert.deepEqual(nsB.selection.release.upgradePolicy.acceptedPredecessorReleaseIds, ['gateway-native-release-aaa']);
    // No release identity literal exists in production source.
    const sources = collectSrcFiles(SRC);
    assert.ok(sources.length > 0);
    for (const file of sources) {
      const content = readFileSync(file, 'utf8');
      assert.equal(content.includes('gateway-native-release-aaa'), false, `${file} must not contain release A identity`);
      assert.equal(content.includes('gateway-native-release-bbb'), false, `${file} must not contain release B identity`);
    }
  } finally {
    removeNativeBase(baseA);
    removeNativeBase(baseB);
  }
});
