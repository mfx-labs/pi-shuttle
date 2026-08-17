/**
 * PS-3 installation receipt (installation-contract §5.8, §8). The single
 * source of truth for installed state, under the PS-2 state layout:
 * `~/.local/state/pi-shuttle/install.json`.
 *
 * Truthful and closed: records ONLY facts the installer actually
 * established. Never serializes Gateway bootstrap provenance, approval
 * authority, grant or receipt authority objects, secrets, or credentials.
 * Component status
 * vocabulary: installed-verified / installed-unverified / failed.
 * A receipt is written ONLY when an installation finalizes (COMPLETE or
 * PARTIAL); failed attempts preserve the prior receipt (or none).
 *
 * Concurrency-safe: written through the PS-2 transactional persistence
 * primitive (mutateDocumentAtomically) — one authoritative state writer.
 */
import { PI_SHUTTLE_VERSION } from '../compat/manifest.js';
import { parseJsonRejectingDuplicates, readBoundedTextFile } from '../config/json.js';
import { mutateDocumentAtomically } from '../persistence/writer.js';

export const RECEIPT_VERSION = 1;

export type ReceiptResult = 'COMPLETE' | 'PARTIAL';
export type ComponentStatus = 'installed-verified' | 'installed-unverified' | 'failed';
export type GatewaySmoke = 'passed' | 'not-run' | 'failed';

export interface GatewayReceiptEntry {
  readonly status: ComponentStatus;
  readonly version: string;
  readonly commit: string;
  /** Local/test artifacts cannot prove the manifest commit claim. */
  readonly commitVerified: boolean;
  /** True only when the artifact SHA-256 matched an explicit expected digest. */
  readonly digestVerified: boolean;
  readonly artifactSha256: string | null;
  readonly installPath: string;
  readonly binPath: string;
  readonly smoke: GatewaySmoke;
}

export interface PiGuardReceiptEntry {
  readonly status: ComponentStatus;
  readonly version: string;
  readonly commit: string;
  readonly commitVerified: boolean;
  /** True only when the artifact SHA-256 matched an explicit expected digest. */
  readonly digestVerified: boolean;
  readonly artifactSha256: string | null;
  readonly installPath: string;
  readonly sourcePath: string;
  readonly piVersion: string;
  readonly verifiedBy: 'pi-list' | 'unverified';
}

export interface ReceiptRecovery {
  readonly recoveredAt: string;
  readonly recoveredBy?: string;
  readonly originalInstalledAt: string | null;
  readonly originalChannel: 'unknown' | 'stable' | 'latest';
  readonly originalSourceIdentity?: string;
}

export interface InstallReceipt {
  readonly receiptVersion: number;
  readonly piShuttleVersion: string;
  /** Optional distribution identity; absent is the historical/local shape. */
  readonly channel?: 'stable' | 'latest';
  /** Present only for latest receipts, e.g. mfx-labs/pi-shuttle@<sha>. */
  readonly sourceIdentity?: string;
  /** Exact activated package root and deterministic tree digest when package-backed. */
  readonly piShuttleInstallPath?: string;
  readonly piShuttleTreeSha256?: string;
  /** Absent only when recovery could not prove the original install time. */
  readonly installedAt?: string;
  /** Present only for a receipt reconstructed from surviving state. */
  readonly recovery?: ReceiptRecovery;
  readonly platformLane: string;
  readonly result: ReceiptResult;
  readonly installDir: string;
  readonly binDir: string;
  readonly components: {
    readonly gateway: GatewayReceiptEntry | null;
    readonly piGuard: PiGuardReceiptEntry | null;
  };
  /** Components the operator declined (truthful PARTIAL reporting). */
  readonly omitted: readonly string[];
  readonly notes: readonly string[];
}

export type ReceiptResultT = { readonly ok: true; readonly receipt: InstallReceipt } | { readonly ok: false; readonly code: string; readonly message: string };

export type ReceiptReadResult = { readonly ok: true; readonly receipt: InstallReceipt } | { readonly ok: false; readonly code: 'absent' | 'invalid' | 'read-failed'; readonly message: string };

const RECEIPT_KEYS = new Set(['receiptVersion', 'piShuttleVersion', 'channel', 'sourceIdentity', 'piShuttleInstallPath', 'piShuttleTreeSha256', 'installedAt', 'recovery', 'platformLane', 'result', 'installDir', 'binDir', 'components', 'omitted', 'notes']);
const COMPONENTS_KEYS = new Set(['gateway', 'piGuard']);
const GATEWAY_KEYS = new Set(['status', 'version', 'commit', 'commitVerified', 'digestVerified', 'artifactSha256', 'installPath', 'binPath', 'smoke']);
const PI_GUARD_KEYS = new Set(['status', 'version', 'commit', 'commitVerified', 'digestVerified', 'artifactSha256', 'installPath', 'sourcePath', 'piVersion', 'verifiedBy']);
const RECOVERY_KEYS = new Set(['recoveredAt', 'recoveredBy', 'originalInstalledAt', 'originalChannel', 'originalSourceIdentity']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/');
}

