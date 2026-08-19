/**
 * Current pi-shuttle distribution package installation + canonical launcher
 * exposure (bootstrap installer activation correction).
 *
 * ROOT CAUSE CORRECTED: the v0.1.3 public installer (`curl ... | bash`)
 * ran the manifest-native Gateway fresh-install orchestrator, which
 * installed ONLY the signed Gateway release into the manifest-native
 * layout. It never persisted the CURRENT pi-shuttle distribution package
 * (the same verified artifact that ran the installer) and never re-exposed
 * `~/.local/bin/pi-shuttle` — so a pre-existing previous-generation
 * launcher stayed authoritative and pi-shuttle itself silently remained on
 * the old generation.
 *
 * This module owns the corrected activation contract:
 *
 *   verified distribution (bootstrap handoff)
 *     -> persisted current pi-shuttle package, content-addressed and
 *        version-bound, under the installer-owned namespace
 *        `~/.local/share/pi-shuttle/distributions/sha256/<treeSha256>/`
 *     -> validated BEFORE any exposure: expected package identity
 *        (pi-shuttle), expected distribution version (the running
 *        installer's own package.json version unless the handoff pins it),
 *        expected CLI/bin target (the declared `pi-shuttle` bin resolving
 *        strictly inside the package root), owner-private modes, and the
 *        mandatory content-address tree rehash
 *     -> canonical launcher exposure LAST (`~/.local/bin/pi-shuttle`),
 *        atomically (temp symlink + rename), only after the full
 *        manifest-native install transaction has completed.
 *
 * The distribution namespace is deliberately OUTSIDE the manifest-native
 * authority root (the manifest-native state classifier bounds its own
 * authority root to receipt/manifests/packages). This package is
 * pi-shuttle's OWN current distribution, never a Gateway release, and it is
 * never the manifest-native runtime authority — the Gateway always resolves
 * through Receipt Schema 1.
 *
 * Zero previous-generation knowledge: this module never reads the
 * previous-generation install.json, never classifies, parses, or migrates
 * any previous-generation installation, and never inspects the semantic
 * contents of a pre-existing launcher target (an existing symlink is
 * replaced atomically without reading its target; a non-symlink entry is
 * refused, never clobbered).
 *
 * Fail-closed guarantees:
 *   - a malformed/foreign distribution handoff is refused before any
 *     mutation;
 *   - a package failing identity/version/bin/content validation is never
 *     activated and never exposed;
 *   - the launcher is never switched to an unvalidated or incomplete
 *     target;
 *   - no caller-selected executable authority: the only launcher target is
 *     the validated bin inside the content-addressed distribution package.
 */
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLayout } from '../host/environment.js';
import { isStrictDescendant } from '../manifest-native/paths.js';
import { findPackageRoot, hashPackageTree, PACKAGE_TREE_MAX_ENTRIES, readPackageIdentity } from './artifact.js';
import { extractArtifact, PI_SHUTTLE_PACKAGE_NAME, validateBinPath } from './components.js';
import { readJsonFileIfRegular } from './archive.js';

/** The installer-owned current pi-shuttle distribution namespace (outside the manifest-native authority root). */
export interface DistributionLayout {
  readonly distributionRoot: string; // ~/.local/share/pi-shuttle/distributions
  readonly distributionsSha256Root: string; // ~/.local/share/pi-shuttle/distributions/sha256
  readonly binDir: string; // ~/.local/bin (CLI entry)
  readonly launcherPath: string; // ~/.local/bin/pi-shuttle
}

/** Derive the distribution layout from the canonical operator home (pure policy). */
export function resolveDistributionLayout(home: string): DistributionLayout {
  const layout = resolveLayout(home);
  return {
    distributionRoot: join(layout.shareDir, 'distributions'),
    distributionsSha256Root: join(layout.shareDir, 'distributions', 'sha256'),
    binDir: layout.binDir,
    launcherPath: join(layout.binDir, PI_SHUTTLE_PACKAGE_NAME),
  };
}

