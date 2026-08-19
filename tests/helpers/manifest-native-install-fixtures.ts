/**
 * FRESH-INSTALL Slice fixtures: signed Gateway release chains bound to
 * REAL artifact tarballs and REAL package-tree digests, served through a
 * fake ReleaseFetcher, with the paired fixture trust/provenance seams.
 *
 * Release A and Release B differ in every per-release identity dimension
 * (releaseId, version, source commit, artifact filename, artifact SHA,
 * package-tree SHA, predecessor policy) while sharing only the stable
 * compatibility contracts (schema, lane, protocols, package/bin contract,
 * trust policy).
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { HostEnvironment } from '../../src/host/environment.js';
import { hashPackageTree } from '../../src/installer/artifact.js';
import { runProcess, resolveExecutable } from '../../src/installer/process.js';
import type { ReleaseFetcher } from '../../src/installer/release/acquire.js';
import type { FreshInstallDependencies, FreshInstallOutcome } from '../../src/manifest-native/install.js';
import { runManifestNativeFreshInstall } from '../../src/manifest-native/install.js';
import { releaseManifestAssetName } from '../../src/manifest-native/release-assets.js';
import { nativeResolver, TEST_LANE, testLaneContract } from './manifest-native-fixtures.js';
import { FIXTURE_NOW, fixtureVerifier, gatewayReleasePayload, signedGatewayRelease, signedKeyring, signedStableChannel } from './release-trust-fixtures.js';
import type { TrustVerifier } from '../../src/installer/release/trust-internal.js';

export interface InstallFixtureChain {
  readonly keyringText: string;
  readonly channelText: string;
  readonly releaseText: string;
  readonly releaseId: string;
  readonly releaseManifestSha256: string;
}

export interface InstallFixtureRelease {
  readonly chain: InstallFixtureChain;
  /** The real gzip tar artifact bytes (npm-pack `package/` shape). */
  readonly artifactBytes: Buffer;
  readonly artifactFileName: string;
  readonly artifactSha256: string;
  readonly packageTreeSha256: string;
  readonly version: string;
}

