/**
 * PS-4 — shared operator lifecycle facts: the operator context, the
 * installation-receipt gate, and the operation-wide project-state lock.
 *
 * RECEIPT GATE (gate §4): operational commands NEVER infer installation
 * success from filesystem existence. `resolveGatewayInstallation` reads
 * the closed PS-3 installation receipt, validates it through the receipt
 * model, and requires a usable Gateway component record. A usable Gateway
 * = receipt present + gateway entry present + status `installed-verified`
 * (the bounded bin smoke passed at install time). Everything else fails
 * closed with typed guidance; nothing is re-installed here (installer
 * rerun owns that).
 *
 * OPERATION-WIDE LOCK (gate §18): `project add` spans Gateway bootstrap +
 * runtime-config regeneration + registry mutation, and `project remove`
 * spans runtime-config regeneration + registry mutation, so both acquire
 * ONE operator/project-state lock (`<stateDir>/project.lock`, shared PS-2
 * O_EXCL semantics: atomic acquisition, bounded wait, deterministic BUSY,
 * stale locks never auto-stolen). Lock ordering (documented, deadlock-free
 * by construction):
 *   1. `project.lock`        (outer; PS-4 lifecycle operations)
 *   2. `<runtime.json>.lock` (inner leaf; PS-2 transactional writer)
 *   `install.lock` (PS-3) is never nested with `project.lock` — the
 *   installer acquires it alone and no lifecycle operation takes it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HostEnvironment, LayoutPaths, ManifestNativeLayout } from '../host/environment.js';
import { readReceipt } from '../installer/receipt.js';
import type { GatewayReceiptEntry, InstallReceipt } from '../installer/receipt.js';
import type { ManifestNativeResolution } from '../manifest-native/resolve.js';
import { acquireLock, releaseLock } from '../persistence/lock.js';
import type { LockResult } from '../persistence/lock.js';

/** Everything an operational handler needs from the host (built once in the composition root). */
export interface OperatorContext {
  readonly env: HostEnvironment;
  readonly layout: LayoutPaths;
  /** The node interpreter that runs pi-shuttle (also launches the Gateway CLI). */
  readonly nodeExecutable: string;
  /** Executable-search environment (PATH); absent → runner falls back to the real environment. */
  readonly pathEnv?: NodeJS.ProcessEnv;
  /** Injectable UID observation (test seam; defaults to `process.getuid()`). */
  readonly uid?: number;
  /**
   * Manifest-native lifecycle resolution (F-01 correction; test seam only,
   * defaults to the production boundary). The project-lifecycle commands
   * gate their operation on a RECONCILED Receipt Schema 1 installation;
   * the production default is the compiled manifest-native lifecycle
   * resolver. Tests inject the fixture-verified resolver; production
   * callers never pass this.
   */
  readonly resolveManifestNative?: (layout: ManifestNativeLayout, lane: string) => Promise<ManifestNativeResolution>;
}

export interface GatewayFacts {
  readonly receipt: InstallReceipt;
  readonly entry: GatewayReceiptEntry;
  readonly binPath: string;
}

export type GateResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string; readonly exitCode: 1 | 2 };

export function gateFailure(code: string, message: string, exitCode: 1 | 2): { readonly ok: false; readonly code: string; readonly message: string; readonly exitCode: 1 | 2 } {
  return { ok: false, code, message, exitCode };
}

/**
 * HISTORICAL (F-01): the previous-generation installation-receipt gate.
 * Reads the legacy `~/.local/state/pi-shuttle/install.json` PS-3 receipt
 * and requires a `components.gateway` record. The manifest-native
 * installer does not write install.json, and the current project-lifecycle
 * CLI no longer reaches this function (it gates on Receipt Schema 1 via
 * the manifest-native lifecycle resolver). Retained ONLY as historical
 * reference for the excluded previous-generation path — it is unreachable
 * from the current packaged CLI.
 */
export function resolveGatewayInstallation(layout: LayoutPaths): GateResult<GatewayFacts> {
  const read = readReceipt(layout.installReceiptPath);
  if (!read.ok) {
    if (read.code === 'absent') {
      return gateFailure('ERR-PS4-RECEIPT-ABSENT', `no installation receipt at ${layout.installReceiptPath}; run the installer first`, 1);
    }
    return gateFailure('ERR-PS4-RECEIPT-INVALID', `installation receipt is invalid (${read.code}): ${read.message}`, 1);
  }
  const entry = read.receipt.components.gateway;
  if (entry === null) {
    return gateFailure('ERR-PS4-RECEIPT-NO-GATEWAY', 'the installation receipt records no Gateway component; re-run the installer with the Gateway selected', 1);
  }
  if (entry.status === 'failed') {
    return gateFailure('ERR-PS4-RECEIPT-GATEWAY-FAILED', 'the installation receipt records a failed Gateway install; re-run the installer', 1);
  }
  if (entry.status === 'installed-unverified') {
    return gateFailure('ERR-PS4-RECEIPT-GATEWAY-UNVERIFIED', 'the Gateway component is recorded as installed but unverified (the bounded bin smoke did not pass at install time); re-run the installer', 1);
  }
  return { ok: true, value: { receipt: read.receipt, entry, binPath: entry.binPath } };
}

/** The single operator/project-state lock path (gate §18). */
export function projectLockPath(layout: LayoutPaths): string {
  return join(layout.stateDir, 'project.lock');
}

/** Acquire the operation-wide lock (bounded wait; deterministic BUSY; never steals). */
export function acquireProjectLock(layout: LayoutPaths): LockResult {
  return acquireLock(projectLockPath(layout));
}

/** Release the operation-wide lock (unlink before close; crash-safe). */
export function releaseProjectLock(fd: number, layout: LayoutPaths): void {
  releaseLock(fd, projectLockPath(layout));
}

/** Read-only presence helper (used for store/lock observations; never mutation). */
export function pathExists(path: string): boolean {
  return existsSync(path);
}