/** Verified current pi-shuttle distribution package handoff (install.sh bootstrap). */
export interface DistributionHandoff {
  /** `mfx-labs/pi-shuttle@<full-sha>` — the verified bootstrap source identity. */
  readonly sourceIdentity: string;
  /** Absolute path to the verified current pi-shuttle distribution package tgz. */
  readonly packageTgz: string;
  /**
   * Expected current pi-shuttle distribution version. Production derives it
   * from the running installer's own package.json; tests pin it explicitly.
   */
  readonly expectedVersion?: string;
}

/**
 * Parse the install.sh bootstrap handoff environment. Fail closed: the
 * handoff is REQUIRED for a successful production install (a successful
 * installer run must leave both the manifest-native Gateway installation
 * AND the current pi-shuttle distribution package installed/exposed).
 */
export function parseDistributionHandoff(env: NodeJS.ProcessEnv): { readonly ok: true; readonly value: DistributionHandoff } | { readonly ok: false; readonly message: string } {
  const sourceIdentity = env.PI_SHUTTLE_LATEST_SOURCE;
  const packageTgz = env.PI_SHUTTLE_LATEST_PACKAGE_TGZ;
  if (sourceIdentity === undefined || sourceIdentity.length === 0) {
    return { ok: false, message: 'the current pi-shuttle distribution handoff is missing its verified source identity (PI_SHUTTLE_LATEST_SOURCE)' };
  }
  if (!/^mfx-labs\/pi-shuttle@[0-9a-f]{40}$/.test(sourceIdentity)) {
    return { ok: false, message: 'the current pi-shuttle distribution handoff source identity is not a valid full commit identity' };
  }
  if (packageTgz === undefined || packageTgz.length === 0) {
    return { ok: false, message: 'the current pi-shuttle distribution handoff is missing its verified pi-shuttle package (PI_SHUTTLE_LATEST_PACKAGE_TGZ)' };
  }
  if (!isAbsolute(packageTgz)) {
    return { ok: false, message: 'the current pi-shuttle distribution handoff package path must be absolute' };
  }
  return { ok: true, value: { sourceIdentity, packageTgz } };
}

/** The running installer's own package version (the expected distribution version in production). */
function readOwnDistributionVersion(): { readonly ok: true; readonly version: string } | { readonly ok: false; readonly message: string } {
  let ownPath: string;
  try {
    ownPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  } catch {
    return { ok: false, message: 'the installer own package.json path could not be derived' };
  }
  const text = readJsonFileIfRegular(ownPath);
  if (text === null) return { ok: false, message: 'the installer own package.json could not be read (expected a regular file)' };
  try {
    const raw = JSON.parse(text) as { readonly version?: unknown };
    if (typeof raw.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(raw.version)) {
      return { ok: false, message: 'the installer own package.json exposes no valid version' };
    }
    return { ok: true, version: raw.version };
  } catch {
    return { ok: false, message: 'the installer own package.json is malformed' };
  }
}

/** Normalize an extracted distribution tree: dirs 0700, files 0600, bin 0700. */
function normalizeDistributionModes(root: string, binPath: string, maxEntries: number): void {
  let count = 0;
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`unsupported distribution package entry type at ${path}`);
      }
      count += 1;
      if (count > maxEntries) throw new Error('distribution package tree exceeds the entry ceiling during normalization');
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
  // The CLI bin is the DIRECT launcher target: it must stay owner-executable.
  chmodSync(binPath, 0o700);
}

/**
 * Point-of-use durability barrier for the accepted current pi-shuttle
 * distribution package (same class as the manifest-native FI-01 barrier):
 * every regular file is lstat-inspected, opened O_NOFOLLOW, fstat'd to
 * bind the exact inode (type/owner/mode), then fsynced; every directory is
 * opened and fsynced with exact 0700 verification. Symlink/path
 * substitution fails closed BEFORE the substituted object is fsynced.
 */
function distributionDurabilityBarrier(root: string, uid: number, maxEntries: number): void {
  let count = 0;
  const walk = (dir: string): void => {
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      throw new Error(`unsupported distribution package entry type at ${dir}`);
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
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`unsupported distribution package entry type at ${path}`);
      }
      count += 1;
      if (count > maxEntries) throw new Error('distribution package tree exceeds the entry ceiling during durability walk');
      if (stat.isDirectory()) {
        walk(path);
      } else {
        const flags = constants.O_RDONLY | (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);
        const fd = openSync(path, flags);
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile()) throw new Error(`entry is no longer a regular file: ${path}`);
          if (opened.dev !== stat.dev || opened.ino !== stat.ino) {
            throw new Error(`file was replaced between inspection and durability sync; refusing to fsync a substituted object: ${path}`);
          }
          if (opened.uid !== uid) throw new Error(`file is not owned by the effective user: ${path}`);
          if ((opened.mode & 0o077) !== 0) {
            throw new Error(`file exposes group/world permission bits (mode ${(opened.mode & 0o777).toString(8).padStart(4, '0')}): ${path}`);
          }
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
    }
  };
  walk(root);
}