/** An errno-shaped failure for deterministic fault injection. */
export function ioError(code: string): NodeJS.ErrnoException {
  const err = new Error(`injected ${code}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

export const FIXTURE_METADATA_BASE = 'https://fixture.invalid/releases/download/v0.1.3';
export const FIXTURE_ARTIFACT_BASE = 'https://fixture.invalid/releases/download/v0.1.3';

/** The fake Gateway bin served inside install artifacts (fake process target only). */
export const INSTALL_BIN_SCRIPT = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
if (process.argv[2] === '--config') {
  if (process.env.FIXTURE_BIN_RECORD) writeFileSync(process.env.FIXTURE_BIN_RECORD, process.argv[1] + '\\n');
  process.stdout.write('PROTOCOL-MARKER\\n');
  process.exit(0);
}
process.exit(3);
`;

export function installTreeFiles(version: string, binContent: string): Record<string, string> {
  const contract = testLaneContract();
  return {
    'package.json': JSON.stringify({ name: contract.packageName, version, bin: { [contract.binName]: 'bin/run.js' } }),
    'lib/core.js': `export const core = "${version}";\n`,
    'bin/run.js': binContent,
  };
}

/**
 * Build one authenticated install fixture: a real tarball whose extracted
 * tree digest and artifact SHA are BOUND inside the signed chain.
 */
export async function buildInstallFixtureRelease(overrides: Record<string, unknown> = {}, binContent: string = INSTALL_BIN_SCRIPT): Promise<InstallFixtureRelease> {
  const version = (overrides['version'] as string | undefined) ?? '0.1.1';
  const contract = testLaneContract();
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-install-fixture-'));
  try {
    // npm-pack shape: parent/package/<tree>.
    const parent = join(dir, 'pack');
    const tree = join(parent, 'package');
    mkdirSync(join(tree, 'lib'), { recursive: true, mode: 0o700 });
    mkdirSync(join(tree, 'bin'), { recursive: true, mode: 0o700 });
    for (const [rel, content] of Object.entries(installTreeFiles(version, binContent))) {
      writeFileSync(join(tree, rel), content);
      chmodSync(join(tree, rel), 0o600);
    }
    chmodSync(tree, 0o700);
    chmodSync(join(tree, 'lib'), 0o700);
    chmodSync(join(tree, 'bin'), 0o700);
    // Real tarball (owner-private modes preserved).
    const tgzPath = join(dir, 'artifact.tgz');
    const tar = resolveExecutable('tar');
    assert.ok(tar !== null, 'tar must be available for install fixtures');
    const packed = await runProcess(tar, ['-czf', tgzPath, '-C', parent, 'package']);
    assert.equal(packed.exitCode, 0, packed.stderr);
    const artifactBytes = readFileSync(tgzPath);
    const artifactSha256 = (await import('node:crypto')).createHash('sha256').update(artifactBytes).digest('hex');
    const treeDigest = await hashPackageTree(tree, {}, { requireOwnerPrivateModes: true });
    assert.equal(treeDigest.ok, true, treeDigest.ok ? '' : treeDigest.message);
    if (!treeDigest.ok) throw new Error('fixture tree did not hash');
    const artifactFileName = (overrides['artifactFileName'] as string | undefined) ?? `gateway-fixture-core-${version}.tgz`;
    const releaseText = signedGatewayRelease({
      ...gatewayReleasePayload(),
      packageName: contract.packageName,
      binName: contract.binName,
      supportedLanes: [TEST_LANE],
      version,
      artifactFileName,
      artifactSha256,
      packageTreeSha256: treeDigest.value,
      ...overrides,
    });
    const keyringText = signedKeyring();
    const channelText = signedStableChannel(releaseText);
    const releaseId = ((JSON.parse(releaseText) as { payload: { releaseId: string } }).payload).releaseId;
    const releaseManifestSha256 = ((JSON.parse(channelText) as { payload: { releaseManifestSha256: string } }).payload).releaseManifestSha256;
    return {
      chain: { keyringText, channelText, releaseText, releaseId, releaseManifestSha256 },
      artifactBytes,
      artifactFileName,
      artifactSha256,
      packageTreeSha256: treeDigest.value,
      version,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fake fetcher serving the signed metadata chain + the real artifact. */
export function installMetadataFetcher(release: InstallFixtureRelease, options: { readonly failArtifact?: boolean; readonly failChannel?: boolean; readonly failRelease?: boolean } = {}): ReleaseFetcher {
  return async (url: string, _redirectDepth?: number) => {
    const path = url.slice(url.indexOf('/', url.indexOf('://') + 3));
    const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');
    if (path.endsWith('/gateway-meta-keyring.json')) return { status: 200, body: Readable.from([bytes(release.chain.keyringText)]), contentLength: Buffer.byteLength(release.chain.keyringText) };
    if (path.endsWith('/gateway-meta-stable-channel.json')) {
      if (options.failChannel) return { status: 404, body: Readable.from([Buffer.from('not found')]), contentLength: 9 };
      return { status: 200, body: Readable.from([bytes(release.chain.channelText)]), contentLength: Buffer.byteLength(release.chain.channelText) };
    }
    const manifestAsset = releaseManifestAssetName(release.chain.releaseId, release.chain.releaseManifestSha256);
    if (manifestAsset !== null && path.endsWith(`/${manifestAsset}`)) {
      if (options.failRelease) return { status: 404, body: Readable.from([Buffer.from('not found')]), contentLength: 9 };
      return { status: 200, body: Readable.from([bytes(release.chain.releaseText)]), contentLength: Buffer.byteLength(release.chain.releaseText) };
    }
    if (path.endsWith(`/${release.artifactFileName}`)) {
      if (options.failArtifact) return { status: 404, body: Readable.from([Buffer.from('not found')]), contentLength: 9 };
      return { status: 200, body: Readable.from([release.artifactBytes]), contentLength: release.artifactBytes.length };
    }
    return { status: 404, body: Readable.from([Buffer.from('not found')]), contentLength: 9 };
  };
}

/** The paired fixture dependency set for the orchestrator (tests only). */
export function freshInstallDeps(verifier: TrustVerifier = fixtureVerifier(FIXTURE_NOW), fetcher: ReleaseFetcher, overrides: Partial<FreshInstallDependencies> = {}): FreshInstallDependencies {
  return {
    uid: process.getuid?.() ?? -1,
    fetcher,
    verifyRootSignedKeyring: (text) => verifier.verifyRootSignedKeyring(text),
    verifyChannelManifest: (text, keyring) => verifier.verifyChannelManifest(text, keyring),
    verifyReleaseSelection: (channel, text, keyring) => verifier.verifyReleaseSelection(channel, text, keyring),
    requireReleaseSelection: (value) => verifier.requireVerifiedReleaseSelection(value),
    requireInstalledEvidence: (value) => verifier.requireVerifiedInstalledEvidence(value),
    resolve: nativeResolver(verifier),
    metadataOrigin: { metadataBaseUrl: FIXTURE_METADATA_BASE, artifactBaseUrl: FIXTURE_ARTIFACT_BASE },
    ...overrides,
  };
}

/** Run the production orchestrator against a fixture release in an isolated HOME. */
export async function runFreshInstall(home: string, release: InstallFixtureRelease, deps: FreshInstallDependencies): Promise<FreshInstallOutcome> {
  const env: HostEnvironment = { home, platform: 'linux', arch: 'x64', pathEnv: process.env };
  return runManifestNativeFreshInstall(env, deps);
}

/** Release A: first compatible release (stable contract only). */
export function releaseAOverrides(): Record<string, unknown> {
  return {
    releaseId: 'gateway-native-release-aaa',
    version: '0.1.1',
    sourceCommit: 'a'.repeat(40),
    artifactFileName: 'gateway-native-core-0.1.1.tgz',
    upgradePolicy: { acceptedPredecessorReleaseIds: [], rollback: 'forbidden' },
  };
}

/** Release B: compatible successor, fully distinct identity. */
export function releaseBOverrides(): Record<string, unknown> {
  return {
    releaseId: 'gateway-native-release-bbb',
    version: '0.2.0',
    sourceCommit: 'b'.repeat(40),
    artifactFileName: 'gateway-native-core-0.2.0.tgz',
    upgradePolicy: { acceptedPredecessorReleaseIds: ['gateway-native-release-aaa'], rollback: 'immediate-predecessor' },
  };
}
