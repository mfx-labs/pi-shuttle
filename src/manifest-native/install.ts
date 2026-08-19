/**
 * Manifest-native production fresh-install orchestrator (FRESH-INSTALL
 * Slice). The production Gateway fresh-install authority.
 *
 * Final production chain:
 *
 *   compiled trust root / stable policy
 *     -> current signed keyring (fetched, fresh)
 *     -> current signed stable channel (fetched, fresh)
 *     -> signed Gateway release manifest (fetched by verified identity)
 *     -> fresh VerifiedReleaseSelection (production trust boundary, clock)
 *     -> authenticated artifact acquisition (compiled origin + signed name)
 *     -> artifact SHA-256 verification (signed digest)
 *     -> safe archive scan/extraction (bounded, no-follow policy)
 *     -> package/bin/protocol/lane validation (compiled + signed)
 *     -> staging normalization (0700 dirs / 0600 files)
 *     -> staging packageTreeSha256 verification (owner-private policy)
 *     -> content-addressed final package materialization/reuse
 *     -> final package rehash (mandatory)
 *     -> signed selection-chain cache publication
 *     -> Receipt Schema 1 publication LAST
 *     -> installed manifest-native lifecycle
 *
 * Authority rules:
 *   - NO compiled concrete Gateway release fact (version/commit/releaseId/
 *     artifact name/SHA/tree SHA) exists anywhere in this module — every
 *     per-release fact arrives authenticated inside the signed chain.
 *   - NO caller-selected release authority: no CLI/env/config override of
 *     release identity, artifact URL, digest, package root, bin path, or
 *     lock path. The metadata/artifact origin is compiled stable policy;
 *     file names come only from verified signed metadata.
 *   - Fresh selection uses the FRESH trust chain (liveness enforced), never
 *     installed-evidence verification; never semver "latest".
 *   - The install lock (manifest-native work root) is held across state
 *     inspection -> release selection -> materialization/reuse -> cache ->
 *     receipt. The lock is coordination, NOT trust authority.
 *   - Starting state: CLEAN -> normal fresh install; VALID -> idempotent
 *     same-release retry ONLY (exact identity match; otherwise refused with
 *     "already installed / update required"); MALFORMED -> fail closed,
 *     no repair/cleanup/migration/fallback.
 *   - Receipt publication is LAST. After receipt final visibility: no
 *     destructive rollback, no package/cache/receipt deletion.
 *
 * pi-guard is INDEPENDENTLY MANAGED for this generation: this transaction
 * never reads, installs, or records pi-guard, and never consults the
 * previous-generation pi-guard receipt/layout.
 *
 * Test seams (unreachable from production CLI/config/env): fetcher,
 * verification/provenance functions, resolver, tar, uid, io. Production
 * defaults are the fixed compiled policy + real HTTPS + system clock.
 */
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HostEnvironment, ManifestNativeLayout } from '../host/environment.js';
import { hostLane, resolveManifestNativeLayout } from '../host/environment.js';
import { scanArtifactMembers } from '../installer/archive.js';
import { findPackageRoot, hashPackageTree, PACKAGE_TREE_MAX_ENTRIES, readPackageIdentity } from '../installer/artifact.js';
import type { PackageIdentity } from '../installer/artifact.js';
import { exposeCurrentDistributionLauncher, installCurrentDistribution } from '../installer/distribution.js';
import type { DistributionHandoff, DistributionInstallResult } from '../installer/distribution.js';
import { resolveExecutable, runProcess } from '../installer/process.js';
import { acquireVerifiedFile, downloadToFile } from '../installer/release/acquire.js';
import type { ReleaseFetcher } from '../installer/release/acquire.js';
import {
  GATEWAY_TRUST_POLICY,
  MAX_METADATA_BYTES,
  requireVerifiedInstalledEvidence as productionRequireInstalledEvidence,
  requireVerifiedReleaseSelection as productionRequireReleaseSelection,
  verifyChannelManifest as productionVerifyChannelManifest,
  verifyReleaseSelection as productionVerifyReleaseSelection,
  verifyRootSignedKeyring as productionVerifyRootSignedKeyring,
} from '../installer/release/trust.js';
import type {
  TrustResult,
  VerifiedChannel,
  VerifiedInstalledEvidence,
  VerifiedKeyring,
  VerifiedReleaseSelection,
} from '../installer/release/trust.js';
import { acquireInstallLock, releaseInstallLock } from '../persistence/lock.js';
import { CACHE_SCHEMA_VERSION } from './cache.js';
import type { ManifestNativeCacheDocument } from './cache.js';
import { checkNativeObject, readBoundedNativeFile } from './fs.js';
import { deriveBinPath, derivePackageRoot } from './paths.js';
import { releaseManifestAssetName } from './release-assets.js';
import { buildManifestNativeReceipt } from './receipt.js';
import { resolveManifestNativeLifecycle } from './resolve.js';
import type { ManifestNativeResolution } from './resolve.js';
import { publishManifestNativeCache, publishManifestNativeReceipt, realDurableIo } from './write.js';
import type { DurableIo } from './write.js';