/** fsync one parent directory (content-address parents). */
function fsyncDistributionParent(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Full revalidation of an existing content-addressed distribution target (reuse gate). */
async function validateDistributionTarget(
  target: string,
  expectedVersion: string,
  expectedTreeSha256: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string }> {
  const identity = readPackageIdentity(target);
  if (identity === null || identity.name !== PI_SHUTTLE_PACKAGE_NAME || identity.version !== expectedVersion) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `existing current pi-shuttle distribution at ${target} has incompatible identity; refusing to touch it` };
  }
  const tree = await hashPackageTree(target, {}, { requireOwnerPrivateModes: true });
  if (!tree.ok || tree.value !== expectedTreeSha256) {
    return {
      ok: false,
      code: 'ERR-MN-INSTALL-DISTRIBUTION',
      message: `existing content-addressed distribution at ${target} does not match its content address (${tree.ok ? tree.value : tree.message}); refusing to overwrite`,
    };
  }
  return { ok: true };
}

/**
 * Materialize the normalized staging package at its content-address target
 * via atomic no-clobber reservation (mkdirSync O_EXCL-style, then rename).
 * A pre-existing target is identity + content revalidated and reused (never
 * overwritten); a foreign/empty target fails closed.
 */
async function materializeDistributionPackage(
  root: string,
  finalTarget: string,
  expectedVersion: string,
  expectedTreeSha256: string,
  layout: DistributionLayout,
): Promise<{ readonly ok: true; readonly created: boolean } | { readonly ok: false; readonly code: string; readonly message: string }> {
  try {
    const stat = lstatSync(finalTarget);
    if (!stat.isDirectory()) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `existing distribution target at ${finalTarget} is not an owned package directory; refusing to touch it` };
    }
    const reuse = await validateDistributionTarget(finalTarget, expectedVersion, expectedTreeSha256);
    if (!reuse.ok) return reuse;
    return { ok: true, created: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `existing distribution target at ${finalTarget} could not be inspected` };
    }
  }
  try {
    mkdirSync(layout.distributionRoot, { recursive: true, mode: 0o700 });
    mkdirSync(layout.distributionsSha256Root, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `distribution namespace could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  let reserved = false;
  try {
    mkdirSync(finalTarget, { mode: 0o700 });
    reserved = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EISDIR') {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `distribution reservation failed (${code ?? 'unknown error'}): ${finalTarget}` };
    }
  }
  if (reserved) {
    try {
      renameSync(root, finalTarget);
      return { ok: true, created: true };
    } catch (err) {
      try {
        rmSync(finalTarget, { recursive: false, force: true });
      } catch {
        // best-effort; the failure result stands
      }
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `distribution activation failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
    }
  }
  // A target appeared between the pre-check and the reservation (crash
  // leftover under the cooperative install lock): full revalidation.
  const raced = await validateDistributionTarget(finalTarget, expectedVersion, expectedTreeSha256);
  if (!raced.ok) return raced;
  return { ok: true, created: false };
}

export interface CurrentDistributionInstallDeps {
  readonly home: string;
  readonly uid: number;
  readonly tarExecutable: string;
  readonly stagingDir: string;
  readonly handoff: DistributionHandoff;
}