const STATUSES: readonly string[] = ['installed-verified', 'installed-unverified', 'failed'];

function validateEntry(raw: unknown, keys: ReadonlySet<string>, label: string, required: Readonly<Record<string, (v: unknown) => boolean>>): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (!isRecord(raw)) return { ok: false, message: `${label} must be an object` };
  for (const key of Object.keys(raw)) {
    if (!keys.has(key)) return { ok: false, message: `${label} has an unknown field: ${key}` };
  }
  for (const [key, check] of Object.entries(required)) {
    if (!check(raw[key])) return { ok: false, message: `${label}.${key} is invalid` };
  }
  return { ok: true };
}

/** Closed-field validation of a parsed receipt. */
export function validateReceipt(value: unknown): ReceiptResultT {
  if (!isRecord(value)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt must be an object' };
  for (const key of Object.keys(value)) {
    if (!RECEIPT_KEYS.has(key)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: `receipt has an unknown field: ${key}` };
  }
  const str = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
  const verdict = validateEntry(value, RECEIPT_KEYS, 'receipt', {
    receiptVersion: (v) => v === RECEIPT_VERSION,
    piShuttleVersion: str,
    platformLane: str,
    result: (v) => v === 'COMPLETE' || v === 'PARTIAL',
    installDir: isAbsolutePath,
    binDir: isAbsolutePath,
  });
  if (!verdict.ok) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: verdict.message };
  const channel = value['channel'];
  const sourceIdentity = value['sourceIdentity'];
  const piShuttleInstallPath = value['piShuttleInstallPath'];
  const piShuttleTreeSha256 = value['piShuttleTreeSha256'];
  const installedAt = value['installedAt'];
  const recoveryRaw = value['recovery'];
  if (installedAt !== undefined && !str(installedAt)) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.installedAt must be a non-empty string when present' };
  }
  if (channel !== undefined && channel !== 'stable' && channel !== 'latest') {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.channel must be stable or latest' };
  }
  if (sourceIdentity !== undefined && (typeof sourceIdentity !== 'string' || !/^mfx-labs\/pi-shuttle@[0-9a-f]{40}$/.test(sourceIdentity))) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.sourceIdentity must be mfx-labs/pi-shuttle@<full-sha>' };
  }
  if ((channel === 'latest') !== (sourceIdentity !== undefined)) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'latest receipts require sourceIdentity and sourceIdentity requires channel latest' };
  }
  if ((piShuttleInstallPath === undefined) !== (piShuttleTreeSha256 === undefined)
    || (piShuttleInstallPath !== undefined && !isAbsolutePath(piShuttleInstallPath))
    || (piShuttleTreeSha256 !== undefined && (typeof piShuttleTreeSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(piShuttleTreeSha256)))) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'pi-shuttle package path and tree SHA-256 must be present together and valid' };
  }
  let recovery: ReceiptRecovery | undefined;
  if (recoveryRaw !== undefined) {
    if (!isRecord(recoveryRaw)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.recovery must be an object' };
    for (const key of Object.keys(recoveryRaw)) {
      if (!RECOVERY_KEYS.has(key)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: `receipt.recovery has an unknown field: ${key}` };
    }
    const recoveredBy = recoveryRaw['recoveredBy'];
    const originalInstalledAt = recoveryRaw['originalInstalledAt'];
    const originalSourceIdentity = recoveryRaw['originalSourceIdentity'];
    if (!str(recoveryRaw['recoveredAt']) || (recoveredBy !== undefined && (typeof recoveredBy !== 'string' || !/^mfx-labs\/pi-shuttle@[0-9a-f]{40}$/.test(recoveredBy)))
      || (originalInstalledAt !== null && !str(originalInstalledAt))
      || (recoveryRaw['originalChannel'] !== 'unknown' && recoveryRaw['originalChannel'] !== 'stable' && recoveryRaw['originalChannel'] !== 'latest')
      || (originalSourceIdentity !== undefined && (typeof originalSourceIdentity !== 'string' || !/^mfx-labs\/pi-shuttle@[0-9a-f]{40}$/.test(originalSourceIdentity)))) {
      return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.recovery contains invalid provenance facts' };
    }
    if (installedAt !== undefined || channel !== undefined || sourceIdentity !== undefined) {
      return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'recovered receipts must keep original installation facts separate from recovery facts' };
    }
    if (recoveryRaw['originalChannel'] === 'latest' && originalSourceIdentity === undefined) {
      return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'known latest original provenance requires originalSourceIdentity' };
    }
    if (recoveryRaw['originalChannel'] !== 'latest' && originalSourceIdentity !== undefined) {
      return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'originalSourceIdentity requires latest original provenance' };
    }
    recovery = {
      recoveredAt: recoveryRaw['recoveredAt'] as string,
      ...(recoveredBy !== undefined ? { recoveredBy: recoveredBy as string } : {}),
      originalInstalledAt: originalInstalledAt as string | null,
      originalChannel: recoveryRaw['originalChannel'] as ReceiptRecovery['originalChannel'],
      ...(originalSourceIdentity !== undefined ? { originalSourceIdentity: originalSourceIdentity as string } : {}),
    };
  } else if (installedAt === undefined) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'ordinary receipts require installedAt' };
  }
  const components = value['components'];
  if (!isRecord(components)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.components must be an object' };
  for (const key of Object.keys(components)) {
    if (!COMPONENTS_KEYS.has(key)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: `receipt.components has an unknown field: ${key}` };
  }
  const omitted = value['omitted'];
  if (!Array.isArray(omitted) || omitted.some((o) => typeof o !== 'string')) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.omitted must be an array of strings' };
  }
  const notes = value['notes'];
  if (!Array.isArray(notes) || notes.some((n) => typeof n !== 'string')) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.notes must be an array of strings' };
  }
  const gatewayRaw = components['gateway'];
  const piGuardRaw = components['piGuard'];
  if (gatewayRaw !== null) {
    const g = validateEntry(gatewayRaw, GATEWAY_KEYS, 'receipt.components.gateway', {
      status: (v) => typeof v === 'string' && STATUSES.includes(v),
      version: str,
      commit: str,
      commitVerified: (v) => typeof v === 'boolean',
      digestVerified: (v) => typeof v === 'boolean',
      artifactSha256: (v) => v === null || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)),
      installPath: isAbsolutePath,
      binPath: isAbsolutePath,
      smoke: (v) => v === 'passed' || v === 'not-run' || v === 'failed',
    });
    if (!g.ok) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: g.message };
  }
  if (piGuardRaw !== null) {
    const p = validateEntry(piGuardRaw, PI_GUARD_KEYS, 'receipt.components.piGuard', {
      status: (v) => typeof v === 'string' && STATUSES.includes(v),
      version: str,
      commit: str,
      commitVerified: (v) => typeof v === 'boolean',
      digestVerified: (v) => typeof v === 'boolean',
      artifactSha256: (v) => v === null || (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)),
      installPath: isAbsolutePath,
      sourcePath: str,
      piVersion: str,
      verifiedBy: (v) => v === 'pi-list' || v === 'unverified',
    });
    if (!p.ok) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: p.message };
  }
  return {
    ok: true,
    receipt: {
      receiptVersion: value['receiptVersion'] as number,
      piShuttleVersion: value['piShuttleVersion'] as string,
      ...(channel !== undefined ? { channel } : {}),
      ...(sourceIdentity !== undefined ? { sourceIdentity } : {}),
      ...(piShuttleInstallPath !== undefined ? { piShuttleInstallPath: piShuttleInstallPath as string, piShuttleTreeSha256: piShuttleTreeSha256 as string } : {}),
      ...(installedAt !== undefined ? { installedAt: installedAt as string } : {}),
      ...(recovery !== undefined ? { recovery } : {}),
      platformLane: value['platformLane'] as string,
      result: value['result'] as ReceiptResult,
      installDir: value['installDir'] as string,
      binDir: value['binDir'] as string,
      components: {
        gateway: gatewayRaw as GatewayReceiptEntry | null,
        piGuard: piGuardRaw as PiGuardReceiptEntry | null,
      },
      omitted: [...(omitted as string[])],
      notes: [...(notes as string[])],
    },
  };
}