/**
 * Compiled trusted release-origin policy (stable, category A). The signed
 * metadata documents and Gateway artifacts are served from the pi-shuttle
 * release origin; only file names/digests come from verified signed
 * metadata — never hosts, schemes, or URLs from untrusted content.
 */
export const GATEWAY_RELEASE_ORIGIN = Object.freeze({
  metadataBaseUrl: 'https://github.com/mfx-labs/pi-shuttle/releases/download/v0.1.3',
  artifactBaseUrl: 'https://github.com/mfx-labs/pi-shuttle/releases/download/v0.1.3',
} as const);

/**
 * Compiled signed-metadata flat release-asset file names (stable policy).
 * GitHub Release assets cannot represent slash-bearing names, so every
 * signed metadata document is ONE flat filename directly under the release
 * tag; the release-manifest file name is derived deterministically from the
 * already-validated signed selection (release-assets.ts).
 */
export const GATEWAY_SIGNED_METADATA_FILES = Object.freeze({
  keyring: 'gateway-meta-keyring.json',
  stableChannel: 'gateway-meta-stable-channel.json',
} as const);

/** Node major runtime floor implied by the `node22` lane protocol label. */
export const FRESH_INSTALL_NODE_MAJOR_MINIMUM = 22;

export type FreshInstallOutcome =
  | { readonly kind: 'INSTALLED'; readonly releaseId: string; readonly packageRoot: string; readonly binPath: string }
  | { readonly kind: 'ALREADY_INSTALLED'; readonly releaseId: string }
  | { readonly kind: 'ALREADY_INSTALLED_UPDATE_REQUIRED'; readonly installedReleaseId: string; readonly selectedReleaseId: string }
  | { readonly kind: 'UNSUPPORTED'; readonly reason: string }
  | { readonly kind: 'REFUSED'; readonly code: string; readonly message: string }
  | { readonly kind: 'FAILED'; readonly stage: string; readonly code: string; readonly message: string };

export interface FreshInstallDependencies {
  /** Effective UID (default: process.getuid()). */
  readonly uid?: number;
  /** HTTPS fetcher (default: the real fixed fetcher). Tests only. */
  readonly fetcher?: ReleaseFetcher;
  /** Fresh-selection verification (default: the production trust boundary). */
  readonly verifyRootSignedKeyring?: (text: string) => TrustResult<VerifiedKeyring>;
  readonly verifyChannelManifest?: (text: string, keyring: VerifiedKeyring) => TrustResult<VerifiedChannel>;
  readonly verifyReleaseSelection?: (channel: VerifiedChannel, releaseText: string, keyring: VerifiedKeyring) => TrustResult<VerifiedReleaseSelection>;
  /** Receipt-builder provenance gates (default: production boundary). */
  readonly requireReleaseSelection?: (value: unknown) => TrustResult<VerifiedReleaseSelection>;
  readonly requireInstalledEvidence?: (value: unknown) => TrustResult<VerifiedInstalledEvidence>;
  /** State resolution (default: the production resolver). Tests only. */
  readonly resolve?: (layout: ManifestNativeLayout, lane: string) => Promise<ManifestNativeResolution>;
  /** Durable-publication I/O seam (default: real filesystem). Tests only. */
  readonly io?: DurableIo;
  /**
   * Package durability I/O seam (FI-01; tests only). Injected I/O for
   * failure timing; structural/identity validation (open/fstat/type/owner/
   * mode/dev-ino) always uses the real filesystem and can never be forged.
   * Production defaults to the fixed real implementation.
   */
  readonly packageIo?: PackageDurabilityIo;
  /** tar executable (default: PATH discovery). */
  readonly tarExecutable?: string;
  /** Compiled trusted origin override (tests only; production = fixed policy). */
  readonly metadataOrigin?: { readonly metadataBaseUrl: string; readonly artifactBaseUrl: string };
  /**
   * Verified current pi-shuttle distribution package handoff (install.sh
   * bootstrap). OPTIONAL in the orchestrator: Gateway-only mode is preserved
   * for existing install tests. The production entry REQUIRES it, so a
   * successful installer run leaves both the manifest-native Gateway
   * installation AND the current pi-shuttle distribution package installed
   * with its canonical launcher exposed.
   */
  readonly distribution?: DistributionHandoff;
}

function outcomeFailed(stage: string, code: string, message: string): FreshInstallOutcome {
  return { kind: 'FAILED', stage, code, message };
}

function outcomeRefused(code: string, message: string): FreshInstallOutcome {
  return { kind: 'REFUSED', code, message };
}

type InstalledDistribution = Extract<DistributionInstallResult, { readonly ok: true }>;

/**
 * Persist + validate the current pi-shuttle distribution package when the
 * bootstrap handoff is present. Runs BEFORE the Gateway transaction on both
 * the CLEAN and VALID-exact paths; the canonical launcher exposure is a
 * separate LAST step after receipt publication.
 */
