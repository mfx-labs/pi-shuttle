/**
 * PS-3 install flow: preflight → install-wide lock → staging → acquire →
 * verify → activate (atomic no-clobber reservation) → bin link →
 * pi-guard (tracked external Pi mutation) → receipt → report. Result
 * taxonomy: COMPLETE / PARTIAL / FAILED (rolled back / partial rollback)
 * / ALREADY_INSTALLED / UPGRADE_AVAILABLE / UPGRADE_DECLINED /
 * INCOMPLETE_DECLINED / UNSUPPORTED / REFUSED. The receipt is written LAST and ONLY for
 * finalized COMPLETE/PARTIAL states; failed attempts roll back this
 * attempt's own mutations and preserve any prior receipt.
 *
 * Concurrency: one O_EXCL install.lock spans classification, consent,
 * activation, the final receipt, and rollback. A dead-PID lock is removed;
 * live, malformed, unreadable, or special lock objects fail clearly.
 *
 * Rollback scope (installation-contract §6; SIR-PS3-002/011): removes
 * only what THIS attempt created (staging, newly activated component
 * dirs, the bin link — and only while it still points at this attempt's
 * target). The external `pi install` side effect is NOT removable through
 * a supported mechanism; when this attempt performed it, the rollback
 * report states PARTIAL ROLLBACK with the Pi residual explicitly named.
 * Never deletes pre-existing valid installation state, trusted stores,
 * project directories, Git state, unrelated Pi extensions, or a
 * pre-existing pi-guard.
 */
import { lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireInstallLock, releaseInstallLock } from '../persistence/lock.js';
import { gatewayDescriptorForLane, PI_COMPATIBILITY_BASELINE, PI_GUARD_COMMIT, PI_GUARD_VERSION, PI_SHUTTLE_VERSION } from '../compat/manifest.js';
import type { GatewayLaneDescriptor } from '../compat/manifest.js';
import { resolvePiLoaderFromBin } from '../compat/pi-guard-probe.js';
import type { HostEnvironment, LayoutPaths } from '../host/environment.js';
import { hostLane, resolveLayout } from '../host/environment.js';
import { compareVersionTriples, parseVersionTriple } from '../compat/versions.js';
import { applyPiPolicy, checkNodeLane, checkNotRoot, checkPlatformLane, checkTarPresent, classifyPiVersion, ensureWritableLayout, PI_RUNTIME_POLICY } from './preflight.js';
import { runProcess, resolveExecutable } from './process.js';
import { activatePackageRoot, componentDirName, extractArtifact, inspectExistingGateway, inspectExistingPiGuard, installGatewayComponent, installPiGuardComponent, isPiShuttlePackageDirName, piShuttlePackageDirName, removeStaging, validateBinPath, verifyIdentity, PI_GUARD_PACKAGE_NAME, PI_SHUTTLE_PACKAGE_NAME } from './components.js';
import type { ComponentResult, GatewayComponentIdentity, GatewayInstallResult, PiGuardInstallResult } from './components.js';
import { regularFileOrNull, scanArtifactMembers } from './archive.js';
import { findPackageRoot, hashPackageTree, readPackageIdentity } from './artifact.js';
import { inspectInstallerReceipt, newReceipt, readReceipt, writeReceipt } from './receipt.js';
import type { GatewayReceiptEntry, InstallReceipt, PiGuardReceiptEntry } from './receipt.js';
import type { InstallerSelections, SourceTransition } from './selection.js';
import { absolutePathProblem } from './selection.js';

/** Historical outcome formatter + change wording (previous-generation core; kept for its own tests). */
export function successfulChange(upgradedFrom: string | undefined, sourceTransition: SourceTransition | undefined): string | undefined {
  if (sourceTransition?.kind === 'latest-source') return 'updated pi-shuttle Latest source';
  if (sourceTransition?.kind === 'stable-to-latest') return `switched pi-shuttle ${upgradedFrom ?? PI_SHUTTLE_VERSION} from Stable to Latest`;
  return upgradedFrom !== undefined ? `upgraded pi-shuttle ${upgradedFrom} → ${PI_SHUTTLE_VERSION}` : undefined;
}

export function formatOutcome(outcome: InstallOutcome): string {
  switch (outcome.kind) {
    case 'COMPLETE': {
      const change = successfulChange(outcome.upgradedFrom, outcome.sourceTransition);
      return `result: COMPLETE — all selected components installed and verified${change !== undefined ? `; ${change}` : ''}`;
    }
    case 'PARTIAL': {
      const change = successfulChange(outcome.upgradedFrom, outcome.sourceTransition);
      return `result: PARTIAL INSTALLATION${change !== undefined ? ` — ${change}` : ''}${outcome.omitted.length > 0 ? ` — not installed: ${outcome.omitted.join(', ')}` : ''}${outcome.notes.length > 0 ? `\n  notes: ${outcome.notes.join('\n  notes: ')}` : ''}`;
    }
    case 'ALREADY_INSTALLED':
      return `result: ALREADY INSTALLED — pi-shuttle ${outcome.version} is verified; no changes were needed`;
    case 'UPGRADE_AVAILABLE':
      if (outcome.sourceTransition?.kind === 'latest-source') return `result: LATEST SOURCE UPDATE AVAILABLE — verified pi-shuttle Latest source can be updated from ${outcome.sourceTransition.installedSource} to ${outcome.sourceTransition.latestSource}; explicit confirmation is required`;
      if (outcome.sourceTransition?.kind === 'stable-to-latest') return `result: CHANNEL SWITCH AVAILABLE — verified pi-shuttle Stable ${outcome.installedVersion} can switch to Latest ${outcome.installerVersion}; explicit confirmation is required`;
      return `result: UPGRADE AVAILABLE — verified pi-shuttle ${outcome.installedVersion} can be upgraded to ${outcome.installerVersion}; explicit confirmation is required`;
    case 'UPGRADE_DECLINED':
      if (outcome.sourceTransition?.kind === 'latest-source') return 'result: LATEST SOURCE UPDATE DECLINED — pi-shuttle Latest source was preserved unchanged';
      if (outcome.sourceTransition?.kind === 'stable-to-latest') return `result: CHANNEL SWITCH DECLINED — pi-shuttle Stable ${outcome.installedVersion} was preserved unchanged`;
      return `result: UPGRADE DECLINED — pi-shuttle ${outcome.installedVersion} was preserved unchanged`;
    case 'INCOMPLETE_DECLINED':
      return 'result: INCOMPLETE CLEANUP DECLINED — No installation changes were made.';
    case 'FAILED':
      return `result: FAILED at stage "${outcome.stage}" — ${outcome.message}\nrollback: ${outcome.rollback}`;
    case 'UNSUPPORTED':
      return `result: UNSUPPORTED — ${outcome.reason}`;
    case 'REFUSED':
      return `result: REFUSED — ${outcome.reason}`;
  }
}

export type InstallOutcome =
  | { readonly kind: 'COMPLETE'; readonly upgradedFrom?: string; readonly sourceTransition?: SourceTransition }
  | { readonly kind: 'PARTIAL'; readonly omitted: readonly string[]; readonly notes: readonly string[]; readonly upgradedFrom?: string; readonly sourceTransition?: SourceTransition }
  | { readonly kind: 'ALREADY_INSTALLED'; readonly version: string }
  | { readonly kind: 'UPGRADE_AVAILABLE'; readonly installedVersion: string; readonly installerVersion: string; readonly sourceTransition?: SourceTransition }
  | { readonly kind: 'UPGRADE_DECLINED'; readonly installedVersion: string; readonly installerVersion: string; readonly sourceTransition?: SourceTransition }
  | { readonly kind: 'INCOMPLETE_DECLINED' }
  | { readonly kind: 'FAILED'; readonly stage: string; readonly rollback: string; readonly message: string }
  | { readonly kind: 'UNSUPPORTED'; readonly reason: string }
  | { readonly kind: 'REFUSED'; readonly reason: string };

