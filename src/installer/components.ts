/**
 * PS-3 component composition: exact-pinned Gateway and pi-guard
 * installation. Both components are installed into pi-shuttle-owned
 * package storage (`<shareDir>/packages/<name>@<version>/`) from
 * digest-verified local artifacts. No Gateway trusted-store bootstrap, no
 * project lifecycle, no long-running MCP service, no pi-guard source
 * import, no arbitrary newer versions.
 *
 * Extraction confinement (SIR-PS3-001): EVERY artifact is structurally
 * scanned before extraction (`src/installer/archive.ts`) — only regular
 * files and directories with safe relative names are accepted; symlinks,
 * hardlinks, FIFOs, devices, traversal, and absolute names are rejected
 * before tar ever runs.
 *
 * Activation is atomic no-clobber (SIR-PS3-010): the target directory is
 * RESERVED with `mkdirSync` (O_EXCL semantics) before the verified
 * extracted package root is renamed into it; a pre-existing target
 * (idempotent rerun) is identity-verified and reused; a pre-existing
 * target with wrong/absent identity fails closed. A foreign EMPTY
 * directory is refused, never silently replaced.
 *
 * The declared bin path is treated as untrusted artifact content
 * (SIR-PS3-003): it must be a relative, traversal-free path resolving
 * strictly inside the package root, and the resolved file must be a
 * regular file (lstat) before it is read or executed.
 */
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { artifactFilePath, findPackageRoot, hashFile, readPackageIdentity, verifyArtifactFile } from './artifact.js';
import type { ComponentArtifactSpec, PackageIdentity } from './artifact.js';
import { regularFileOrNull, scanArtifactMembers } from './archive.js';
import { runProcess } from './process.js';
import { stripQuarantineAttribute } from './quarantine.js';

export type ComponentResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

export interface ComponentInstallContext {
  readonly artifactDir: string;
  readonly packagesDir: string;
  readonly stagingDir: string;
  readonly nodeExecutable: string;
  readonly expectedSha256?: string;
  /** Host platform (PS-6 quarantine handling is darwin-only). */
  readonly platform: string;
  /** Executable-search environment for quarantine handling (test seam). */
  readonly pathEnv?: NodeJS.ProcessEnv;
}

/**
 * The on-disk component directory name: `<dir-safe-name>@<version>`, where
 * the npm scoped form (`@scope/name`) is flattened to the contract's
 * layout form (`scope-name`) — installation-contract §5.4:
 * `packages/project-gateway-artifact-core@0.1.0/`. Never contains `/`.
 */