async function installDistributionIfHandoff(
  env: HostEnvironment,
  deps: FreshInstallDependencies,
  uid: number,
  tarExecutable: string,
  stagingDir: string,
): Promise<{ readonly ok: true; readonly distribution: InstalledDistribution | null } | { readonly ok: false; readonly code: string; readonly message: string }> {
  const handoff = deps.distribution;
  if (handoff === undefined) return { ok: true, distribution: null };
  const installed = await installCurrentDistribution({ home: env.home, uid, tarExecutable, stagingDir, handoff });
  if (!installed.ok) {
    return { ok: false, code: installed.code, message: `current pi-shuttle distribution could not be installed: ${installed.message}` };
  }
  return { ok: true, distribution: installed };
}

/**
 * Expose the canonical pi-shuttle launcher to the installed current
 * distribution package. MUST run LAST, after receipt publication; a failed
 * exposure returns FAILED and never leaves a partially written launcher.
 */
function exposeDistributionLauncher(distribution: InstalledDistribution, env: HostEnvironment): { readonly ok: true } | { readonly ok: false; readonly outcome: FreshInstallOutcome } {
  const exposed = exposeCurrentDistributionLauncher({ home: env.home, packageRoot: distribution.packageRoot, binPath: distribution.binPath });
  if (!exposed.ok) {
    return { ok: false, outcome: outcomeFailed('distribution', exposed.code, `current pi-shuttle canonical launcher could not be exposed: ${exposed.message}`) };
  }
  return { ok: true };
}

/**
 * Bound metadata fetch through the hardened HTTPS downloader (policy-owned
 * redirect/protocol/size handling) plus a bounded safe read. The fetched
 * document is removed after reading; verification happens at the trust
 * boundary.
 */
async function fetchSignedDocument(url: string, attemptDir: string, uid: number, fetcher: ReleaseFetcher | undefined, index: number): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: string; readonly message: string }> {
  const dest = join(attemptDir, `metadata-${index}.json`);
  const downloaded = await downloadToFile(url, dest, fetcher);
  if (!downloaded.ok) return { ok: false, code: downloaded.code, message: `signed metadata could not be acquired from ${url}: ${downloaded.message}` };
  const read = readBoundedNativeFile(dest, MAX_METADATA_BYTES, uid, 0o600);
  try {
    rmSync(dest, { force: true });
  } catch {
    // best-effort; the read result stands
  }
  if (!read.ok) {
    return {
      ok: false,
      code: read.code === 'too-large' ? 'ERR-MN-INSTALL-METADATA-SIZE' : 'ERR-MN-INSTALL-METADATA-READ',
      message: `signed metadata at ${url} could not be read safely (${read.code}): ${read.message}`,
    };
  }
  return { ok: true, text: read.text };
}

/** Normalize extracted package modes (attempt-owned staging; allowed). */
function normalizePackageModes(root: string, maxEntries: number): void {
  let count = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`unsupported package entry type at ${path}`);
      }
      count += 1;
      if (count > maxEntries) throw new Error('package tree exceeds the entry ceiling during normalization');
      if (stat.isDirectory()) {
        chmodSync(path, 0o700);
        walk(path);
      } else {
        chmodSync(path, 0o600);
      }
    }
  };
  chmodSync(root, 0o700);
  walk(root);
}

/** Package durability I/O seam (FI-01): injected failure timing only. */
export interface PackageDurabilityIo {
  /** fsync an opened regular-file fd (default: fsyncSync). */
  readonly fsyncFile: (fd: number) => void;
  /** fsync an opened directory fd (default: fsyncSync). */
  readonly fsyncDirectory: (fd: number) => void;
  /** Open a regular file without following a symlinked final component (default: O_NOFOLLOW). */
  readonly openRegularFile: (path: string) => number;
}

/** The fixed production package durability implementation. */
export const realPackageDurabilityIo: PackageDurabilityIo = Object.freeze({
  fsyncFile: fsyncSync,
  fsyncDirectory: fsyncSync,
  openRegularFile: (path: string) => openSync(path, constants.O_RDONLY | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0)),
});

/**
 * Point-of-use package durability barrier (FI-01). ANY final package relied
 * upon for installation authority — created by this attempt, reused from an
 * orphan, accepted after a reservation race, or reused on an idempotent
 * retry — must cross this barrier before cache/receipt publication:
 *
 *   - every regular file: lstat-inspect the path, open with O_NOFOLLOW,
 *     fstat the OPENED fd, require regular-file type + expected owner +
 *     owner-private mode + SAME dev/ino as the inspected object, then fsync
 *     that exact opened inode and close. A symlink/path substitution fails
 *     closed BEFORE the substituted object is fsynced or accepted.
 *   - every directory: lstat-inspect, open, fstat-verify directory identity
 *     (dev/ino) and exact 0700 mode, fsync the opened directory fd.
 *
 * Identity validation is real/non-forgeable; only the fsync timing can be
 * injected (tests). Bounded by the accepted package-tree entry ceiling.
 * This is a point-of-use barrier, not repair or recovery.
 */