export interface InstallOptions {
  readonly selections: InstallerSelections;
  /** Share-dir override (prompt 3). */
  readonly installDir?: string;
  /** Bin-dir override (prompt 4). */
  readonly binDir?: string;
  /** Local component artifact directory (the local lane). */
  readonly artifactDir?: string;
  readonly expectGatewaySha256?: string;
  readonly expectPiGuardSha256?: string;
  /**
   * PS-8A release lane: the digest-verified pi-shuttle release package
   * (tgz). When set, the core activates the pi-shuttle package itself
   * into packages storage and points the bin link at the activated
   * package — the release installer runs from an ephemeral shell
   * extraction, so linking to the running module would dangle after
   * cleanup. Same scan/identity/activation/rollback discipline as
   * components.
   */
  readonly releasePackageTgz?: string;
  /** Latest-channel source identity, e.g. mfx-labs/pi-shuttle@<full-sha>. */
  readonly sourceIdentity?: string;
  /** Called only after the existing installation's ownership is proven. */
  readonly confirmUpgrade?: (installedVersion: string, installerVersion: string, sourceTransition?: SourceTransition) => Promise<boolean>;
  /** Explicit consent for narrow cleanup followed by a fresh installation. */
  readonly confirmIncompleteCleanup?: (evidence: readonly string[]) => Promise<boolean>;
  /**
   * Injectable UID observation (SIR-PS3-007 root refusal). Defaults to
   * `process.getuid()` when absent; test-only seam, never hard-coded.
   */
  readonly uid?: number;
}

export interface InstallAttempt {
  layout: LayoutPaths;
  readonly receiptPath: string;
  readonly stagingDir: string;
  /** Assigned during the locked run (release lane may retarget it). */
  binLinkTarget: string;
  binLinkCreated: boolean;
  /** Exact prior target replaced during an upgrade; restored on rollback. */
  binLinkPreviousTarget?: string;
  /** External Pi-side state caused by THIS attempt (SIR-PS3-002). */
  piGuardPiState: 'none' | 'pre-existing' | 'attempt-installed';
  /** Recursively removable roots, each proven by successful atomic creation. */
  readonly rollbackCandidates: Array<{ readonly path: string; readonly createdByThisAttempt: true }>;
}

export interface RollbackReport {
  /** 'rolled-back' = every attempt-created mutation was removed. */
  readonly state: 'rolled-back' | 'partial';
  readonly message: string;
}

/** Defensive absolute-path guard for direct/programmatic core callers. */
function validateInstallPaths(shareDir: string, binDir: string): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const shareProblem = absolutePathProblem(shareDir, 'installDir');
  if (shareProblem !== null) return { ok: false, message: shareProblem };
  const binProblem = absolutePathProblem(binDir, 'binDir');
  if (binProblem !== null) return { ok: false, message: binProblem };
  return { ok: true };
}

function layoutWithOverrides(home: string, options: InstallOptions): LayoutPaths {
  const base = resolveLayout(home);
  if (options.installDir === undefined && options.binDir === undefined) return base;
  return {
    ...base,
    ...(options.installDir !== undefined ? { shareDir: options.installDir, storesDir: join(options.installDir, 'stores'), packagesDir: join(options.installDir, 'packages'), gitHomeDir: join(options.installDir, 'git-home'), gitTmpDir: join(options.installDir, 'git-tmp'), manifestsDir: join(options.installDir, 'manifests') } : {}),
    ...(options.binDir !== undefined ? { binDir: options.binDir } : {}),
  };
}

/** The pi-shuttle package entry this installer runs from (local lane). */
function ownCliPath(): string {
  return fileURLToPath(new URL('../cli.js', import.meta.url));
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    return !['ENOENT', 'ENOTDIR'].includes((err as NodeJS.ErrnoException).code ?? '');
  }
}

interface OwnedInstallation {
  readonly binTarget: string;
  readonly installPath?: string;
  readonly treeSha256?: string;
}

export interface IncompleteInstallation {
  readonly evidence: readonly string[];
  readonly commandTarget?: string;
  readonly obsoleteReceipt: boolean;
  readonly obsoleteReceiptLock?: string;
  readonly staleStaging: readonly string[];
  readonly exactLatestTarget?: string;
  /** The exact Latest target is the currently selected command package. */
  readonly activeExactLatestTarget?: string;
}

export type InstallationClassification =
  | { readonly kind: 'CLEAN' }
  | { readonly kind: 'INSTALLED'; readonly receipt: InstallReceipt }
  | { readonly kind: 'INCOMPLETE'; readonly state: IncompleteInstallation }
  | { readonly kind: 'REFUSED'; readonly reason: string };

interface ShuttleCandidate {
  readonly root: string;
  readonly version: string;
  readonly binTarget: string;
}

/** Prove only the basic package identity needed for normal ownership checks. */
function inspectShuttleCandidate(layout: LayoutPaths, root: string): ComponentResult<ShuttleCandidate> {
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || dirname(realpathSync(root)) !== realpathSync(layout.packagesDir)) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `pi-shuttle package is not a confined real directory: ${root}` };
    }
  } catch {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `pi-shuttle package could not be inspected: ${root}` };
  }
  const identity = readPackageIdentity(root);
  if (identity === null || identity.name !== PI_SHUTTLE_PACKAGE_NAME
    || parseVersionTriple(identity.version) === null
    || !isPiShuttlePackageDirName(basename(root), identity.version)
    || Object.keys(identity.bin).length !== 1
    || identity.bin[PI_SHUTTLE_PACKAGE_NAME] === undefined) {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `pi-shuttle package identity is missing or invalid: ${root}` };
  }
  const bin = validateBinPath(identity.bin[PI_SHUTTLE_PACKAGE_NAME]!, root);
  if (!bin.ok) return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: bin.message };
  const binTarget = join(root, bin.value);
  if (!regularFileOrNull(binTarget)) {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `pi-shuttle package command is missing or not a regular file: ${binTarget}` };
  }
  return { ok: true, value: { root, version: identity.version, binTarget } };
}

function inspectComponentLeftover(path: string, name: string, version: string): string | null {
  if (!pathEntryExists(path)) return null;
  try {
    const stat = lstatSync(path);
    const identity = readPackageIdentity(path);
    return stat.isDirectory() && !stat.isSymbolicLink() && identity?.name === name && identity.version === version
      ? path
      : `existing component target has ambiguous identity: ${path}`;
  } catch {
    return `existing component target could not be inspected: ${path}`;
  }
}

/**
 * Classify persistent installation state without reconstructing authority.
 * Retained package versions are evidence only; none is selected by order,
 * version, or mtime.
 */
