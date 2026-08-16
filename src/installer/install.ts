/**
 * PS-3 install flow: preflight → install-wide lock → staging → acquire →
 * verify → activate (atomic no-clobber reservation) → bin link →
 * pi-guard (tracked external Pi mutation) → receipt → report. Result
 * taxonomy: COMPLETE / PARTIAL / FAILED (rolled back / partial rollback)
 * / UNSUPPORTED / REFUSED. The receipt is written LAST and ONLY for
 * finalized COMPLETE/PARTIAL states; failed attempts roll back this
 * attempt's own mutations and preserve any prior receipt.
 *
 * Concurrency (SIR-PS3-009): ONE attempt-spanning lock
 * (`<stateDir>/install.lock`, shared PS-2 O_EXCL semantics) is acquired
 * before the first installation mutation and held through staging,
 * component activation, the external Pi mutation, the bin link, the final
 * receipt, and rollback. Concurrent installers wait boundedly, then fail
 * closed with ERR-PS2-CONFIG-BUSY — a success whose receipt disagrees
 * with the final component state is impossible.
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
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, releaseLock } from '../persistence/lock.js';
import { gatewayDescriptorForLane, PI_COMPATIBILITY_BASELINE, PI_GUARD_COMMIT, PI_GUARD_VERSION, PI_SHUTTLE_VERSION } from '../compat/manifest.js';
import type { GatewayLaneDescriptor } from '../compat/manifest.js';
import { resolvePiLoaderFromBin } from '../compat/pi-guard-probe.js';
import type { HostEnvironment, LayoutPaths } from '../host/environment.js';
import { hostLane, resolveLayout } from '../host/environment.js';
import { applyPiPolicy, checkNodeLane, checkNotRoot, checkPlatformLane, checkTarPresent, classifyPiVersion, ensureWritableLayout, PI_RUNTIME_POLICY } from './preflight.js';
import { runProcess, resolveExecutable } from './process.js';
import { activatePackageRoot, componentDirName, extractArtifact, inspectExistingGateway, inspectExistingPiGuard, installGatewayComponent, installPiGuardComponent, removeStaging, validateBinPath, verifyIdentity, PI_GUARD_PACKAGE_NAME, PI_SHUTTLE_PACKAGE_NAME } from './components.js';
import type { ComponentResult, GatewayComponentIdentity, GatewayInstallResult, PiGuardInstallResult } from './components.js';
import { scanArtifactMembers } from './archive.js';
import { findPackageRoot, readPackageIdentity } from './artifact.js';
import { newReceipt, readReceipt, writeReceipt } from './receipt.js';
import type { GatewayReceiptEntry, InstallReceipt, PiGuardReceiptEntry } from './receipt.js';
import type { InstallerSelections } from './selection.js';

export type InstallOutcome =
  | { readonly kind: 'COMPLETE' }
  | { readonly kind: 'PARTIAL'; readonly omitted: readonly string[]; readonly notes: readonly string[] }
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
  /**
   * Injectable UID observation (SIR-PS3-007 root refusal). Defaults to
   * `process.getuid()` when absent; test-only seam, never hard-coded.
   */
  readonly uid?: number;
}

export interface InstallAttempt {
  readonly layout: LayoutPaths;
  readonly receiptPath: string;
  readonly stagingDir: string;
  /** Assigned during the locked run (release lane may retarget it). */
  binLinkTarget: string;
  binLinkCreated: boolean;
  gateway?: GatewayInstallResult;
  piGuard?: PiGuardInstallResult;
  /** External Pi-side state caused by THIS attempt (SIR-PS3-002). */
  piGuardPiState: 'none' | 'pre-existing' | 'attempt-installed';
  receipt?: InstallReceipt;
  /** Paths this attempt MAY create; removed on rollback only when they did not pre-exist. */
  readonly rollbackCandidates: Array<{ readonly path: string; readonly preExisting: boolean }>;
}