function packageDurabilityBarrier(root: string, uid: number, io: PackageDurabilityIo, maxEntries: number): void {
  let count = 0;
  const walk = (dir: string): void => {
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error(`unsupported package entry type at ${dir}`);
    }
    const dirFd = openSync(dir, 'r');
    try {
      const opened = fstatSync(dirFd);
      if (!opened.isDirectory() || opened.dev !== dirStat.dev || opened.ino !== dirStat.ino) {
        throw new Error(`directory changed between inspection and durability sync: ${dir}`);
      }
      if ((opened.mode & 0o7777) !== 0o700) {
        throw new Error(`directory mode ${(opened.mode & 0o7777).toString(8)} is not exactly 0700: ${dir}`);
      }
      io.fsyncDirectory(dirFd);
    } finally {
      closeSync(dirFd);
    }
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`unsupported package entry type at ${path}`);
      }
      count += 1;
      if (count > maxEntries) throw new Error('package tree exceeds the entry ceiling during durability walk');
      if (stat.isDirectory()) {
        walk(path);
      } else {
        const fd = io.openRegularFile(path);
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile()) throw new Error(`entry is no longer a regular file: ${path}`);
          if (opened.dev !== stat.dev || opened.ino !== stat.ino) {
            throw new Error(`file was replaced between inspection and durability sync; refusing to fsync a substituted object: ${path}`);
          }
          if (opened.uid !== uid) throw new Error(`file is not owned by the effective user: ${path}`);
          if ((opened.mode & 0o077) !== 0) throw new Error(`file exposes group/world permission bits (mode ${(opened.mode & 0o777).toString(8).padStart(4, '0')}): ${path}`);
          io.fsyncFile(fd);
        } finally {
          closeSync(fd);
        }
      }
    }
  };
  walk(root);
}