export function classifyInstallationState(
  layout: LayoutPaths,
  gatewayDescriptor: GatewayLaneDescriptor,
  gatewayIdentity: GatewayComponentIdentity,
  sourceIdentity: string | undefined,
  staleLockRemoved = false,
): InstallationClassification {
  const receipt = inspectInstallerReceipt(layout.installReceiptPath);
  if (receipt.kind === 'REFUSE') {
    return { kind: 'REFUSED', reason: `existing installation receipt is unrecognized or ambiguous (${receipt.detail}); refusing` };
  }
  if (receipt.kind === 'FINAL') return { kind: 'INSTALLED', receipt: receipt.receipt };

  const evidence: string[] = [];
  const staleStaging: string[] = [];
  let commandTarget: string | undefined;
  let obsoleteReceiptLock: string | undefined;
  let exactLatestTarget: string | undefined;
  let activeExactLatestTarget: string | undefined;
  if (receipt.kind === 'INCOMPLETE') evidence.push(receipt.detail);
  if (staleLockRemoved) evidence.push('stale install.lock from a dead process');

  // Historical receipt publication used this second lock. It is now only
  // recognized installer residue in the canonical state directory.
  const obsoleteReceiptLockPath = join(layout.stateDir, 'install.json.lock');
  if (pathEntryExists(obsoleteReceiptLockPath)) {
    try {
      const stat = lstatSync(obsoleteReceiptLockPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { kind: 'REFUSED', reason: `obsolete receipt lock is not a regular file: ${obsoleteReceiptLockPath}; refusing` };
      }
      obsoleteReceiptLock = obsoleteReceiptLockPath;
      evidence.push(`obsolete install.json.lock: ${obsoleteReceiptLockPath}`);
    } catch {
      return { kind: 'REFUSED', reason: `obsolete receipt lock could not be safely inspected: ${obsoleteReceiptLockPath}; refusing` };
    }
  }

  const commandPath = join(layout.binDir, PI_SHUTTLE_PACKAGE_NAME);
  if (pathEntryExists(commandPath)) {
    let rawTarget: string;
    try {
      if (!lstatSync(commandPath).isSymbolicLink()) {
        return { kind: 'REFUSED', reason: `${commandPath} is not a pi-shuttle-owned symlink; refusing` };
      }
      rawTarget = readlinkSync(commandPath);
    } catch {
      return { kind: 'REFUSED', reason: `${commandPath} could not be safely inspected; refusing` };
    }
    commandTarget = resolve(dirname(commandPath), rawTarget);
    const relativeTarget = relative(layout.packagesDir, commandTarget);
    const packageName = relativeTarget.split(sep)[0];
    if (relativeTarget.startsWith('..') || relativeTarget === '' || packageName === undefined) {
      return { kind: 'REFUSED', reason: `${commandPath} points outside the canonical pi-shuttle package namespace (${rawTarget}); refusing` };
    }
    const candidate = inspectShuttleCandidate(layout, join(layout.packagesDir, packageName));
    if (!candidate.ok || resolve(candidate.value.binTarget) !== commandTarget) {
      return { kind: 'REFUSED', reason: `${commandPath} does not point to a safely proven pi-shuttle package (${rawTarget}); refusing` };
    }
    evidence.push(`pi-shuttle command leftover: ${commandPath}`);
  }

  try {
    for (const name of readdirSync(layout.packagesDir)) {
      if (!name.startsWith(componentDirName(PI_SHUTTLE_PACKAGE_NAME, ''))) continue;
      const root = join(layout.packagesDir, name);
      const candidate = inspectShuttleCandidate(layout, root);
      if (!candidate.ok) return { kind: 'REFUSED', reason: `pi-shuttle package namespace contains ambiguous state (${candidate.message}); refusing` };
      evidence.push(`retained pi-shuttle package: ${root}`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') return { kind: 'REFUSED', reason: `canonical package storage could not be inspected (${code ?? 'unknown error'}); refusing` };
  }

  for (const [path, name, version] of [
    [join(layout.packagesDir, componentDirName(gatewayIdentity.packageName, gatewayDescriptor.version)), gatewayIdentity.packageName, gatewayDescriptor.version],
    [join(layout.packagesDir, componentDirName(PI_GUARD_PACKAGE_NAME, PI_GUARD_VERSION)), PI_GUARD_PACKAGE_NAME, PI_GUARD_VERSION],
  ] as const) {
    const found = inspectComponentLeftover(path, name, version);
    if (found?.startsWith('/') === true) evidence.push(`reusable component leftover: ${found}`);
    else if (found !== null) return { kind: 'REFUSED', reason: `${found}; refusing` };
  }

  if (pathEntryExists(layout.stagingDir)) {
    try {
      const stat = lstatSync(layout.stagingDir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return { kind: 'REFUSED', reason: `installer staging path is not a real directory: ${layout.stagingDir}` };
      for (const name of readdirSync(layout.stagingDir)) {
        if (!/^ps3-[1-9][0-9]*-[1-9][0-9]*$/.test(name)) continue;
        const path = join(layout.stagingDir, name);
        const child = lstatSync(path);
        if (!child.isDirectory() || child.isSymbolicLink()) return { kind: 'REFUSED', reason: `recognized installer staging entry has an unsafe type: ${path}` };
        staleStaging.push(path);
        evidence.push(`interrupted installer staging: ${path}`);
      }
    } catch (err) {
      return { kind: 'REFUSED', reason: `installer staging could not be inspected (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}); refusing` };
    }
  }

  if (sourceIdentity !== undefined) {
    const intended = join(layout.packagesDir, piShuttlePackageDirName(PI_SHUTTLE_VERSION, sourceIdentity));
    if (pathEntryExists(intended)) {
      const candidate = inspectShuttleCandidate(layout, intended);
      if (!candidate.ok || candidate.value.version !== PI_SHUTTLE_VERSION) {
        return { kind: 'REFUSED', reason: `the exact Latest destination is not a safely proven pi-shuttle package (${intended}); refusing` };
      }
      exactLatestTarget = intended;
      if (commandTarget !== undefined && resolve(candidate.value.binTarget) === commandTarget) {
        activeExactLatestTarget = intended;
      }
      evidence.push(`incomplete exact Latest destination: ${intended}`);
    }
  }

  if (evidence.length === 0) return { kind: 'CLEAN' };
  return {
    kind: 'INCOMPLETE',
    state: {
      evidence: [...new Set(evidence)],
      ...(commandTarget !== undefined ? { commandTarget } : {}),
      obsoleteReceipt: receipt.kind === 'INCOMPLETE',
      ...(obsoleteReceiptLock !== undefined ? { obsoleteReceiptLock } : {}),
      staleStaging,
      ...(exactLatestTarget !== undefined ? { exactLatestTarget } : {}),
      ...(activeExactLatestTarget !== undefined ? { activeExactLatestTarget } : {}),
    },
  };
}

function cleanIncompleteBlockers(layout: LayoutPaths, state: IncompleteInstallation): ComponentResult<undefined> {
  try {
    if (state.obsoleteReceipt) rmSync(layout.installReceiptPath);
    if (state.obsoleteReceiptLock !== undefined) rmSync(state.obsoleteReceiptLock);
    for (const path of state.staleStaging) rmSync(path, { recursive: true });
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, code: 'ERR-PS3-INCOMPLETE-CLEANUP', message: `authorized incomplete-state cleanup failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
}

/** Prove receipt, package, component, and symlink ownership before upgrade mutation. */
async function verifyOwnedInstallation(
  receipt: InstallReceipt,
  layout: LayoutPaths,
  lane: string,
  gatewayDescriptor: GatewayLaneDescriptor,
  gatewayIdentity: GatewayComponentIdentity,
  piExecutable: string | null,
): Promise<ComponentResult<OwnedInstallation>> {
  if (receipt.installDir !== layout.shareDir || receipt.binDir !== layout.binDir) {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'the requested install/bin layout does not match the recorded installation layout' };
  }
  if (receipt.platformLane !== lane) {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `the receipt platform lane ${receipt.platformLane} does not match this host lane ${lane}` };
  }

  const historicalRoot = join(layout.packagesDir, componentDirName(PI_SHUTTLE_PACKAGE_NAME, receipt.piShuttleVersion));
  const shuttleRoot = receipt.piShuttleInstallPath ?? historicalRoot;
  if (receipt.channel === 'latest') {
    const expected = join(layout.packagesDir, piShuttlePackageDirName(receipt.piShuttleVersion, receipt.sourceIdentity));
    if (receipt.piShuttleInstallPath === undefined || receipt.piShuttleTreeSha256 === undefined || shuttleRoot !== expected) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'latest receipt does not bind the exact source-qualified pi-shuttle package and tree digest' };
    }
  } else if (receipt.piShuttleInstallPath !== undefined && shuttleRoot !== historicalRoot) {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `stable receipt records an unexpected pi-shuttle package path at ${shuttleRoot}` };
  }
  const shuttle = inspectShuttleCandidate(layout, shuttleRoot);
  let binTarget: string;
  let packageTreeSha256: string | undefined;
  if (shuttle.ok) {
    if (shuttle.value.version !== receipt.piShuttleVersion) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `recorded pi-shuttle package has incompatible identity at ${shuttleRoot}` };
    }
    binTarget = shuttle.value.binTarget;
    const digest = await hashPackageTree(shuttleRoot);
    if (!digest.ok) return { ok: false, code: digest.code, message: digest.message };
    packageTreeSha256 = digest.value;
    if (receipt.piShuttleTreeSha256 !== undefined && receipt.piShuttleTreeSha256 !== digest.value) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `recorded pi-shuttle package bytes drifted at ${shuttleRoot}` };
    }
  } else if (receipt.piShuttleInstallPath === undefined && receipt.piShuttleVersion === PI_SHUTTLE_VERSION && !pathEntryExists(shuttleRoot)) {
    binTarget = ownCliPath();
  } else {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `recorded pi-shuttle package is missing or invalid at ${shuttleRoot} (${shuttle.message})` };
  }
  if (!regularFileOrNull(binTarget)) {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `recorded pi-shuttle command is missing or not a regular file: ${binTarget}` };
  }
  try {
    if (readlinkSync(join(layout.binDir, PI_SHUTTLE_PACKAGE_NAME)) !== binTarget) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'recorded pi-shuttle command does not select the receipt-bound package' };
    }
  } catch {
    return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'recorded pi-shuttle command entry is missing or is not a symlink' };
  }

  const gatewayTarget = join(layout.packagesDir, componentDirName(gatewayIdentity.packageName, gatewayDescriptor.version));
  const gateway = await inspectExistingGateway(gatewayTarget, process.execPath, gatewayIdentity, gatewayDescriptor.version);
  if (!gateway.ok) return gateway;
  const gatewayReceipt = receipt.components.gateway;
  if (gatewayReceipt === null) {
    if (gateway.value !== null) return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `gateway package exists at ${gatewayTarget} but is not recorded in the receipt` };
  } else {
    if (gatewayReceipt.version !== gatewayDescriptor.version || gatewayReceipt.commit !== gatewayDescriptor.commit) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'recorded gateway identity does not match the installer release identity' };
    }
    if (gateway.value === null || gatewayReceipt.installPath !== gatewayTarget || gatewayReceipt.binPath !== gateway.value.binPath) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'recorded gateway paths do not match the owned gateway package' };
    }
    if (gatewayReceipt.status === 'installed-verified' && gateway.value.status !== 'installed-verified') {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'gateway is recorded as verified but its owned command no longer passes verification' };
    }
  }

  const piGuardTarget = join(layout.packagesDir, componentDirName(PI_GUARD_PACKAGE_NAME, PI_GUARD_VERSION));
  const piGuard = await inspectExistingPiGuard(piGuardTarget, piExecutable, PI_GUARD_VERSION);
  if (!piGuard.ok) return piGuard;
  const piGuardReceipt = receipt.components.piGuard;
  if (piGuardReceipt === null) {
    if (piGuard.value !== null) return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: `pi-guard package exists at ${piGuardTarget} but is not recorded in the receipt` };
  } else {
    if (piGuardReceipt.version !== PI_GUARD_VERSION || piGuardReceipt.commit !== PI_GUARD_COMMIT) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'recorded pi-guard identity does not match the installer release identity' };
    }
    if (piGuard.value === null || piGuardReceipt.installPath !== piGuardTarget || piGuardReceipt.sourcePath !== piGuardTarget) {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'recorded pi-guard paths do not match the owned pi-guard package' };
    }
    if (piGuardReceipt.verifiedBy === 'pi-list' && piGuard.value.verifiedBy !== 'pi-list') {
      return { ok: false, code: 'ERR-PS3-OWNERSHIP', message: 'pi-guard is recorded as installed in Pi but its exact owned source is no longer present' };
    }
  }
  return {
    ok: true,
    value: {
      binTarget,
      ...(packageTreeSha256 !== undefined ? { installPath: shuttleRoot, treeSha256: packageTreeSha256 } : {}),
    },
  };
}

/** Replace a symlink by rename within its directory (atomic on supported POSIX lanes). */
function replaceSymlinkAtomically(linkPath: string, target: string): void {
  const temporary = join(dirname(linkPath), `.pi-shuttle-link-${process.pid}-${Date.now()}`);
  try {
    symlinkSync(target, temporary);
    renameSync(temporary, linkPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function refuseAfterRollback(attempt: InstallAttempt, reason: string): InstallOutcome {
  const report = rollback(attempt);
  return { kind: 'REFUSED', reason: `${reason} (${report.message}); prior installation state was preserved` };
}

/**
 * Roll back THIS attempt's own mutations and report the outcome
 * truthfully (exported for focused rollback tests; production callers are
 * inside this module). A rollback must NEVER remove: pre-existing
 * component installs, a pre-existing receipt, a pre-existing/foreign bin
 * link, the external Pi install of a pre-existing pi-guard, unrelated Pi
 * extensions, stores, project dirs, or Git state.
 */
export function rollback(attempt: InstallAttempt): RollbackReport {
  const residual: string[] = [];
  const created = attempt.rollbackCandidates.map((candidate) => candidate.path);
  let upgradedLinkRestored = true;
  if (attempt.binLinkPreviousTarget !== undefined) {
    const binLink = join(attempt.layout.binDir, 'pi-shuttle');
    let ours = false;
    try {
      ours = readlinkSync(binLink) === attempt.binLinkTarget;
    } catch {
      ours = false;
    }
    if (ours) {
      try {
        replaceSymlinkAtomically(binLink, attempt.binLinkPreviousTarget);
      } catch {
        upgradedLinkRestored = false;
        residual.push('could not restore the prior pi-shuttle command link; the new package was preserved to keep the command usable');
      }
    } else {
      upgradedLinkRestored = false;
      residual.push('bin link was replaced by another entry and was preserved');
    }
  } else if (attempt.binLinkCreated) {
    // SIR-PS3-011: unlink only while the link still points exactly at this
    // attempt's target; a foreign replacement is preserved and reported.
    let ours = false;
    try {
      ours = readlinkSync(join(attempt.layout.binDir, 'pi-shuttle')) === attempt.binLinkTarget;
    } catch {
      ours = false;
    }
    if (ours) {
      created.push(join(attempt.layout.binDir, 'pi-shuttle'));
    } else {
      residual.push('bin link was replaced by another entry and was preserved');
    }
  }
  let removed = 0;
  for (const path of created) {
    if (!upgradedLinkRestored && (attempt.binLinkTarget === path || attempt.binLinkTarget.startsWith(`${path}/`))) {
      residual.push(`new package was preserved because the command link still refers to it: ${path}`);
      continue;
    }
    try {
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      residual.push(`could not remove attempt-created path: ${path}`);
    }
  }
  // SIR-PS3-002: the external `pi install` side effect of THIS attempt is
  // not removable through any supported mechanism in v0.1.0 — never claim
  // full rollback while it remains.
  if (attempt.piGuardPiState === 'attempt-installed') {
    residual.push('pi-guard remains installed in the Pi package store (no supported removal mechanism in v0.1.0); re-run the installer or remove it manually');
  }
  removeStaging(attempt.stagingDir);
  if (removed === created.length && residual.length === 0) {
    return { state: 'rolled-back', message: 'rolled back' };
  }
  return {
    state: 'partial',
    message: `partial rollback (${removed}/${created.length} attempt-created paths removed${residual.length > 0 ? `; ${residual.join('; ')}` : ''})`,
  };
}

/**
 * C1: build the gateway receipt entry from the SELECTED per-lane
 * descriptor — receipt version/commit are the descriptor's values, never
 * the historical constants. Pure; exported for focused receipt tests.
 */
export function gatewayReceiptEntryFromResult(descriptor: GatewayLaneDescriptor, result: GatewayInstallResult): GatewayReceiptEntry {
  return {
    status: result.status,
    version: descriptor.version,
    commit: descriptor.commit,
    commitVerified: false,
    digestVerified: result.digestVerified,
    artifactSha256: result.artifactSha256,
    installPath: result.installPath,
    binPath: result.binPath,
    smoke: result.smoke,
  };
}

/** Run the install flow. Pure orchestration; all I/O is installer-owned. */
export async function runInstall(env: HostEnvironment, options: InstallOptions): Promise<InstallOutcome> {
  if (options.sourceIdentity !== undefined && !/^mfx-labs\/pi-shuttle@[0-9a-f]{40}$/.test(options.sourceIdentity)) {
    return { kind: 'REFUSED', reason: 'latest source identity must be mfx-labs/pi-shuttle@<full-sha>' };
  }
  // 0. Path-input defense: HOME/installDir/binDir must be absolute BEFORE
  // any installation mutation — the receipt schema requires absolute
  // paths, so a relative value could never produce self-valid state.
  // Checked against the RESOLVED layout so direct callers cannot bypass
  // the argument/prompt validation: no state dir, staging, package
  // dirs, links, or receipts are created for invalid path inputs.
  const homeProblem = absolutePathProblem(env.home, 'HOME');
  if (homeProblem !== null) return { kind: 'REFUSED', reason: homeProblem };
  const layout = layoutWithOverrides(env.home, options);
  const pathGuard = validateInstallPaths(layout.shareDir, layout.binDir);
  if (!pathGuard.ok) return { kind: 'REFUSED', reason: pathGuard.message };

  // 1. Platform/architecture lane.
  const laneCheck = checkPlatformLane(env);
  if (!laneCheck.ok) return { kind: 'UNSUPPORTED', reason: laneCheck.message };
  const lane = hostLane(env.platform, env.arch);

  // C1: resolve the per-lane Gateway identity BEFORE any component
  // decision. gatewayDescriptorForLane() is the ONLY lane-selection
  // authority; a missing/invalid/unmapped identity fails closed here,
  // before installing or reconciling any Gateway component.
  const descriptorResult = gatewayDescriptorForLane(lane);
  if (!descriptorResult.ok) {
    return { kind: 'REFUSED', reason: `gateway identity is not bound for host lane ${lane} (${descriptorResult.code}); refusing before any component consumption` };
  }
  const gatewayDescriptor = descriptorResult.descriptor;
  const gatewayIdentity: GatewayComponentIdentity = {
    packageName: gatewayDescriptor.packageName,
    artifactFileName: gatewayDescriptor.artifactFileName,
    binName: gatewayDescriptor.binName,
  };

  // 2. Node lane (the running interpreter is the installer's node).
  const nodeCheck = checkNodeLane();
  if (!nodeCheck.ok) return { kind: 'REFUSED', reason: nodeCheck.message };

  // 3. Per-user installation rule (SIR-PS3-007): never run as root.
  const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : null);
  const rootCheck = checkNotRoot(uid);
  if (!rootCheck.ok) return { kind: 'REFUSED', reason: rootCheck.message };

  // 4. Create only the state parent needed for the one shared O_EXCL lock.
  // Classification and every installation mutation happen while it is held.
  const installLockPath = join(layout.stateDir, 'install.lock');
  const attempt: InstallAttempt = {
    layout,
    receiptPath: layout.installReceiptPath,
    stagingDir: join(layout.stagingDir, `ps3-${process.pid}-${Date.now()}`),
    binLinkTarget: '',
    binLinkCreated: false,
    piGuardPiState: 'none',
    rollbackCandidates: [],
  };
  try {
    mkdirSync(layout.stateDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { kind: 'REFUSED', reason: `state directory could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  const installLock = acquireInstallLock(installLockPath);
  if (!installLock.ok) {
    return { kind: 'REFUSED', reason: installLock.code === 'ERR-PS2-CONFIG-BUSY' ? `BUSY — ${installLock.message}` : installLock.message };
  }
  let outcome: InstallOutcome;
  try {
    outcome = await runInstallLocked(env, options, lane, gatewayDescriptor, gatewayIdentity, attempt, installLock.staleRemoved);
  } finally {
    releaseInstallLock(installLock.fd, installLockPath);
  }
  return outcome;
}

/** The locked install body: all state decisions and mutations happen here. */
async function runInstallLocked(env: HostEnvironment, options: InstallOptions, lane: string, gatewayDescriptor: GatewayLaneDescriptor, gatewayIdentity: GatewayComponentIdentity, attempt: InstallAttempt, staleLockRemoved: boolean): Promise<InstallOutcome> {
  let layout = attempt.layout;
  const classified = classifyInstallationState(layout, gatewayDescriptor, gatewayIdentity, options.sourceIdentity, staleLockRemoved);
  if (classified.kind === 'REFUSED') return { kind: 'REFUSED', reason: classified.reason };

  let prior: ReturnType<typeof readReceipt> = { ok: false, code: 'absent', message: 'no final receipt' };
  let incompleteState: IncompleteInstallation | undefined;
  if (classified.kind === 'INSTALLED') {
    prior = { ok: true, receipt: classified.receipt };
    if ((options.installDir !== undefined && options.installDir !== classified.receipt.installDir)
      || (options.binDir !== undefined && options.binDir !== classified.receipt.binDir)) {
      return { kind: 'REFUSED', reason: `existing owned installation uses installDir ${classified.receipt.installDir} and binDir ${classified.receipt.binDir}; changing its layout is not supported during upgrade, so prior state was preserved` };
    }
    layout = layoutWithOverrides(env.home, { ...options, installDir: classified.receipt.installDir, binDir: classified.receipt.binDir });
    const recordedPathGuard = validateInstallPaths(layout.shareDir, layout.binDir);
    if (!recordedPathGuard.ok) return { kind: 'REFUSED', reason: recordedPathGuard.message };
    attempt.layout = layout;
  } else if (classified.kind === 'INCOMPLETE') {
    incompleteState = classified.state;
    process.stdout.write(`pi-shuttle: INCOMPLETE previous installation detected\n${classified.state.evidence.map((entry) => `  - ${entry}`).join('\n')}\n`);
    if (options.confirmIncompleteCleanup === undefined) {
      return { kind: 'REFUSED', reason: 'explicit cleanup/reinstall consent is required; no installation changes were made' };
    }
    let accepted = false;
    try {
      accepted = await options.confirmIncompleteCleanup(classified.state.evidence);
    } catch (err) {
      return { kind: 'REFUSED', reason: `incomplete cleanup consent could not be completed (${(err as Error).message || 'unknown error'}); no installation changes were made` };
    }
    if (!accepted) return { kind: 'INCOMPLETE_DECLINED' };
    const cleaned = cleanIncompleteBlockers(layout, classified.state);
    if (!cleaned.ok) return { kind: 'REFUSED', reason: cleaned.message };
  }

  const piExecutable = resolveExecutable('pi');
  let upgradeFrom: string | undefined;
  let sourceTransition: SourceTransition | undefined;
  let ownedBinTarget: string | undefined;
  let installedShuttlePath: string | undefined;
  let installedShuttleTreeSha256: string | undefined;
  let installSelections = options.selections;
  let sameVersionCompletion = false;
  if (prior.ok) {
    const installedVersion = parseVersionTriple(prior.receipt.piShuttleVersion);
    const installerVersion = parseVersionTriple(PI_SHUTTLE_VERSION);
    if (installedVersion === null || installerVersion === null) {
      return { kind: 'REFUSED', reason: `existing owned installation has an unclassifiable pi-shuttle version (${prior.receipt.piShuttleVersion}); prior state was preserved` };
    }
    const owned = await verifyOwnedInstallation(prior.receipt, layout, lane, gatewayDescriptor, gatewayIdentity, piExecutable);
    if (!owned.ok) {
      return { kind: 'REFUSED', reason: `existing owned installation is corrupted or no longer matches its receipt (${owned.message}); automatic mutation was refused and prior state was preserved` };
    }
    ownedBinTarget = owned.value.binTarget;
    installedShuttlePath = owned.value.installPath;
    installedShuttleTreeSha256 = owned.value.treeSha256;
    const comparison = compareVersionTriples(installedVersion, installerVersion);
    sourceTransition = comparison === 0 && options.sourceIdentity !== undefined
      && (prior.receipt.channel !== 'latest' || prior.receipt.sourceIdentity !== options.sourceIdentity)
      ? prior.receipt.channel === 'latest'
        ? { kind: 'latest-source', installedSource: prior.receipt.sourceIdentity!, latestSource: options.sourceIdentity }
        : { kind: 'stable-to-latest', latestSource: options.sourceIdentity }
      : undefined;
    if (comparison === 0 && sourceTransition === undefined) {
      const gatewayMissing = options.selections.gateway && prior.receipt.components.gateway === null;
      const piGuardMissing = options.selections.piGuard && prior.receipt.components.piGuard === null;
      const requestedEntries = [
        options.selections.gateway ? prior.receipt.components.gateway : null,
        options.selections.piGuard ? prior.receipt.components.piGuard : null,
      ];
      if (requestedEntries.some((entry) => entry?.status === 'failed')) {
        return { kind: 'REFUSED', reason: 'a requested component is recorded as failed; same-version completion is not an automatic repair operation, so prior state was preserved' };
      }
      const needsReverification = requestedEntries.some((entry) => entry?.status === 'installed-unverified');
      if (!gatewayMissing && !piGuardMissing && !needsReverification) return { kind: 'ALREADY_INSTALLED', version: PI_SHUTTLE_VERSION };
      installSelections = { gateway: gatewayMissing, piGuard: piGuardMissing };
      sameVersionCompletion = true;
    }
    if (comparison > 0) {
      return { kind: 'REFUSED', reason: `installed pi-shuttle ${prior.receipt.piShuttleVersion} is newer than installer ${PI_SHUTTLE_VERSION}; downgrade was refused and prior state was preserved` };
    }
    if (comparison < 0 || sourceTransition !== undefined) {
      if (options.confirmUpgrade === undefined) {
        return {
          kind: 'UPGRADE_AVAILABLE',
          installedVersion: prior.receipt.piShuttleVersion,
          installerVersion: PI_SHUTTLE_VERSION,
          ...(sourceTransition !== undefined ? { sourceTransition } : {}),
        };
      }
      let accepted = false;
      try {
        accepted = await options.confirmUpgrade(prior.receipt.piShuttleVersion, PI_SHUTTLE_VERSION, sourceTransition);
      } catch (err) {
        return { kind: 'REFUSED', reason: `upgrade confirmation could not be completed (${(err as Error).message || 'unknown error'}); prior state was preserved` };
      }
      if (!accepted) {
        return {
          kind: 'UPGRADE_DECLINED',
          installedVersion: prior.receipt.piShuttleVersion,
          installerVersion: PI_SHUTTLE_VERSION,
          ...(sourceTransition !== undefined ? { sourceTransition } : {}),
        };
      }
      if (options.releasePackageTgz === undefined) {
        return { kind: 'REFUSED', reason: 'controlled upgrade requires the verified pi-shuttle release package; use the official release installer. The existing installation was preserved unchanged' };
      }
      upgradeFrom = prior.receipt.piShuttleVersion;
    }
  }

  // Component acquisition prerequisites (only when components are selected).
  const needsArtifacts = installSelections.gateway || installSelections.piGuard;
  if (needsArtifacts && options.artifactDir === undefined) {
    return { kind: 'REFUSED', reason: 'no artifact source configured: pass --artifact-dir <dir> (local artifact lane) or install through the official release installer (version-pinned install.sh; see README "Official release")' };
  }
  // PS-8A release lane needs tar for the pi-shuttle package activation too.
  const needsTar = needsArtifacts || options.releasePackageTgz !== undefined;
  if (needsTar) {
    const tarCheck = checkTarPresent();
    if (!tarCheck.ok) return { kind: 'REFUSED', reason: tarCheck.message };
  }
  const tarExecutable = needsTar ? resolveExecutable('tar')! : null;

  // pi presence (needed for pi-guard install AND for actual-state
  // reconciliation of an already-installed pi-guard); version
  // classification applies only when pi-guard is selected.
  let piVersion = '';
  let piGuardProbe: ((activatedPackageDir: string) => Promise<{ readonly ok: boolean; readonly detail: string }>) | undefined = undefined;
  if (installSelections.piGuard) {
    let observed: string | null = null;
    if (piExecutable !== null) {
      const versionRun = await runProcess(piExecutable, ['--version'], { timeoutMs: 15_000 });
      if (versionRun.exitCode === 0) observed = versionRun.stdout.trim().split(/\s+/)[0] ?? null;
    }
    const classification = classifyPiVersion(observed);
    const policyVerdict = applyPiPolicy(classification, PI_RUNTIME_POLICY);
    if (!policyVerdict.ok) {
      return { kind: 'REFUSED', reason: policyVerdict.message };
    }
    piVersion = classification.lane === 'missing' ? '' : classification.version;
    if (classification.lane === 'candidate') {
      // PS-6R: a candidate pi (not the 0.83.0 known-good baseline) must
      // PASS the committed pi-guard compatibility probe; the probe is
      // built BEFORE any mutation and fails closed when its infrastructure
      // (pi's extension loader) cannot be located.
      if (piExecutable === null) {
        return { kind: 'REFUSED', reason: 'pi was not found on PATH; a pi candidate cannot be probed without the pi executable' };
      }
      const loader = resolvePiLoaderFromBin(piExecutable);
      if (loader === null) {
        return { kind: 'REFUSED', reason: `pi ${classification.version} is a candidate (not the known-good baseline ${PI_COMPATIBILITY_BASELINE}) and its extension loader could not be located from ${piExecutable}; candidates require a verified integration surface` };
      }
      const resolvedLoader: string = loader;
      const probeCli = fileURLToPath(new URL('../compat/pi-guard-probe.js', import.meta.url));
      piGuardProbe = async (activatedDir) => {
        const entry = join(activatedDir, 'extensions', 'pi-guard', 'index.ts');
        const probeRun = await runProcess(process.execPath, [probeCli], {
          timeoutMs: 60_000,
          env: { ...env.pathEnv, PI_LOADER: resolvedLoader, PI_GUARD_ENTRY: entry, HOME: env.home },
        });
        if (probeRun.exitCode === 0 && probeRun.signal === null && !probeRun.timedOut) {
          return { ok: true, detail: `pi ${classification.version} passed the pi-guard compatibility probe` };
        }
        return {
          ok: false,
          detail: probeRun.exitCode === 2 ? 'probe infrastructure error (loader or entry unavailable)' : (probeRun.stderr.trim() || probeRun.stdout.trim()).slice(0, 300) || `probe exited ${probeRun.exitCode ?? 'unknown'}`,
        };
      };
    }
  }

  // Layout writability (creates the pi-shuttle layout dirs).
  const writable = ensureWritableLayout(layout);
  if (!writable.ok) return { kind: 'REFUSED', reason: writable.message };

  // Staging.
  if (needsTar) {
    try {
      mkdirSync(attempt.stagingDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      return { kind: 'FAILED', stage: 'staging', rollback: 'rolled back', message: `staging could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
    }
  }

  // Gateway component.
  // Narrowed by the guards above: needsArtifacts ⇒ artifactDir and tar are present.
  const artifactDir = options.artifactDir as string;
  const tar = tarExecutable as string;

  // PS-8A release lane: activate the pi-shuttle package itself into
  // packages storage so the bin link points at persistent state (the
  // release installer runs from an ephemeral shell extraction; linking
  // to the running module would dangle after cleanup). The package is
  // structurally scanned, identity-verified (name/version/bin), and
  // activated with the same atomic no-clobber discipline as components;
  // rollback tracks it like any other attempt-created path.
  let binLinkTarget = sameVersionCompletion ? (ownedBinTarget ?? ownCliPath()) : ownCliPath();
  let reuseActiveLatest = false;
  if (options.releasePackageTgz !== undefined && !sameVersionCompletion) {
    const releaseScan = await scanArtifactMembers(options.releasePackageTgz);
    if (!releaseScan.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: `pi-shuttle release package failed the archive policy (${releaseScan.message})` };
    }
    const releaseExtract = await extractArtifact(options.releasePackageTgz, attempt.stagingDir, 'pishuttle', tar);
    if (!releaseExtract.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: releaseExtract.message };
    }
    const releaseRoot = findPackageRoot(releaseExtract.value);
    const releaseIdentity = releaseRoot === null ? null : readPackageIdentity(releaseRoot);
    const identityCheck = verifyIdentity(releaseIdentity, PI_SHUTTLE_PACKAGE_NAME, PI_SHUTTLE_VERSION, 'pi-shuttle release');
    if (!identityCheck.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: identityCheck.message };
    }
    const binRaw = identityCheck.value.bin['pi-shuttle'];
    if (binRaw === undefined) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: 'pi-shuttle release package does not declare the pi-shuttle bin' };
    }
    const binCheck = validateBinPath(binRaw, releaseRoot ?? releaseExtract.value);
    if (!binCheck.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: binCheck.message };
    }
    const packageRoot = releaseRoot ?? releaseExtract.value;
    const sourceTree = await hashPackageTree(packageRoot);
    if (!sourceTree.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: sourceTree.message };
    }
    const shuttleTarget = join(layout.packagesDir, piShuttlePackageDirName(PI_SHUTTLE_VERSION, options.sourceIdentity));
    const verifyShuttle = (existingRoot: string): ComponentResult<unknown> => {
      const existing = readPackageIdentity(existingRoot);
      if (existing === null || existing.name !== PI_SHUTTLE_PACKAGE_NAME || existing.version !== PI_SHUTTLE_VERSION) {
        return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing pi-shuttle installation at ${existingRoot} has incompatible identity; refusing to touch it` };
      }
      return { ok: true, value: undefined };
    };
    if (incompleteState?.activeExactLatestTarget === shuttleTarget) {
      // This is the one reconciliation exception: the exact source-qualified
      // destination is also the live command package. Keep it usable unless
      // the newly staged, verified candidate proves it is identical.
      const active = inspectShuttleCandidate(layout, shuttleTarget);
      if (!active.ok || incompleteState.commandTarget === undefined
        || resolve(active.value.binTarget) !== resolve(incompleteState.commandTarget)
        || resolve(active.value.binTarget) !== resolve(join(shuttleTarget, binCheck.value))) {
        return refuseAfterRollback(attempt, 'the active exact Latest package no longer has the verified package/path/bin identity');
      }
      const activeTree = await hashPackageTree(shuttleTarget);
      if (!activeTree.ok) return refuseAfterRollback(attempt, activeTree.message);
      if (activeTree.value !== sourceTree.value) {
        return refuseAfterRollback(attempt, 'the active exact Latest package does not match the freshly verified candidate');
      }
      installedShuttlePath = shuttleTarget;
      installedShuttleTreeSha256 = sourceTree.value;
      binLinkTarget = active.value.binTarget;
      reuseActiveLatest = true;
    } else {
      if (incompleteState?.exactLatestTarget === shuttleTarget) {
        try {
          rmSync(shuttleTarget, { recursive: true });
        } catch (err) {
          const rollbackState = rollback(attempt);
          return { kind: 'FAILED', stage: 'incomplete-cleanup', rollback: rollbackState.message, message: `the authorized incomplete Latest target could not be removed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
        }
      }
      const activated = activatePackageRoot(packageRoot, shuttleTarget, verifyShuttle);
      if (!activated.ok) {
        const rollbackState = rollback(attempt);
        return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: activated.message };
      }
      if (activated.value.created) attempt.rollbackCandidates.push({ path: shuttleTarget, createdByThisAttempt: true });
      const installedTree = await hashPackageTree(shuttleTarget);
      if (!installedTree.ok || installedTree.value !== sourceTree.value) {
        const rollbackState = rollback(attempt);
        return {
          kind: 'FAILED',
          stage: 'release-package',
          rollback: rollbackState.message,
          message: installedTree.ok ? `installed pi-shuttle package bytes at ${shuttleTarget} do not match the verified release package` : installedTree.message,
        };
      }
      installedShuttlePath = shuttleTarget;
      installedShuttleTreeSha256 = sourceTree.value;
      binLinkTarget = join(shuttleTarget, binCheck.value);
    }
  }
  attempt.binLinkTarget = binLinkTarget;
  let gatewayResult: GatewayInstallResult | undefined;
  if (installSelections.gateway) {
    const gateway = await installGatewayComponent({
      context: {
        artifactDir,
        packagesDir: layout.packagesDir,
        stagingDir: attempt.stagingDir,
        nodeExecutable: process.execPath,
        expectedSha256: options.expectGatewaySha256,
        platform: env.platform,
        pathEnv: env.pathEnv,
        onPackageCreated: (path) => attempt.rollbackCandidates.push({ path, createdByThisAttempt: true }),
      },
      expectedVersion: gatewayDescriptor.version,
      expectedCommit: gatewayDescriptor.commit,
      identity: gatewayIdentity,
      tarExecutable: tar,
    });
    if (!gateway.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'gateway', rollback: rollbackState.message, message: gateway.message };
    }
    gatewayResult = gateway.value;
  }

  // pi-shuttle bin link (local lane: link to the package this installer
  // runs from). Foreign existing entries fail closed. Ordered BEFORE the
  // external pi-guard mutation so one avoidable post-Pi failure point is
  // removed (SIR-PS3-002); receipt/finalization failure still requires
  // truthful residual handling.
  if (!reuseActiveLatest) {
    const binLink = join(layout.binDir, 'pi-shuttle');
    const replaceExistingTarget = upgradeFrom !== undefined ? ownedBinTarget : incompleteState?.commandTarget;
    if (replaceExistingTarget !== undefined) {
      let existing: string;
      try {
        existing = readlinkSync(binLink);
      } catch {
        const rollbackState = rollback(attempt);
        return { kind: 'REFUSED', reason: `pi-shuttle command entry changed before activation; refusing replacement (${rollbackState.message})` };
      }
      if (resolve(dirname(binLink), existing) !== resolve(replaceExistingTarget)) {
        const rollbackState = rollback(attempt);
        return { kind: 'REFUSED', reason: `pi-shuttle command entry changed from ${replaceExistingTarget} to ${existing}; refusing replacement (${rollbackState.message})` };
      }
      try {
        replaceSymlinkAtomically(binLink, attempt.binLinkTarget);
        attempt.binLinkPreviousTarget = existing;
      } catch (err) {
        const rollbackState = rollback(attempt);
        return { kind: 'FAILED', stage: 'bin-link', rollback: rollbackState.message, message: `pi-shuttle bin link could not be activated (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
      }
    } else {
      try {
        const existing = readlinkSync(binLink);
        if (existing !== attempt.binLinkTarget) {
          const rollbackState = rollback(attempt);
          return { kind: 'REFUSED', reason: `${binLink} exists and points to ${existing}; automatic ownership cannot be established, so it was preserved (${rollbackState.message})` };
        }
      } catch {
        try {
          symlinkSync(attempt.binLinkTarget, binLink);
          attempt.binLinkCreated = true;
        } catch (err) {
          const rollbackState = rollback(attempt);
          return { kind: 'FAILED', stage: 'bin-link', rollback: rollbackState.message, message: `pi-shuttle bin link could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
        }
      }
    }
  }

  // pi-guard component (external Pi mutation tracked for rollback truthfulness).
  let piGuardResult: PiGuardInstallResult | undefined;
  if (installSelections.piGuard) {
    if (piExecutable === null) {
      const rollbackState = rollback(attempt);
      return { kind: 'REFUSED', reason: `pi executable is required for pi-guard installation but was not found on PATH (${rollbackState.message})` };
    }
    const piGuard = await installPiGuardComponent({
      context: {
        artifactDir,
        packagesDir: layout.packagesDir,
        stagingDir: attempt.stagingDir,
        nodeExecutable: process.execPath,
        expectedSha256: options.expectPiGuardSha256,
        platform: env.platform,
        pathEnv: env.pathEnv,
        onPackageCreated: (path) => attempt.rollbackCandidates.push({ path, createdByThisAttempt: true }),
      },
      expectedVersion: PI_GUARD_VERSION,
      expectedCommit: PI_GUARD_COMMIT,
      piExecutable,
      piVersion,
      tarExecutable: tar,
      compatibilityProbe: piGuardProbe,
    });
    if (!piGuard.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'pi-guard', rollback: rollbackState.message, message: piGuard.message };
    }
    piGuardResult = piGuard.value;
    attempt.piGuardPiState = piGuard.value.piMutated ? 'attempt-installed' : piGuard.value.piPreExisting ? 'pre-existing' : 'none';
  }

  // Result classification (truthful COMPLETE/PARTIAL over the ACTUAL
  // final state, SIR-PS3-009): components the operator did not select but
  // that are already installed are re-verified (bounded, read-only) and
  // recorded — the receipt never disagrees with what is installed.
  const notes: string[] = [];
  if (gatewayResult === undefined && !installSelections.gateway) {
    const gatewayTarget = join(layout.packagesDir, componentDirName(gatewayIdentity.packageName, gatewayDescriptor.version));
    const inspected = await inspectExistingGateway(gatewayTarget, process.execPath, gatewayIdentity, gatewayDescriptor.version);
    if (!inspected.ok) return refuseAfterRollback(attempt, inspected.message);
    if (inspected.value !== null) {
      const priorEntry = prior.ok ? prior.receipt.components.gateway : null;
      if (priorEntry === null && incompleteState === undefined) {
        return refuseAfterRollback(attempt, `existing gateway installation at ${gatewayTarget} is not recorded in a valid prior receipt; refusing to treat it as pi-shuttle state`);
      }
      gatewayResult = {
        status: inspected.value.status,
        installPath: inspected.value.installPath,
        binPath: inspected.value.binPath,
        artifactSha256: priorEntry?.artifactSha256 ?? null,
        digestVerified: priorEntry?.digestVerified ?? false,
        smoke: inspected.value.smoke,
        created: false,
      };
      notes.push('gateway was already installed; re-verified, not modified by this attempt');
    }
  }
  if (piGuardResult === undefined && !installSelections.piGuard) {
    const piGuardTarget = join(layout.packagesDir, componentDirName(PI_GUARD_PACKAGE_NAME, PI_GUARD_VERSION));
    const inspected = await inspectExistingPiGuard(piGuardTarget, piExecutable, PI_GUARD_VERSION);
    if (!inspected.ok) return refuseAfterRollback(attempt, inspected.message);
    if (inspected.value !== null) {
      const priorEntry = prior.ok ? prior.receipt.components.piGuard : null;
      if (priorEntry === null && incompleteState === undefined) {
        return refuseAfterRollback(attempt, `existing pi-guard installation at ${piGuardTarget} is not recorded in a valid prior receipt; refusing to treat it as pi-shuttle state`);
      }
      let currentPiVersion = priorEntry?.piVersion ?? 'unknown';
      if (priorEntry === null && piExecutable !== null) {
        const versionRun = await runProcess(piExecutable, ['--version'], { timeoutMs: 15_000 });
        const observed = versionRun.exitCode === 0 ? versionRun.stdout.trim().split(/\s+/)[0] : undefined;
        if (observed !== undefined && parseVersionTriple(observed) !== null) currentPiVersion = observed;
      }
      piGuardResult = {
        status: inspected.value.status,
        installPath: inspected.value.installPath,
        sourcePath: inspected.value.sourcePath,
        artifactSha256: priorEntry?.artifactSha256 ?? null,
        digestVerified: priorEntry?.digestVerified ?? false,
        piVersion: currentPiVersion,
        verifiedBy: inspected.value.verifiedBy,
        piPreExisting: true,
        piMutated: false,
        created: false,
      };
      notes.push('pi-guard was already installed; re-verified, not modified by this attempt');
    }
  }

  const omitted: string[] = [];
  if (gatewayResult === undefined) omitted.push(gatewayIdentity.binName);
  if (piGuardResult === undefined) omitted.push('pi-guard');
  const notesForDigest: string[] = [];
  let allSelectedVerified = true;
  if (gatewayResult !== undefined && gatewayResult.status !== 'installed-verified') {
    allSelectedVerified = false;
    notes.push('gateway installed but not verified (bin smoke not run; dependency materialization is a release dependency)');
  }
  if (piGuardResult !== undefined && piGuardResult.status !== 'installed-verified') {
    allSelectedVerified = false;
    notes.push('pi-guard installed but not verified via pi list');
  }
  if (gatewayResult !== undefined && !gatewayResult.digestVerified) {
    notesForDigest.push('gateway artifact digest is locally observed, not verified against a release expectation');
  }
  if (piGuardResult !== undefined && !piGuardResult.digestVerified) {
    notesForDigest.push('pi-guard artifact digest is locally observed, not verified against a release expectation');
  }
  if (piGuardProbe !== undefined && piGuardResult !== undefined && piGuardResult.status === 'installed-verified') {
    notes.push(`pi ${piGuardResult.piVersion} is not the known-good baseline ${PI_COMPATIBILITY_BASELINE}; the pi-guard compatibility probe PASSED before the Pi-side mutation`);
  }
  notes.push(...notesForDigest);
  const result = omitted.length === 0 && allSelectedVerified ? 'COMPLETE' : 'PARTIAL';

  // Receipt — written LAST, only for finalized states.
  const gatewayEntry: GatewayReceiptEntry | null = gatewayResult === undefined ? null : gatewayReceiptEntryFromResult(gatewayDescriptor, gatewayResult);
  const piGuardEntry: PiGuardReceiptEntry | null = piGuardResult === undefined ? null : {
    status: piGuardResult.status,
    version: PI_GUARD_VERSION,
    commit: PI_GUARD_COMMIT,
    commitVerified: false,
    digestVerified: piGuardResult.digestVerified,
    artifactSha256: piGuardResult.artifactSha256,
    installPath: piGuardResult.installPath,
    sourcePath: piGuardResult.sourcePath,
    piVersion: piGuardResult.piVersion,
    verifiedBy: piGuardResult.verifiedBy,
  };
  const receipt = newReceipt({
    platformLane: lane,
    result,
    installDir: layout.shareDir,
    binDir: layout.binDir,
    gateway: gatewayEntry,
    piGuard: piGuardEntry,
    omitted,
    notes,
    ...(options.sourceIdentity !== undefined && installedShuttlePath !== undefined
      ? { piShuttleInstallPath: installedShuttlePath, piShuttleTreeSha256: installedShuttleTreeSha256 }
      : {}),
    ...(options.sourceIdentity !== undefined ? { channel: 'latest' as const, sourceIdentity: options.sourceIdentity } : {}),
  });
  // runInstallLocked still owns install.lock; receipt publication needs no
  // second sibling lock inside this one installation transaction.
  const written = writeReceipt(attempt.receiptPath, receipt);
  if (!written.ok) {
    const rollbackState = rollback(attempt);
    return { kind: 'FAILED', stage: 'receipt', rollback: rollbackState.message, message: written.message };
  }
  // Staging cleanup.
  removeStaging(attempt.stagingDir);

  if (result === 'COMPLETE') {
    return {
      kind: 'COMPLETE',
      ...(upgradeFrom !== undefined ? { upgradedFrom: upgradeFrom } : {}),
      ...(sourceTransition !== undefined ? { sourceTransition } : {}),
    };
  }
  return {
    kind: 'PARTIAL',
    omitted,
    notes,
    ...(upgradeFrom !== undefined ? { upgradedFrom: upgradeFrom } : {}),
    ...(sourceTransition !== undefined ? { sourceTransition } : {}),
  };
}