export function componentDirName(name: string, version: string): string {
  const dirSafe = name.replace(/^@/, '').replace(/\//g, '-');
  return `${dirSafe}@${version}`;
}

/**
 * Bin-path confinement (SIR-PS3-003): the artifact's declared bin path is
 * untrusted content. Must be a non-empty relative path, free of `..`
 * traversal and empty/`.` components, resolving strictly inside the
 * package root.
 */
export function validateBinPath(binRelative: string, packageRoot: string): ComponentResult<string> {
  if (typeof binRelative !== 'string' || binRelative.length === 0) {
    return { ok: false, code: 'ERR-PS3-GATEWAY-BIN', message: 'gateway bin path must be a non-empty string' };
  }
  if (binRelative.startsWith('/')) {
    return { ok: false, code: 'ERR-PS3-GATEWAY-BIN', message: `gateway bin path must be relative: ${binRelative}` };
  }
  // The npm-pack convention declares bins as `./dist/cli.js`; a single
  // leading './' is normalized away. Interior `.` / `..` / empty
  // components remain rejected.
  const normalized = binRelative.startsWith('./') ? binRelative.slice(2) : binRelative;
  for (const component of normalized.split('/')) {
    if (component.length === 0 || component === '.' || component === '..') {
      return { ok: false, code: 'ERR-PS3-GATEWAY-BIN', message: `gateway bin path must not traverse or contain empty/dot components: ${binRelative}` };
    }
  }
  const resolved = resolve(packageRoot, normalized);
  const rootPrefix = `${resolve(packageRoot)}${sep}`;
  if (resolved !== resolve(packageRoot) && !resolved.startsWith(rootPrefix)) {
    return { ok: false, code: 'ERR-PS3-GATEWAY-BIN', message: `gateway bin path escapes the package root: ${binRelative}` };
  }
  return { ok: true, value: binRelative };
}

/** Extract a tarball into a fresh staging subdirectory; returns the staging subdir. */
export async function extractArtifact(artifactPath: string, stagingDir: string, label: string, tarExecutable: string): Promise<ComponentResult<string>> {
  // Structural pre-scan: the extraction policy is owned by pi-shuttle, not
  // by the external tar binary (SIR-PS3-001). Reject the archive BEFORE
  // any extraction when any member is unsafe or of an unsupported type.
  const scan = await scanArtifactMembers(artifactPath);
  if (!scan.ok) return scan;
  const extractDir = join(stagingDir, label);
  try {
    mkdirSync(extractDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { ok: false, code: 'ERR-PS3-STAGING', message: `staging directory could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  const result = await runProcess(tarExecutable, ['-xzf', artifactPath, '-C', extractDir]);
  if (result.exitCode !== 0 || result.signal !== null) {
    const reason = result.timedOut ? 'timed out' : result.signal !== null ? `killed by ${result.signal}` : `exit ${result.exitCode ?? 'unknown'}`;
    const detail = result.stderr.trim().slice(0, 300);
    return { ok: false, code: 'ERR-PS3-ARTIFACT-EXTRACT', message: `artifact extraction failed (${reason}): ${detail}` };
  }
  return { ok: true, value: extractDir };
}

/** Verify package identity against the exact pin. */
export function verifyIdentity(identity: PackageIdentity | null, expectedName: string, expectedVersion: string, label: string): ComponentResult<PackageIdentity> {
  if (identity === null) {
    return { ok: false, code: 'ERR-PS3-ARTIFACT-IDENTITY', message: `${label} artifact contains no readable package.json identity` };
  }
  if (identity.name !== expectedName || identity.version !== expectedVersion) {
    return {
      ok: false,
      code: 'ERR-PS3-ARTIFACT-IDENTITY',
      message: `${label} artifact identity mismatch: expected ${expectedName}@${expectedVersion}, found ${identity.name}@${identity.version}`,
    };
  }
  return { ok: true, value: identity };
}

/**
 * Activate an extracted package root into packages storage via atomic
 * no-clobber reservation (SIR-PS3-010):
 *   1. `mkdirSync(targetDir)` — atomic O_EXCL-style reservation; EEXIST →
 *      idempotent-verify path (existing identity must match exactly);
 *   2. lstat-verify the reservation is still an attempt-owned directory;
 *   3. `renameSync(packageRoot, targetDir)` — replaces only the empty
 *      directory THIS attempt reserved.
 * A pre-existing foreign EMPTY directory is refused (identity check),
 * never silently replaced. A crash after reservation leaves an empty
 * directory that the next attempt refuses (fail closed; documented).
 */
export function activatePackageRoot(packageRoot: string, targetDir: string, verifyExisting: (existingRoot: string) => ComponentResult<unknown>): ComponentResult<{ readonly created: boolean }> {
  let reserved = false;
  try {
    mkdirSync(targetDir, { mode: 0o700 });
    reserved = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'EISDIR') {
      // The version dir already exists: idempotent rerun path — verify the
      // existing state rather than overwriting it (foreign/empty dirs fail
      // closed here: an empty dir has no readable package.json identity).
      const existing = verifyExisting(targetDir);
      if (!existing.ok) return existing;
      return { ok: true, value: { created: false } };
    }
    return { ok: false, code: 'ERR-PS3-ACTIVATE', message: `component activation failed (${code ?? 'unknown error'})` };
  }
  try {
    // Verify the reservation is still this attempt's empty directory.
    let isDir = false;
    try {
      isDir = lstatSync(targetDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      cleanupReservation(targetDir);
      return { ok: false, code: 'ERR-PS3-ACTIVATE', message: 'component activation reservation was lost; refusing to proceed' };
    }
    renameSync(packageRoot, targetDir);
    return { ok: true, value: { created: true } };
  } catch (err) {
    cleanupReservation(targetDir);
    return { ok: false, code: 'ERR-PS3-ACTIVATE', message: `component activation failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
}

/** Remove a reservation directory this attempt created (best-effort; empty by construction). */
function cleanupReservation(targetDir: string): void {
  try {
    rmSync(targetDir, { recursive: false, force: true });
  } catch {
    // best-effort; the failure result stands
  }
}

// ─── Gateway component ────────────────────────────────────────────────────

export const GATEWAY_PACKAGE_NAME = '@project-gateway/artifact-core';
/** Real npm-pack artifact name (hyphen form; SIR-PS3-004). */
export const GATEWAY_ARTIFACT_FILE = 'project-gateway-artifact-core-0.1.0.tgz';

export interface GatewayInstallResult {
  readonly status: 'installed-verified' | 'installed-unverified';
  readonly installPath: string;
  readonly binPath: string;
  readonly artifactSha256: string;
  /** True only when the artifact digest matched an explicit expectation. */
  readonly digestVerified: boolean;
  readonly smoke: 'passed' | 'not-run';
  readonly created: boolean;
}

export interface GatewayInput {
  readonly context: ComponentInstallContext;
  readonly expectedVersion: string;
  readonly expectedCommit: string;
  readonly tarExecutable: string;
}

/**
 * Install the exact pinned Gateway artifact: digest verify → structural
 * scan → extract → identity verify (name/version) → bin confinement →
 * lstat-regular bin check → atomic no-clobber activation → bounded
 * `--help` smoke against the ACTIVATED bin. Never runs project bootstrap,
 * never starts a long-running MCP service.
 */
export async function installGatewayComponent(input: GatewayInput): Promise<ComponentResult<GatewayInstallResult>> {
  const spec: ComponentArtifactSpec = {
    name: GATEWAY_PACKAGE_NAME,
    version: input.expectedVersion,
    fileName: GATEWAY_ARTIFACT_FILE,
    expectedSha256: input.context.expectedSha256,
  };
  const artifact = await verifyArtifactFile(input.context.artifactDir, spec);
  if (!artifact.ok) return artifact;

  // PS-6 darwin quarantine handling (platform-support-contract §3.7):
  // AFTER SHA-256 verification, BEFORE extraction/activation. Absence of
  // the attribute is a normal no-quarantine condition; Linux is a no-op.
  const quarantine = await stripQuarantineAttribute(artifact.value.path, input.context.platform, input.context.pathEnv);
  if (!quarantine.ok) return quarantine;

  const extracted = await extractArtifact(artifact.value.path, input.context.stagingDir, 'gateway', input.tarExecutable);
  if (!extracted.ok) return extracted;
  const root = findPackageRoot(extracted.value);
  const identityResult = verifyIdentity(root === null ? null : readPackageIdentity(root), GATEWAY_PACKAGE_NAME, input.expectedVersion, 'gateway');
  if (!identityResult.ok) return identityResult;
  const identity = identityResult.value;

  // Bin surface: the package must declare a `project-gateway-mcp` bin; the
  // path is UNTRUSTED artifact content (SIR-PS3-003) and must resolve
  // strictly inside the package root to a regular file (lstat — never a
  // symlink/FIFO/device, never opened speculatively).
  const binRelativeRaw = identity.bin['project-gateway-mcp'];
  if (binRelativeRaw === undefined) {
    return { ok: false, code: 'ERR-PS3-GATEWAY-BIN', message: 'gateway artifact does not declare the project-gateway-mcp bin' };
  }
  const binCheck = validateBinPath(binRelativeRaw, root ?? extracted.value);
  if (!binCheck.ok) return binCheck;
  const binRelative = binCheck.value;
  const stagingBinPath = join(root ?? extracted.value, binRelative);
  if (!regularFileOrNull(stagingBinPath)) {
    return { ok: false, code: 'ERR-PS3-GATEWAY-BIN', message: `gateway bin file is missing or not a regular file: ${stagingBinPath}` };
  }

  const targetDir = join(input.context.packagesDir, componentDirName(GATEWAY_PACKAGE_NAME, input.expectedVersion));
  const verifyExisting = (existingRoot: string): ComponentResult<unknown> => {
    const existing = readPackageIdentity(existingRoot);
    if (existing === null || existing.name !== GATEWAY_PACKAGE_NAME || existing.version !== input.expectedVersion) {
      return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing gateway installation at ${existingRoot} has incompatible identity; refusing to touch it` };
    }
    return { ok: true, value: undefined };
  };
  const activated = activatePackageRoot(root ?? extracted.value, targetDir, verifyExisting);
  if (!activated.ok) return activated;

  // Bounded help smoke against the ACTIVATED bin path (10 s) — confined to
  // the package by the bin-path check above. A missing-dependencies
  // failure is classified as installed-unverified (dependency
  // materialization is a release dependency); any other failure fails the
  // component.
  const binPath = join(targetDir, binRelative);
  if (!regularFileOrNull(binPath)) {
    // Defense in depth: re-verify the activated bin before execution.
    return { ok: false, code: 'ERR-PS3-GATEWAY-BIN', message: `activated gateway bin is not a regular file: ${binPath}` };
  }
  const smoke = await runProcess(input.context.nodeExecutable, [binPath, '--help'], { timeoutMs: 10_000 });
  let status: 'installed-verified' | 'installed-unverified' = 'installed-verified';
  let smokeResult: 'passed' | 'not-run' = 'passed';
  if (smoke.exitCode !== 0 || smoke.signal !== null || smoke.timedOut) {
    const missingDeps = smoke.stderr.includes('Cannot find module') || smoke.stderr.includes('MODULE_NOT_FOUND') || smoke.stderr.includes('ERR_MODULE_NOT_FOUND');
    if (missingDeps) {
      status = 'installed-unverified';
      smokeResult = 'not-run';
    } else {
      return { ok: false, code: 'ERR-PS3-GATEWAY-SMOKE', message: `gateway bin smoke failed (exit ${smoke.exitCode ?? 'unknown'}): ${smoke.stderr.trim().slice(0, 300)}` };
    }
  }

  return {
    ok: true,
    value: {
      status,
      installPath: targetDir,
      binPath: join(targetDir, binRelative),
      artifactSha256: artifact.value.sha256,
      digestVerified: artifact.value.digestVerifiedAgainstExpectation,
      smoke: smokeResult,
      created: activated.value.created,
    },
  };
}

// ─── pi-guard component ───────────────────────────────────────────────────

export const PI_GUARD_PACKAGE_NAME = 'pi-guard';
/** Real npm-pack artifact name (hyphen form; SIR-PS3-004). */
export const PI_GUARD_ARTIFACT_FILE = 'pi-guard-0.1.2.tgz';

export interface PiGuardInstallResult {
  readonly status: 'installed-verified' | 'installed-unverified';
  readonly installPath: string;
  readonly sourcePath: string;
  readonly artifactSha256: string;
  /** True only when the artifact digest matched an explicit expectation. */
  readonly digestVerified: boolean;
  readonly piVersion: string;
  readonly verifiedBy: 'pi-list' | 'unverified';
  /** True when the exact pinned source was already installed in Pi before this attempt. */
  readonly piPreExisting: boolean;
  /** True when this attempt performed an external `pi install` mutation. */
  readonly piMutated: boolean;
  readonly created: boolean;
}

export interface PiGuardInput {
  readonly context: ComponentInstallContext;
  readonly expectedVersion: string;
  readonly expectedCommit: string;
  readonly piExecutable: string;
  readonly piVersion: string;
  readonly tarExecutable: string;
  /**
   * PS-6R: required only for pi versions that are not the known-good
   * baseline (candidates >= 0.83.0). Runs against the ACTIVATED package
   * dir BEFORE any `pi install` mutation; a failed probe fails closed
   * with no Pi-side mutation.
   */
  readonly compatibilityProbe?: (activatedPackageDir: string) => Promise<{ readonly ok: boolean; readonly detail: string }>;
}

/**
 * Exact pi-list verification (SIR-PS3-008): the pinned source
 * (`<shareDir>/packages/pi-guard@0.1.2`) must appear as an exact
 * line/entry in the bounded `pi list` output. Loose name substrings are
 * NEVER accepted — `pi-guard-extra`, another version, or a path merely
 * containing `pi-guard` cannot satisfy verification.
 */
export function piListConfirmsSource(listOutput: string, source: string): boolean {
  const lines = listOutput.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Real `pi list` prints the source spec and the resolved path on
    // separate indented lines; the resolved path of a directory source is
    // the source itself. Only an EXACT line match on the pinned source is
    // accepted — never a loose name substring (SIR-PS3-008).
    if (trimmed === source) return true;
  }
  return false;
}

/**
 * Install the exact pinned pi-guard artifact through Pi's supported
 * package mechanism (`pi install <source>`, local pinned artifact path).
 * The Pi-side mutation is tracked truthfully (SIR-PS3-002): a read-only
 * `pi list` inspection BEFORE the install records whether the exact
 * source is pre-existing; the result reports whether THIS attempt
 * performed an external mutation, so rollback/finalization can never
 * claim full rollback while an attempt-created Pi install remains.
 */
export async function installPiGuardComponent(input: PiGuardInput): Promise<ComponentResult<PiGuardInstallResult>> {
  const spec: ComponentArtifactSpec = {
    name: PI_GUARD_PACKAGE_NAME,
    version: input.expectedVersion,
    fileName: PI_GUARD_ARTIFACT_FILE,
    expectedSha256: input.context.expectedSha256,
  };
  const artifact = await verifyArtifactFile(input.context.artifactDir, spec);
  if (!artifact.ok) return artifact;

  // PS-6 darwin quarantine handling (platform-support-contract §3.7):
  // AFTER SHA-256 verification, BEFORE extraction/activation. Absence of
  // the attribute is a normal no-quarantine condition; Linux is a no-op.
  const quarantine = await stripQuarantineAttribute(artifact.value.path, input.context.platform, input.context.pathEnv);
  if (!quarantine.ok) return quarantine;

  const extracted = await extractArtifact(artifact.value.path, input.context.stagingDir, 'piguard', input.tarExecutable);
  if (!extracted.ok) return extracted;
  const root = findPackageRoot(extracted.value);
  const identityResult = verifyIdentity(root === null ? null : readPackageIdentity(root), PI_GUARD_PACKAGE_NAME, input.expectedVersion, 'pi-guard');
  if (!identityResult.ok) return identityResult;

  const targetDir = join(input.context.packagesDir, componentDirName(PI_GUARD_PACKAGE_NAME, input.expectedVersion));
  const verifyExisting = (existingRoot: string): ComponentResult<unknown> => {
    const existing = readPackageIdentity(existingRoot);
    if (existing === null || existing.name !== PI_GUARD_PACKAGE_NAME || existing.version !== input.expectedVersion) {
      return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing pi-guard installation at ${existingRoot} has incompatible identity; refusing to touch it` };
    }
    return { ok: true, value: undefined };
  };
  const activated = activatePackageRoot(root ?? extracted.value, targetDir, verifyExisting);
  if (!activated.ok) return activated;

  // PS-6R: a candidate pi version (not the known-good 0.83.0 baseline)
  // must PASS the committed pi-guard compatibility probe BEFORE any
  // external `pi install` mutation — a failed probe fails closed with no
  // Pi-side change (the activated package dir remains rollback-tracked).
  if (input.compatibilityProbe !== undefined) {
    const probe = await input.compatibilityProbe(targetDir);
    if (!probe.ok) {
      return {
        ok: false,
        code: 'ERR-PS3-PIGUARD-PROBE',
        message: `pi ${input.piVersion} is not the known-good baseline and the pi-guard compatibility probe FAILED: ${probe.detail}`,
      };
    }
  }

  // Read-only pre-inspection: is the exact pinned source already present
  // in Pi's package store? (SIR-PS3-002/008)
  const preList = await runProcess(input.piExecutable, ['list'], { timeoutMs: 30_000 });
  const preExisting = preList.exitCode === 0 && piListConfirmsSource(preList.stdout, targetDir);

  let piMutated = false;
  if (!preExisting) {
    // Supported Pi mechanism: `pi install <source>` (external mutation —
    // outside pi-shuttle staging; tracked for rollback truthfulness).
    const installRun = await runProcess(input.piExecutable, ['install', targetDir], { timeoutMs: 60_000 });
    if (installRun.exitCode !== 0 || installRun.signal !== null) {
      return {
        ok: false,
        code: 'ERR-PS3-PIGUARD-INSTALL',
        message: `pi install failed (exit ${installRun.exitCode ?? 'unknown'}): ${installRun.stderr.trim().slice(0, 300) || installRun.stdout.trim().slice(0, 300)}`,
      };
    }
    piMutated = true;
  }

  // Post-verification through the exact-source check.
  const listRun = await runProcess(input.piExecutable, ['list'], { timeoutMs: 30_000 });
  const confirmed = listRun.exitCode === 0 && piListConfirmsSource(listRun.stdout, targetDir);
  return {
    ok: true,
    value: {
      status: confirmed ? 'installed-verified' : 'installed-unverified',
      installPath: targetDir,
      sourcePath: targetDir,
      artifactSha256: artifact.value.sha256,
      digestVerified: artifact.value.digestVerifiedAgainstExpectation,
      piVersion: input.piVersion,
      verifiedBy: confirmed ? 'pi-list' : 'unverified',
      piPreExisting: preExisting,
      piMutated,
      created: activated.value.created,
    },
  };
}

/** Remove a staging directory (installer-owned temporary state only). */
export function removeStaging(stagingDir: string): void {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // best-effort; the failure result stands elsewhere
  }
}

// ─── actual-state inspection (receipt reconciliation; SIR-PS3-009) ──────

/**
 * Inspect an EXISTING gateway installation without modifying it: identity
 * (name/version), bin-path confinement, and a bounded `--help` smoke
 * against the activated bin. Used when the operator did not select the
 * gateway so the receipt still describes the ACTUAL final component state.
 * Returns null when the target is absent; fails closed with
 * ERR-PS3-EXISTING-FOREIGN when the target exists with incompatible
 * identity.
 */
export async function inspectExistingGateway(targetDir: string, nodeExecutable: string): Promise<ComponentResult<{ readonly present: true; readonly status: 'installed-verified' | 'installed-unverified'; readonly installPath: string; readonly binPath: string; readonly smoke: 'passed' | 'not-run' } | null>> {
  const identity = readPackageIdentity(targetDir);
  if (identity === null) {
    if (existsSync(targetDir)) {
      return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing gateway installation at ${targetDir} has incompatible identity; refusing to touch it` };
    }
    return { ok: true, value: null };
  }
  const binRaw = identity.bin['project-gateway-mcp'];
  if (binRaw === undefined) {
    return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing gateway installation at ${targetDir} does not declare the project-gateway-mcp bin; refusing to touch it` };
  }
  const binCheck = validateBinPath(binRaw, targetDir);
  if (!binCheck.ok) return binCheck;
  const binPath = join(targetDir, binCheck.value);
  if (!regularFileOrNull(binPath)) {
    return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing gateway bin is not a regular file: ${binPath}` };
  }
  const smoke = await runProcess(nodeExecutable, [binPath, '--help'], { timeoutMs: 10_000 });
  let status: 'installed-verified' | 'installed-unverified' = 'installed-verified';
  let smokeResult: 'passed' | 'not-run' = 'passed';
  if (smoke.exitCode !== 0 || smoke.signal !== null || smoke.timedOut) {
    const missingDeps = smoke.stderr.includes('Cannot find module') || smoke.stderr.includes('MODULE_NOT_FOUND') || smoke.stderr.includes('ERR_MODULE_NOT_FOUND');
    if (missingDeps) {
      status = 'installed-unverified';
      smokeResult = 'not-run';
    } else {
      return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing gateway bin smoke failed (exit ${smoke.exitCode ?? 'unknown'}); refusing to treat it as an installation` };
    }
  }
  return {
    ok: true,
    value: { present: true, status, installPath: targetDir, binPath, smoke: smokeResult },
  };
}