/** fsync one parent directory (content-address parents). */
function fsyncParentDirectory(path: string, io: PackageDurabilityIo): void {
  const fd = openSync(path, 'r');
  try {
    io.fsyncDirectory(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Unified final-package acceptance (FI-01): ANY accepted final package —
 * created, orphan-reused, race-accepted, or retry-reused — passes the same
 * sequence before cache/receipt publication:
 *
 *   fully validate (type/owner/mode + identity + complete tree hash)
 *     -> package durability barrier (file fsyncs via O_NOFOLLOW+fstat
 *        identity binding, directory fsyncs, content-address parents)
 *     -> mandatory final complete rehash (AFTER durability)
 *     -> package identity re-check.
 */
async function finalizeFinalPackage(
  finalTarget: string,
  uid: number,
  lane: string,
  expectedTreeSha256: string,
  io: PackageDurabilityIo,
): Promise<{ readonly ok: true; readonly identity: PackageIdentity } | { readonly ok: false; readonly code: string; readonly message: string }> {
  const validated = await revalidateFinalPackage(finalTarget, uid, lane, expectedTreeSha256);
  if (!validated.ok) return validated;
  try {
    packageDurabilityBarrier(finalTarget, uid, io, PACKAGE_TREE_MAX_ENTRIES);
    fsyncParentDirectory(dirname(finalTarget), io);
    fsyncParentDirectory(dirname(dirname(finalTarget)), io);
  } catch (err) {
    return {
      ok: false,
      code: 'ERR-MN-INSTALL-PACKAGE-DURABILITY',
      message: `final package durability barriers failed (${(err as Error).message || 'unknown error'}); the package is preserved — no recovery is attempted`,
    };
  }
  // Mandatory final rehash AFTER the durability operations.
  const finalTree = await hashPackageTree(finalTarget, {}, { requireOwnerPrivateModes: true });
  if (!finalTree.ok) return { ok: false, code: 'ERR-MN-INSTALL-TREE', message: `final package re-verification failed: ${finalTree.message}` };
  if (finalTree.value !== expectedTreeSha256) {
    return { ok: false, code: 'ERR-MN-INSTALL-TREE', message: `final package tree digest ${finalTree.value} does not match the signed packageTreeSha256 ${expectedTreeSha256}` };
  }
  const identity = readPackageIdentity(finalTarget);
  if (identity === null) return { ok: false, code: 'ERR-MN-INSTALL-PACKAGE-IDENTITY', message: 'final package identity could not be read' };
  return { ok: true, identity };
}

/** Full revalidation of a content-addressed package target (reuse gate). */
async function revalidateFinalPackage(target: string, uid: number, lane: string, expectedTreeSha256: string): Promise<{ readonly ok: true; readonly identity: PackageIdentity } | { readonly ok: false; readonly code: string; readonly message: string }> {
  const check = checkNativeObject(target, uid, 'directory', 0o700);
  if (!check.ok) return { ok: false, code: check.code === 'absent' ? 'absent' : 'ERR-MN-INSTALL-PACKAGE-UNSAFE', message: check.message };
  const identity = readPackageIdentity(target);
  if (identity === null) return { ok: false, code: 'ERR-MN-INSTALL-PACKAGE-IDENTITY', message: `existing package at ${target} exposes no valid package identity` };
  const contract = GATEWAY_TRUST_POLICY.laneContracts[lane];
  if (contract === undefined || identity.name !== contract.packageName) {
    return { ok: false, code: 'ERR-MN-INSTALL-PACKAGE-IDENTITY', message: `existing package identity ${identity.name} does not match the compiled lane contract ${contract?.packageName ?? 'unknown'}` };
  }
  const tree = await hashPackageTree(target, {}, { requireOwnerPrivateModes: true });
  if (!tree.ok) return { ok: false, code: 'ERR-MN-INSTALL-PACKAGE-TREE', message: `existing package at ${target} failed tree verification: ${tree.message}` };
  if (tree.value !== expectedTreeSha256) {
    return { ok: false, code: 'ERR-MN-INSTALL-PACKAGE-CONFLICT', message: `existing content-addressed package at ${target} does not match the signed packageTreeSha256 (computed ${tree.value}, expected ${expectedTreeSha256}); refusing to overwrite` };
  }
  return { ok: true, identity };
}

/**
 * Production manifest-native fresh install. See the module header for the
 * full chain and authority rules.
 */
export async function runManifestNativeFreshInstall(env: HostEnvironment, deps: FreshInstallDependencies = {}): Promise<FreshInstallOutcome> {
  const uid = deps.uid ?? process.getuid?.() ?? -1;
  const fetcher = deps.fetcher; // undefined -> real HTTPS fetcher inside the acquire helpers
  const io = deps.io ?? realDurableIo;
  const packageIo = deps.packageIo ?? realPackageDurabilityIo;
  const origin = deps.metadataOrigin ?? GATEWAY_RELEASE_ORIGIN;

  // 1. Preflight: lane support (compiled trust policy), node floor, root, tar.
  const lane = hostLane(env.platform, env.arch);
  const contract = GATEWAY_TRUST_POLICY.laneContracts[lane];
  if (contract === undefined) {
    return { kind: 'UNSUPPORTED', reason: `host lane ${lane} is not a compiled supported manifest-native lane` };
  }
  if (uid === 0) {
    return { kind: 'UNSUPPORTED', reason: 'the installer refuses to run as root' };
  }
  const nodeMajor = Number(process.versions.node.split('.')[0] ?? 0);
  if (!Number.isInteger(nodeMajor) || nodeMajor < FRESH_INSTALL_NODE_MAJOR_MINIMUM) {
    return { kind: 'UNSUPPORTED', reason: `node ${process.versions.node} is below the ${FRESH_INSTALL_NODE_MAJOR_MINIMUM} major implied by the node22 lane protocol` };
  }
  const tarExecutable = deps.tarExecutable ?? resolveExecutable('tar', env.pathEnv);
  if (tarExecutable === null) {
    return { kind: 'UNSUPPORTED', reason: 'tar executable not found on PATH' };
  }

  const layout = resolveManifestNativeLayout(env.home);
  // The manifest-native work root (non-authoritative) must exist for the
  // install lock and staging; created 0700, never caller-selected.
  try {
    mkdirSync(layout.stateRoot, { recursive: true, mode: 0o700 });
  } catch (err) {
    return outcomeFailed('preflight', 'ERR-MN-INSTALL-STAGING', `manifest-native work root could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  const verifyKeyring = deps.verifyRootSignedKeyring ?? productionVerifyRootSignedKeyring;
  const verifyChannel = deps.verifyChannelManifest ?? productionVerifyChannelManifest;
  const verifySelection = deps.verifyReleaseSelection ?? productionVerifyReleaseSelection;
  const requireReleaseSelection = deps.requireReleaseSelection ?? productionRequireReleaseSelection;
  const requireInstalledEvidence = deps.requireInstalledEvidence ?? productionRequireInstalledEvidence;
  const resolve = deps.resolve ?? ((l: ManifestNativeLayout, laneName: string) => resolveManifestNativeLifecycle(l, laneName));

  // 2. Install lock (coordination only): held across state inspection ->
  //    release selection -> materialization/reuse -> cache -> receipt.
  const lock = acquireInstallLock(layout.installLockPath);
  if (!lock.ok) {
    return outcomeRefused(lock.code, `manifest-native install lock could not be acquired: ${lock.message}`);
  }
  try {
    // 3. Starting state: CLEAN / VALID / MALFORMED (manifest-native only).
    const resolution = await resolve(layout, lane);
    if (resolution.kind === 'MALFORMED') {
      return outcomeRefused('ERR-MN-INSTALL-STATE-MALFORMED', `manifest-native state is malformed; the installer performs no repair, cleanup, migration, or fallback: ${resolution.reason}`);
    }

    // 4. Fresh signed release selection (freshness enforced; never
    //    installed-evidence mode; never semver "latest").
    try {
      mkdirSync(layout.stagingRoot, { recursive: true, mode: 0o700 });
    } catch (err) {
      return outcomeFailed('preflight', 'ERR-MN-INSTALL-STAGING', `manifest-native staging root could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
    }
    const attemptDir = join(layout.stagingRoot, `${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
    try {
      mkdirSync(attemptDir, { mode: 0o700 });
    } catch (err) {
      return outcomeFailed('preflight', 'ERR-MN-INSTALL-STAGING', `install attempt directory could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
    }

    const keyringResult = await fetchSignedDocument(`${origin.metadataBaseUrl}/${GATEWAY_SIGNED_METADATA_FILES.keyring}`, attemptDir, uid, fetcher, 1);
    if (!keyringResult.ok) return outcomeFailed('selection', keyringResult.code, keyringResult.message);
    const keyringText = keyringResult.text;
    const keyring = verifyKeyring(keyringText);
    if (!keyring.ok) return outcomeFailed('selection', keyring.code, `current signed keyring failed fresh verification: ${keyring.message}`);

    const channelResult = await fetchSignedDocument(`${origin.metadataBaseUrl}/${GATEWAY_SIGNED_METADATA_FILES.stableChannel}`, attemptDir, uid, fetcher, 2);
    if (!channelResult.ok) return outcomeFailed('selection', channelResult.code, channelResult.message);
    const channelText = channelResult.text;
    const channel = verifyChannel(channelText, keyring.value);
    if (!channel.ok) return outcomeFailed('selection', channel.code, `current signed stable channel failed fresh verification: ${channel.message}`);

    const releaseManifestAsset = releaseManifestAssetName(channel.value.releaseId, channel.value.releaseManifestSha256);
    if (releaseManifestAsset === null) {
      return outcomeFailed('selection', 'ERR-MN-INSTALL-RELEASE-ASSET', 'signed release selection cannot derive a canonical flat release-manifest asset name');
    }
    const releaseResult = await fetchSignedDocument(`${origin.metadataBaseUrl}/${releaseManifestAsset}`, attemptDir, uid, fetcher, 3);
    if (!releaseResult.ok) return outcomeFailed('selection', releaseResult.code, releaseResult.message);
    const releaseText = releaseResult.text;
    const selected = verifySelection(channel.value, releaseText, keyring.value);
    if (!selected.ok) return outcomeFailed('selection', selected.code, `signed Gateway release manifest failed fresh verification: ${selected.message}`);
    const selection = selected.value;

    // 5. VALID starting state: idempotent same-release retry ONLY.
    if (resolution.kind === 'VALID') {
      const gateway = resolution.installation.receipt.gateway;
      const exact = gateway.releaseId === selection.channel.releaseId
        && gateway.releaseManifestSha256 === selection.releaseManifestSha256
        && gateway.packageTreeSha256 === selection.release.packageTreeSha256
        && gateway.selectedLane === lane
        && gateway.packageRoot === derivePackageRoot(layout, selection.release.packageTreeSha256)
        && contract.packageName === selection.release.packageName
        && contract.binName === selection.release.binName;
      if (exact) {
        // Current pi-shuttle distribution package (persist + validate)
        // BEFORE the Gateway idempotent transaction.
        const distributionInstall = await installDistributionIfHandoff(env, deps, uid, tarExecutable, attemptDir);
        if (!distributionInstall.ok) return outcomeFailed('distribution', distributionInstall.code, distributionInstall.message);
        // FI-01: the existing package being relied upon must cross the
        // package durability barrier (validate -> file/dir/parent fsync ->
        // final rehash) before cache/receipt reuse success. Nothing is
        // re-downloaded or replaced.
        const finalized = await finalizeFinalPackage(gateway.packageRoot, uid, lane, selection.release.packageTreeSha256, packageIo);
        if (!finalized.ok) {
          return outcomeFailed('package-durability', finalized.code, `idempotent retry package durability barrier failed: ${finalized.message}`);
        }
        // Re-establish the accepted cache/receipt durability barriers
        // through the reuse paths of the publication primitives.
        const cacheDoc: ManifestNativeCacheDocument = {
          cacheSchemaVersion: CACHE_SCHEMA_VERSION,
          keyringText,
          channelText,
          releaseManifestText: releaseText,
        };
        const cachePublish = publishManifestNativeCache(layout, selection.channel.releaseId, selection.releaseManifestSha256, cacheDoc, io, uid);
        if (!cachePublish.ok) return outcomeFailed('cache', cachePublish.code, `idempotent retry cache durability barrier failed: ${cachePublish.message}`);
        const receiptPublish = publishManifestNativeReceipt(layout, resolution.installation.receipt, io, uid);
        if (!receiptPublish.ok) return outcomeFailed('receipt', receiptPublish.code, `idempotent retry receipt durability barrier failed: ${receiptPublish.message}`);
        if (distributionInstall.distribution !== null) {
          const launcher = exposeDistributionLauncher(distributionInstall.distribution, env);
          if (!launcher.ok) return launcher.outcome;
        }
        try {
          rmSync(attemptDir, { recursive: true, force: true });
        } catch {
          // best-effort
        }
        return { kind: 'ALREADY_INSTALLED', releaseId: selection.channel.releaseId };
      }
      return {
        kind: 'ALREADY_INSTALLED_UPDATE_REQUIRED',
        installedReleaseId: gateway.releaseId,
        selectedReleaseId: selection.channel.releaseId,
      };
    }

    // 5b. Current pi-shuttle distribution package (persist + validate) —
    //     installed BEFORE the Gateway transaction. The canonical launcher
    //     exposure is LAST, after receipt publication.
    const distributionInstall = await installDistributionIfHandoff(env, deps, uid, tarExecutable, attemptDir);
    if (!distributionInstall.ok) return outcomeFailed('distribution', distributionInstall.code, distributionInstall.message);

    // 6. Content-addressed final package target: early orphan reuse/conflict.
    const expectedTreeSha256 = selection.release.packageTreeSha256;
    const finalTarget = derivePackageRoot(layout, expectedTreeSha256);
    if (finalTarget === null) {
      return outcomeFailed('package-tree', 'ERR-MN-INSTALL-TREE', 'signed packageTreeSha256 cannot derive a canonical package root');
    }
    let finalIdentity: PackageIdentity | null = null;
    {
      const existing = await revalidateFinalPackage(finalTarget, uid, lane, expectedTreeSha256);
      if (existing.ok) {
        finalIdentity = existing.identity;
      } else if (existing.code !== 'absent') {
        return outcomeFailed('package-materialize', existing.code, existing.message);
      }
    }

    // 7-15. Acquisition/materialization path (skipped entirely when the
    //       content-addressed package already exists and revalidates).
    if (finalIdentity === null) {
      // 7. Artifact acquisition (compiled origin + signed file name/digest;
      //    digest verified before any extraction).
      const acquired = await acquireVerifiedFile(origin.artifactBaseUrl, selection.release.artifactFileName, selection.release.artifactSha256, attemptDir, fetcher);
      if (!acquired.ok || acquired.path === undefined) {
        return outcomeFailed('artifact', !acquired.ok ? acquired.code : 'ERR-MN-INSTALL-ARTIFACT', `authenticated Gateway artifact could not be acquired: ${!acquired.ok ? acquired.message : 'no verified artifact path'}`);
      }
      const artifactPath = acquired.path;

      // 8. Safe archive inspection/extraction (bounded, policy-owned).
      const scan = await scanArtifactMembers(artifactPath);
      if (!scan.ok) return outcomeFailed('archive', scan.code, scan.message);
      const extractDir = join(attemptDir, 'extract');
      try {
        mkdirSync(extractDir, { recursive: true, mode: 0o700 });
      } catch (err) {
        return outcomeFailed('archive', 'ERR-MN-INSTALL-ARCHIVE', `extraction staging could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
      }
      const extract = await runProcess(tarExecutable, ['-xzf', artifactPath, '-C', extractDir], { timeoutMs: 120_000 });
      if (extract.exitCode !== 0 || extract.signal !== null) {
        return outcomeFailed('archive', 'ERR-MN-INSTALL-ARCHIVE', `artifact extraction failed (${extract.timedOut ? 'timed out' : extract.signal !== null ? `killed by ${extract.signal}` : `exit ${extract.exitCode ?? 'unknown'}`}): ${extract.stderr.trim().slice(0, 300)}`);
      }

      // 9. Package identity/bin validation (compiled contract + signed bindings).
      const packageRoot = findPackageRoot(extractDir);
      if (packageRoot === null) {
        return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE', 'extracted artifact contains no readable package.json root');
      }
      const identity = readPackageIdentity(packageRoot);
      if (identity === null) {
        return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE', 'extracted package identity could not be read');
      }
      if (identity.name !== selection.release.packageName || identity.version !== selection.release.version) {
        return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE-IDENTITY', `extracted package identity ${identity.name}@${identity.version} does not match the signed release ${selection.release.packageName}@${selection.release.version}`);
      }
      if (contract.packageName !== selection.release.packageName || contract.binName !== selection.release.binName) {
        return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE-CONTRACT', 'signed package/bin contract does not match the compiled lane contract');
      }
      const binRaw = identity.bin[selection.release.binName];
      if (binRaw === undefined) {
        return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE-BIN', `extracted package does not declare the signed bin name ${selection.release.binName}`);
      }
      const stagedBin = deriveBinPath(packageRoot, binRaw);
      if (stagedBin === null) {
        return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE-BIN', `signed bin entry cannot be a canonical in-package path: ${binRaw}`);
      }

      // 10. Normalize attempt-owned staging modes (0700 dirs / 0600 files).
      try {
        normalizePackageModes(packageRoot, PACKAGE_TREE_MAX_ENTRIES);
      } catch (err) {
        return outcomeFailed('package-normalize', 'ERR-MN-INSTALL-PACKAGE', `package normalization failed (${(err as Error).message || 'unknown error'})`);
      }

      // 11. Staging tree digest (owner-private policy) == signed digest.
      const stagedTree = await hashPackageTree(packageRoot, {}, { requireOwnerPrivateModes: true });
      if (!stagedTree.ok) {
        return outcomeFailed('package-tree', 'ERR-MN-INSTALL-TREE', `staged package tree failed verification: ${stagedTree.message}`);
      }
      if (stagedTree.value !== expectedTreeSha256) {
        return outcomeFailed('package-tree', 'ERR-MN-INSTALL-TREE', `staged package tree digest ${stagedTree.value} does not match the signed packageTreeSha256 ${expectedTreeSha256}`);
      }
      try {
        const binStat = lstatSync(stagedBin);
        if (binStat.isSymbolicLink() || !binStat.isFile()) {
          return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE-BIN', `staged bin is not a regular file: ${stagedBin}`);
        }
      } catch (err) {
        return outcomeFailed('package', 'ERR-MN-INSTALL-PACKAGE-BIN', `staged bin could not be inspected (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${stagedBin}`);
      }

      // 12. Materialize the content-addressed final package (lock-protected;
      //     reservation + rename; revalidation on any existing target).
      //     The authority namespace parents are created 0700 (missing only).
      try {
        mkdirSync(layout.packagesRoot, { recursive: true, mode: 0o700 });
        mkdirSync(layout.packagesSha256Root, { recursive: true, mode: 0o700 });
      } catch (err) {
        return outcomeFailed('package-materialize', 'ERR-MN-INSTALL-MATERIALIZE', `package namespace could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
      }
      let created = false;
      try {
        mkdirSync(finalTarget, { mode: 0o700 });
        created = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
          return outcomeFailed('package-materialize', 'ERR-MN-INSTALL-MATERIALIZE', `final package reservation failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${finalTarget}`);
        }
      }
      if (created) {
        try {
          renameSync(packageRoot, finalTarget);
        } catch (err) {
          return outcomeFailed('package-materialize', 'ERR-MN-INSTALL-MATERIALIZE', `final package activation failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
        }
      } else {
        // A target appeared between the early check and the reservation
        // (crash leftover under the cooperative lock): full revalidation.
        const existing = await revalidateFinalPackage(finalTarget, uid, lane, expectedTreeSha256);
        if (!existing.ok) return outcomeFailed('package-materialize', existing.code, existing.message);
        finalIdentity = existing.identity;
      }

      // 15. Best-effort cleanup of attempt-owned staging before cache.
      try {
        rmSync(attemptDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }

    // 13-14. UNIFIED final-package acceptance (FI-01): whether the package
    //     was created by this attempt, reused from an orphan, or accepted
    //     after a reservation race, it passes validate -> package durability
    //     barrier (file fsyncs with O_NOFOLLOW+fstat identity binding,
    //     directory fsyncs, content-address parent fsyncs) -> mandatory
    //     final rehash BEFORE cache/receipt publication.
    {
      const finalized = await finalizeFinalPackage(finalTarget, uid, lane, expectedTreeSha256, packageIo);
      if (!finalized.ok) {
        const stage = finalized.code === 'ERR-MN-INSTALL-PACKAGE-DURABILITY' || finalized.code === 'ERR-MN-INSTALL-TREE' ? 'package-durability' : 'package-materialize';
        return outcomeFailed(stage, finalized.code, `final package acceptance failed: ${finalized.message}`);
      }
      finalIdentity = finalized.identity;
    }

    // 16. Signed selection-chain cache publication (final package verified
    //     first; identical reuse with full durability barriers).
    const cacheDoc: ManifestNativeCacheDocument = {
      cacheSchemaVersion: CACHE_SCHEMA_VERSION,
      keyringText,
      channelText,
      releaseManifestText: releaseText,
    };
    const cachePublish = publishManifestNativeCache(layout, selection.channel.releaseId, selection.releaseManifestSha256, cacheDoc, io, uid);
    if (!cachePublish.ok) {
      return outcomeFailed('cache', cachePublish.code, `signed selection-chain cache publication failed: ${cachePublish.message}`);
    }

    // 17. Receipt construction from runtime-proven authority; publication
    //     LAST (the transaction's authoritative selection point).
    const built = buildManifestNativeReceipt(
      {
        selection,
        layout,
        hostLane: lane,
        packageTreeSha256: expectedTreeSha256,
        packageIdentity: finalIdentity!,
      },
      { requireReleaseSelection, requireInstalledEvidence },
    );
    if (!built.ok) {
      return outcomeFailed('receipt', built.code, `Receipt Schema 1 construction failed: ${built.message}`);
    }
    const receiptPublish = publishManifestNativeReceipt(layout, built.receipt, io, uid);
    if (!receiptPublish.ok) {
      return outcomeFailed('receipt', receiptPublish.code, `receipt publication failed: ${receiptPublish.message}`);
    }

    // Launcher exposure LAST: after the full Gateway transaction, pointing
    // only at the validated bin inside the installed distribution package.
    if (distributionInstall.distribution !== null) {
      const launcher = exposeDistributionLauncher(distributionInstall.distribution, env);
      if (!launcher.ok) return launcher.outcome;
    }

    return {
      kind: 'INSTALLED',
      releaseId: selection.channel.releaseId,
      packageRoot: finalTarget,
      binPath: built.receipt.gateway.binPath,
    };
  } finally {
    releaseInstallLock(lock.fd, layout.installLockPath);
  }
}