/** Deterministic serialization: fixed key order, 2-space indent, trailing newline. */
export function serializeReceipt(receipt: InstallReceipt): string {
  const gateway = receipt.components.gateway === null ? null : {
    status: receipt.components.gateway.status,
    version: receipt.components.gateway.version,
    commit: receipt.components.gateway.commit,
    commitVerified: receipt.components.gateway.commitVerified,
    digestVerified: receipt.components.gateway.digestVerified,
    artifactSha256: receipt.components.gateway.artifactSha256,
    installPath: receipt.components.gateway.installPath,
    binPath: receipt.components.gateway.binPath,
    smoke: receipt.components.gateway.smoke,
  };
  const piGuard = receipt.components.piGuard === null ? null : {
    status: receipt.components.piGuard.status,
    version: receipt.components.piGuard.version,
    commit: receipt.components.piGuard.commit,
    commitVerified: receipt.components.piGuard.commitVerified,
    digestVerified: receipt.components.piGuard.digestVerified,
    artifactSha256: receipt.components.piGuard.artifactSha256,
    installPath: receipt.components.piGuard.installPath,
    sourcePath: receipt.components.piGuard.sourcePath,
    piVersion: receipt.components.piGuard.piVersion,
    verifiedBy: receipt.components.piGuard.verifiedBy,
  };
  const document = {
    receiptVersion: receipt.receiptVersion,
    piShuttleVersion: receipt.piShuttleVersion,
    ...(receipt.channel !== undefined ? { channel: receipt.channel } : {}),
    ...(receipt.sourceIdentity !== undefined ? { sourceIdentity: receipt.sourceIdentity } : {}),
    ...(receipt.piShuttleInstallPath !== undefined ? { piShuttleInstallPath: receipt.piShuttleInstallPath, piShuttleTreeSha256: receipt.piShuttleTreeSha256 } : {}),
    ...(receipt.installedAt !== undefined ? { installedAt: receipt.installedAt } : {}),
    ...(receipt.recovery !== undefined ? { recovery: receipt.recovery } : {}),
    platformLane: receipt.platformLane,
    result: receipt.result,
    installDir: receipt.installDir,
    binDir: receipt.binDir,
    components: { gateway, piGuard },
    omitted: [...receipt.omitted],
    notes: [...receipt.notes],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Read + validate the existing receipt. `absent` when none exists. */
export function readReceipt(path: string): ReceiptReadResult {
  const read = readBoundedTextFile(path);
  if (!read.ok) {
    if (read.code === 'absent') return { ok: false, code: 'absent', message: read.message };
    return { ok: false, code: 'read-failed', message: read.message };
  }
  const parsed = parseJsonRejectingDuplicates(read.text);
  if (!parsed.ok) return { ok: false, code: 'invalid', message: parsed.message };
  const validated = validateReceipt(parsed.value);
  if (!validated.ok) return { ok: false, code: 'invalid', message: validated.message };
  return { ok: true, receipt: validated.receipt };
}

/** Atomically persist the receipt (single authoritative writer; 0600; concurrency-safe). */
export function writeReceipt(path: string, receipt: InstallReceipt): ReceiptResultT {
  const result = mutateDocumentAtomically<InstallReceipt>(path, {
    decode: (text) => {
      const parsed = parseJsonRejectingDuplicates(text);
      if (!parsed.ok) return null;
      const validated = validateReceipt(parsed.value);
      return validated.ok ? validated.receipt : null;
    },
    transition: () => ({ ok: true as const, next: receipt, changed: true }),
    serialize: serializeReceipt,
  });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, receipt: result.value };
}

/** Build a fresh receipt skeleton with deterministic field order. */
export function newReceipt(input: {
  readonly piShuttleVersion?: string;
  readonly platformLane: string;
  readonly result: ReceiptResult;
  readonly installDir: string;
  readonly binDir: string;
  readonly gateway: GatewayReceiptEntry | null;
  readonly piGuard: PiGuardReceiptEntry | null;
  readonly omitted: readonly string[];
  readonly notes: readonly string[];
  readonly channel?: 'stable' | 'latest';
  readonly sourceIdentity?: string;
  readonly piShuttleInstallPath?: string;
  readonly piShuttleTreeSha256?: string;
  readonly recovery?: ReceiptRecovery;
}): InstallReceipt {
  return {
    receiptVersion: RECEIPT_VERSION,
    piShuttleVersion: input.piShuttleVersion ?? PI_SHUTTLE_VERSION,
    ...(input.channel !== undefined ? { channel: input.channel } : {}),
    ...(input.sourceIdentity !== undefined ? { sourceIdentity: input.sourceIdentity } : {}),
    ...(input.piShuttleInstallPath !== undefined ? { piShuttleInstallPath: input.piShuttleInstallPath, piShuttleTreeSha256: input.piShuttleTreeSha256! } : {}),
    ...(input.recovery === undefined ? { installedAt: new Date().toISOString() } : { recovery: input.recovery }),
    platformLane: input.platformLane,
    result: input.result,
    installDir: input.installDir,
    binDir: input.binDir,
    components: { gateway: input.gateway, piGuard: input.piGuard },
    omitted: [...input.omitted],
    notes: [...input.notes],
  };
}