/**
 * Inspect an EXISTING pi-guard installation without modifying it: identity
 * (name/version) plus the exact `pi list` source check. Returns null when
 * the target is absent; fails closed on incompatible identity.
 */
export async function inspectExistingPiGuard(targetDir: string, piExecutable: string | null): Promise<ComponentResult<{ readonly present: true; readonly status: 'installed-verified' | 'installed-unverified'; readonly installPath: string; readonly sourcePath: string; readonly verifiedBy: 'pi-list' | 'unverified' } | null>> {
  const identity = readPackageIdentity(targetDir);
  if (identity === null) {
    if (existsSync(targetDir)) {
      return { ok: false, code: 'ERR-PS3-EXISTING-FOREIGN', message: `existing pi-guard installation at ${targetDir} has incompatible identity; refusing to touch it` };
    }
    return { ok: true, value: null };
  }
  if (piExecutable === null) {
    return {
      ok: true,
      value: { present: true, status: 'installed-unverified', installPath: targetDir, sourcePath: targetDir, verifiedBy: 'unverified' },
    };
  }
  const listRun = await runProcess(piExecutable, ['list'], { timeoutMs: 30_000 });
  const confirmed = listRun.exitCode === 0 && piListConfirmsSource(listRun.stdout, targetDir);
  return {
    ok: true,
    value: {
      present: true,
      status: confirmed ? 'installed-verified' : 'installed-unverified',
      installPath: targetDir,
      sourcePath: targetDir,
      verifiedBy: confirmed ? 'pi-list' : 'unverified',
    },
  };
}

/** Recompute the digest of an installed artifact copy (not used in PS-3; kept for the release lane). */
export async function artifactSha256Of(artifactPath: string): Promise<string> {
  return hashFile(artifactPath);
}