export type DistributionInstallResult =
  | { readonly ok: true; readonly packageRoot: string; readonly binPath: string; readonly treeSha256: string; readonly expectedVersion: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Persist + validate the current pi-shuttle distribution package. The
 * launcher is NOT touched here: exposure is a separate step that the
 * orchestrator calls LAST, after the full manifest-native transaction.
 */
export async function installCurrentDistribution(deps: CurrentDistributionInstallDeps): Promise<DistributionInstallResult> {
  const layout = resolveDistributionLayout(deps.home);
  let expectedVersion: string | null;
  if (deps.handoff.expectedVersion !== undefined) {
    expectedVersion = /^[0-9]+\.[0-9]+\.[0-9]+$/.test(deps.handoff.expectedVersion) ? deps.handoff.expectedVersion : null;
  } else {
    const own = readOwnDistributionVersion();
    expectedVersion = own.ok ? own.version : null;
  }
  if (expectedVersion === null) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: 'the expected current pi-shuttle distribution version could not be established' };
  }

  const extracted = await extractArtifact(deps.handoff.packageTgz, deps.stagingDir, 'pi-shuttle', deps.tarExecutable);
  if (!extracted.ok) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution could not be extracted: ${extracted.message}` };
  }
  const extractDir = extracted.value;
  try {
    const root = findPackageRoot(extractDir);
    if (root === null) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: 'current pi-shuttle distribution contains no readable package.json root' };
    }
    const identity = readPackageIdentity(root);
    if (identity === null) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: 'current pi-shuttle distribution identity could not be read' };
    }
    if (identity.name !== PI_SHUTTLE_PACKAGE_NAME) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution identity ${identity.name} is not ${PI_SHUTTLE_PACKAGE_NAME}` };
    }
    if (identity.version !== expectedVersion) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution version ${identity.version} does not match the expected distribution version ${expectedVersion}` };
    }
    const binRaw = identity.bin[PI_SHUTTLE_PACKAGE_NAME];
    if (typeof binRaw !== 'string') {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution does not declare the ${PI_SHUTTLE_PACKAGE_NAME} bin` };
    }
    const binCheck = validateBinPath(binRaw, root);
    if (!binCheck.ok) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution bin cannot be a canonical in-package path: ${binRaw}` };
    }
    const binRelative = binCheck.value;
    const stagedBin = join(root, binRelative);

    try {
      normalizeDistributionModes(root, stagedBin, PACKAGE_TREE_MAX_ENTRIES);
    } catch (err) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution normalization failed (${(err as Error).message || 'unknown error'})` };
    }

    const stagedTree = await hashPackageTree(root, {}, { requireOwnerPrivateModes: true });
    if (!stagedTree.ok) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution failed tree verification: ${stagedTree.message}` };
    }
    const treeSha256 = stagedTree.value;

    try {
      const binStat = lstatSync(stagedBin);
      if (binStat.isSymbolicLink() || !binStat.isFile()) {
        return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution bin is not a regular file: ${stagedBin}` };
      }
    } catch (err) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution bin could not be inspected (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${stagedBin}` };
    }

    const finalTarget = join(layout.distributionsSha256Root, treeSha256);
    const materialized = await materializeDistributionPackage(root, finalTarget, expectedVersion, treeSha256, layout);
    if (!materialized.ok) return materialized;

    // Unified acceptance: durability barrier then mandatory final rehash
    // against the content address, whether created or reused.
    try {
      distributionDurabilityBarrier(finalTarget, deps.uid, PACKAGE_TREE_MAX_ENTRIES);
      fsyncDistributionParent(dirname(finalTarget));
      fsyncDistributionParent(dirname(dirname(finalTarget)));
    } catch (err) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `current pi-shuttle distribution durability barriers failed (${(err as Error).message || 'unknown error'}); the package is preserved — no recovery is attempted` };
    }
    const finalTree = await hashPackageTree(finalTarget, {}, { requireOwnerPrivateModes: true });
    if (!finalTree.ok || finalTree.value !== treeSha256) {
      return {
        ok: false,
        code: 'ERR-MN-INSTALL-DISTRIBUTION',
        message: `installed current pi-shuttle distribution did not match its content address (${finalTree.ok ? finalTree.value : finalTree.message})`,
      };
    }

    return {
      ok: true,
      packageRoot: finalTarget,
      binPath: join(finalTarget, binRelative),
      treeSha256,
      expectedVersion,
    };
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // best-effort; the result stands
    }
  }
}

export interface CurrentDistributionLauncherDeps {
  readonly home: string;
  readonly packageRoot: string;
  readonly binPath: string;
  /**
   * Launcher parent-directory durability seam (tests only; production
   * defaults to the real fsync). Injection cannot forge any identity or
   * structural validation, which always uses the real filesystem.
   */
  readonly fsyncParentDirectory?: (path: string) => void;
}

export type DistributionLauncherResult = { readonly ok: true; readonly launcherPath: string; readonly changed: boolean } | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Expose the canonical launcher `~/.local/bin/pi-shuttle` to the validated
 * bin inside the installed current distribution package. Called LAST by the
 * orchestrator, after the manifest-native transaction; a failed exposure
 * must never leave a partially written launcher target.
 *
 * Existing launcher handling (contents are never inspected):
 *   - absent -> create symlink;
 *   - symlink to the exact target -> no-op (idempotent rerun);
 *   - symlink to anything else -> atomic replace (temp symlink + rename);
 *   - non-symlink entry -> REFUSED, never clobbered.
 */
export function exposeCurrentDistributionLauncher(deps: CurrentDistributionLauncherDeps): DistributionLauncherResult {
  const layout = resolveDistributionLayout(deps.home);
  const launcherPath = layout.launcherPath;
  if (!isStrictDescendant(deps.packageRoot, deps.binPath)) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `launcher target ${deps.binPath} escapes the installed package root ${deps.packageRoot}` };
  }
  try {
    const binStat = lstatSync(deps.binPath);
    if (binStat.isSymbolicLink() || !binStat.isFile()) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `launcher target is not a regular file: ${deps.binPath}` };
    }
  } catch (err) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `launcher target could not be inspected (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${deps.binPath}` };
  }
  try {
    mkdirSync(layout.binDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `launcher directory could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${layout.binDir}` };
  }

  let state: 'absent' | 'symlink' | 'foreign';
  try {
    const stat = lstatSync(launcherPath);
    state = stat.isSymbolicLink() ? 'symlink' : 'foreign';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') state = 'absent';
    else return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `launcher entry could not be inspected (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${launcherPath}` };
  }

  if (state === 'foreign') {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `${launcherPath} exists and is not a symbolic link; refusing to replace a foreign entry` };
  }
  if (state === 'symlink') {
    let current: string;
    try {
      current = readlinkSync(launcherPath);
    } catch (err) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `launcher entry could not be read (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${launcherPath}` };
    }
    if (current === deps.binPath) {
      return { ok: true, launcherPath, changed: false };
    }
    // Atomic replacement: a temp symlink in the same directory renamed over
    // the existing launcher entry (replaces the link, never its target).
    const temporary = join(layout.binDir, `.pi-shuttle-dist-link-${process.pid}-${Date.now()}`);
    try {
      symlinkSync(deps.binPath, temporary);
      renameSync(temporary, launcherPath);
    } catch (err) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `canonical launcher replacement failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${launcherPath}` };
    } finally {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // best-effort; the result stands
      }
    }
  } else {
    try {
      symlinkSync(deps.binPath, launcherPath);
    } catch (err) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `canonical launcher creation failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${launcherPath}` };
    }
  }
  // Durability barrier: the launcher directory must be durable before the
  // exposure is accepted. A failed barrier is FAIL-CLOSED — the launcher
  // must never be reported live unless its parent directory is durable.
  try {
    const fsyncParent = deps.fsyncParentDirectory ?? fsyncDistributionParent;
    fsyncParent(layout.binDir);
  } catch (err) {
    return {
      ok: false,
      code: 'ERR-MN-INSTALL-DISTRIBUTION',
      message: `canonical launcher durability barrier failed (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${layout.binDir}`,
    };
  }
  // Final verification: the launcher is a symlink pointing exactly at the
  // validated bin inside the installed distribution package.
  try {
    const stat = lstatSync(launcherPath);
    if (!stat.isSymbolicLink()) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `canonical launcher final verification failed: ${launcherPath}` };
    }
    const finalTarget = readlinkSync(launcherPath);
    if (finalTarget !== deps.binPath || !isStrictDescendant(deps.packageRoot, finalTarget)) {
      return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `canonical launcher final verification failed: ${launcherPath}` };
    }
  } catch (err) {
    return { ok: false, code: 'ERR-MN-INSTALL-DISTRIBUTION', message: `canonical launcher could not be verified (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}): ${launcherPath}` };
  }
  return { ok: true, launcherPath, changed: true };
}