export interface RollbackReport {
  /** 'rolled-back' = every attempt-created mutation was removed. */
  readonly state: 'rolled-back' | 'partial';
  readonly message: string;
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
  const created: string[] = [];
  for (const candidate of attempt.rollbackCandidates) {
    if (!candidate.preExisting) created.push(candidate.path);
  }
  if (attempt.binLinkCreated) {
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

  // 4. Layout + attempt bookkeeping. The attempt-spanning lock (SIR-PS3-009)
  // is acquired BEFORE the first installation mutation and before any
  // state-dependent decision (receipt inspection, layout creation).
  const layout = layoutWithOverrides(env.home, options);
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
  const installLock = acquireLock(installLockPath);
  if (!installLock.ok) {
    return { kind: 'REFUSED', reason: installLock.message };
  }
  try {
    return await runInstallLocked(env, options, lane, gatewayDescriptor, gatewayIdentity, attempt);
  } finally {
    releaseLock(installLock.fd, installLockPath);
  }
}

/** The locked install body: all state decisions and mutations happen here. */
async function runInstallLocked(env: HostEnvironment, options: InstallOptions, lane: string, gatewayDescriptor: GatewayLaneDescriptor, gatewayIdentity: GatewayComponentIdentity, attempt: InstallAttempt): Promise<InstallOutcome> {
  const layout = attempt.layout;

  // Existing receipt state: foreign/incompatible receipts fail closed
  // before anything is created or mutated.
  const prior = readReceipt(attempt.receiptPath);
  if (!prior.ok && prior.code !== 'absent') {
    return { kind: 'REFUSED', reason: `existing installation receipt is foreign or invalid (${prior.message}); refusing to modify it` };
  }
  if (prior.ok && prior.receipt.piShuttleVersion !== PI_SHUTTLE_VERSION) {
    return { kind: 'REFUSED', reason: `existing receipt records pi-shuttle ${prior.receipt.piShuttleVersion}; this installer is ${PI_SHUTTLE_VERSION}; refusing to modify foreign installation state` };
  }

  // Component acquisition prerequisites (only when components are selected).
  const needsArtifacts = options.selections.gateway || options.selections.piGuard;
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
  const piExecutable = resolveExecutable('pi');
  let piVersion = '';
  let piGuardProbe: ((activatedPackageDir: string) => Promise<{ readonly ok: boolean; readonly detail: string }>) | undefined = undefined;
  if (options.selections.piGuard) {
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
  let binLinkTarget = ownCliPath();
  if (options.releasePackageTgz !== undefined) {
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
    const shuttleTarget = join(layout.packagesDir, componentDirName(PI_SHUTTLE_PACKAGE_NAME, PI_SHUTTLE_VERSION));
    attempt.rollbackCandidates.push({ path: shuttleTarget, preExisting: existsSync(shuttleTarget) });
    const verifyShuttle = (existingRoot: string): ComponentResult<unknown> => {
      const existing = readPackageIdentity(existingRoot);
      if (existing === null || existing.name !== PI_SHUTTLE_PACKAGE_NAME || existing.version !== PI_SHUTTLE_VERSION) {
        return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing pi-shuttle installation at ${existingRoot} has incompatible identity; refusing to touch it` };
      }
      return { ok: true, value: undefined };
    };
    const activated = activatePackageRoot(releaseRoot ?? releaseExtract.value, shuttleTarget, verifyShuttle);
    if (!activated.ok) {
      const rollbackState = rollback(attempt);
      return { kind: 'FAILED', stage: 'release-package', rollback: rollbackState.message, message: activated.message };
    }
    binLinkTarget = join(shuttleTarget, binCheck.value);
  }
  attempt.binLinkTarget = binLinkTarget;
  let gatewayResult: GatewayInstallResult | undefined;
  if (options.selections.gateway) {
    const gatewayTarget = join(layout.packagesDir, componentDirName(gatewayIdentity.packageName, gatewayDescriptor.version));
    attempt.rollbackCandidates.push({ path: gatewayTarget, preExisting: existsSync(gatewayTarget) });
    const gateway = await installGatewayComponent({
      context: { artifactDir, packagesDir: layout.packagesDir, stagingDir: attempt.stagingDir, nodeExecutable: process.execPath, expectedSha256: options.expectGatewaySha256, platform: env.platform, pathEnv: env.pathEnv },
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
    attempt.gateway = gateway.value;
  }

  // pi-shuttle bin link (local lane: link to the package this installer
  // runs from). Foreign existing entries fail closed. Ordered BEFORE the
  // external pi-guard mutation so one avoidable post-Pi failure point is
  // removed (SIR-PS3-002); receipt/finalization failure still requires
  // truthful residual handling.
  const binLink = join(layout.binDir, 'pi-shuttle');
  try {
    const existing = readlinkSync(binLink);
    if (existing !== attempt.binLinkTarget) {
      removeStaging(attempt.stagingDir);
      return { kind: 'REFUSED', reason: `${binLink} exists and points to ${existing}; refusing to replace a foreign pi-shuttle entry` };
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

  // pi-guard component (external Pi mutation tracked for rollback truthfulness).
  let piGuardResult: PiGuardInstallResult | undefined;
  if (options.selections.piGuard) {
    if (piExecutable === null) {
      const rollbackState = rollback(attempt);
      return { kind: 'REFUSED', reason: `pi executable is required for pi-guard installation but was not found on PATH (${rollbackState.message})` };
    }
    const piGuardTarget = join(layout.packagesDir, componentDirName(PI_GUARD_PACKAGE_NAME, PI_GUARD_VERSION));
    attempt.rollbackCandidates.push({ path: piGuardTarget, preExisting: existsSync(piGuardTarget) });
    const piGuard = await installPiGuardComponent({
      context: { artifactDir, packagesDir: layout.packagesDir, stagingDir: attempt.stagingDir, nodeExecutable: process.execPath, expectedSha256: options.expectPiGuardSha256, platform: env.platform, pathEnv: env.pathEnv },
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
    attempt.piGuard = piGuard.value;
    attempt.piGuardPiState = piGuard.value.piMutated ? 'attempt-installed' : piGuard.value.piPreExisting ? 'pre-existing' : 'none';
  }

  // Result classification (truthful COMPLETE/PARTIAL over the ACTUAL
  // final state, SIR-PS3-009): components the operator did not select but
  // that are already installed are re-verified (bounded, read-only) and
  // recorded — the receipt never disagrees with what is installed.
  const notes: string[] = [];
  if (gatewayResult === undefined && !options.selections.gateway) {
    const gatewayTarget = join(layout.packagesDir, componentDirName(gatewayIdentity.packageName, gatewayDescriptor.version));
    const inspected = await inspectExistingGateway(gatewayTarget, process.execPath, gatewayIdentity, gatewayDescriptor.version);
    if (!inspected.ok) return { kind: 'REFUSED', reason: inspected.message };
    if (inspected.value !== null) {
      const priorEntry = prior.ok ? prior.receipt.components.gateway : null;
      if (priorEntry === null) {
        return { kind: 'REFUSED', reason: `existing gateway installation at ${gatewayTarget} is not recorded in a valid prior receipt; refusing to treat it as pi-shuttle state` };
      }
      gatewayResult = {
        status: inspected.value.status,
        installPath: inspected.value.installPath,
        binPath: inspected.value.binPath,
        artifactSha256: priorEntry.artifactSha256,
        digestVerified: priorEntry.digestVerified,
        smoke: inspected.value.smoke,
        created: false,
      };
      notes.push('gateway was already installed; re-verified, not modified by this attempt');
    }
  }
  if (piGuardResult === undefined && !options.selections.piGuard) {
    const piGuardTarget = join(layout.packagesDir, componentDirName(PI_GUARD_PACKAGE_NAME, PI_GUARD_VERSION));
    const inspected = await inspectExistingPiGuard(piGuardTarget, piExecutable);
    if (!inspected.ok) return { kind: 'REFUSED', reason: inspected.message };
    if (inspected.value !== null) {
      const priorEntry = prior.ok ? prior.receipt.components.piGuard : null;
      if (priorEntry === null) {
        return { kind: 'REFUSED', reason: `existing pi-guard installation at ${piGuardTarget} is not recorded in a valid prior receipt; refusing to treat it as pi-shuttle state` };
      }
      piGuardResult = {
        status: inspected.value.status,
        installPath: inspected.value.installPath,
        sourcePath: inspected.value.sourcePath,
        artifactSha256: priorEntry.artifactSha256,
        digestVerified: priorEntry.digestVerified,
        piVersion: priorEntry.piVersion,
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
  });
  const written = writeReceipt(attempt.receiptPath, receipt);
  if (!written.ok) {
    const rollbackState = rollback(attempt);
    return { kind: 'FAILED', stage: 'receipt', rollback: rollbackState.message, message: written.message };
  }
  attempt.receipt = receipt;

  // Staging cleanup.
  removeStaging(attempt.stagingDir);

  if (result === 'COMPLETE') return { kind: 'COMPLETE' };
  return { kind: 'PARTIAL', omitted, notes };
}
