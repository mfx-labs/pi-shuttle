/**
 * The single authoritative installation receipt. Only a successful final
 * installation writes this document; legacy recovery/non-final receipts are
 * recognized only so the installer can offer narrow cleanup.
 */
import { PI_SHUTTLE_VERSION } from '../compat/manifest.js';
import { parseJsonRejectingDuplicates, readBoundedTextFile } from '../config/json.js';
import { writeFileAtomic } from '../persistence/writer.js';

export const RECEIPT_VERSION = 1;

export type ReceiptResult = 'COMPLETE' | 'PARTIAL';
export type ComponentStatus = 'installed-verified' | 'installed-unverified' | 'failed';
export type GatewaySmoke = 'passed' | 'not-run' | 'failed';

export interface GatewayReceiptEntry {
  readonly status: ComponentStatus;
  readonly version: string;
  readonly commit: string;
  readonly commitVerified: boolean;
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
  readonly digestVerified: boolean;
  readonly artifactSha256: string | null;
  readonly installPath: string;
  readonly sourcePath: string;
  readonly piVersion: string;
  readonly verifiedBy: 'pi-list' | 'unverified';
}

export interface InstallReceipt {
  readonly receiptVersion: number;
  readonly piShuttleVersion: string;
  /** Absent is the historical Stable shape. */
  readonly channel?: 'stable' | 'latest';
  readonly sourceIdentity?: string;
  readonly piShuttleInstallPath?: string;
  readonly piShuttleTreeSha256?: string;
  readonly installedAt: string;
  readonly platformLane: string;
  readonly result: ReceiptResult;
  readonly installDir: string;
  readonly binDir: string;
  readonly components: {
    readonly gateway: GatewayReceiptEntry | null;
    readonly piGuard: PiGuardReceiptEntry | null;
  };
  readonly omitted: readonly string[];
  readonly notes: readonly string[];
}

export type ReceiptResultT = { readonly ok: true; readonly receipt: InstallReceipt } | { readonly ok: false; readonly code: string; readonly message: string };
export type ReceiptReadResult = { readonly ok: true; readonly receipt: InstallReceipt } | { readonly ok: false; readonly code: 'absent' | 'invalid' | 'read-failed'; readonly message: string };
export type InstallerReceiptState =
  | { readonly kind: 'FINAL'; readonly receipt: InstallReceipt }
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'INCOMPLETE'; readonly detail: string }
  | { readonly kind: 'REFUSE'; readonly detail: string };

const RECEIPT_KEYS = new Set(['receiptVersion', 'piShuttleVersion', 'channel', 'sourceIdentity', 'piShuttleInstallPath', 'piShuttleTreeSha256', 'installedAt', 'platformLane', 'result', 'installDir', 'binDir', 'components', 'omitted', 'notes']);
const LEGACY_RECOVERY_KEYS = new Set([...RECEIPT_KEYS, 'recovery']);
const COMPONENTS_KEYS = new Set(['gateway', 'piGuard']);
const GATEWAY_KEYS = new Set(['status', 'version', 'commit', 'commitVerified', 'digestVerified', 'artifactSha256', 'installPath', 'binPath', 'smoke']);
const PI_GUARD_KEYS = new Set(['status', 'version', 'commit', 'commitVerified', 'digestVerified', 'artifactSha256', 'installPath', 'sourcePath', 'piVersion', 'verifiedBy']);
const RECOVERY_FACT_KEYS = new Set(['recoveredAt', 'recoveredBy', 'originalInstalledAt', 'originalChannel', 'originalSourceIdentity', 'observations']);
const RECOVERY_NOTE_V1_PREFIX = 'pi-shuttle:recovery:v1:';
const RECOVERY_NOTE_V2_PREFIX = 'pi-shuttle:recovery:v2:';
const SOURCE_IDENTITY = /^mfx-labs\/pi-shuttle@[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const STATUSES: readonly string[] = ['installed-verified', 'installed-unverified', 'failed'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/');
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateEntry(raw: unknown, keys: ReadonlySet<string>, label: string, required: Readonly<Record<string, (value: unknown) => boolean>>): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (!isRecord(raw)) return { ok: false, message: `${label} must be an object` };
  for (const key of Object.keys(raw)) {
    if (!keys.has(key)) return { ok: false, message: `${label} has an unknown field: ${key}` };
  }
  for (const [key, check] of Object.entries(required)) {
    if (!Object.hasOwn(raw, key) || !check(raw[key])) return { ok: false, message: `${label}.${key} is invalid` };
  }
  return { ok: true };
}

function validateComponents(gateway: unknown, piGuard: unknown): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  if (gateway !== null) {
    const result = validateEntry(gateway, GATEWAY_KEYS, 'receipt.components.gateway', {
      status: (value) => typeof value === 'string' && STATUSES.includes(value),
      version: validString,
      commit: validString,
      commitVerified: (value) => typeof value === 'boolean',
      digestVerified: (value) => typeof value === 'boolean',
      artifactSha256: (value) => value === null || (typeof value === 'string' && SHA256.test(value)),
      installPath: isAbsolutePath,
      binPath: isAbsolutePath,
      smoke: (value) => value === 'passed' || value === 'not-run' || value === 'failed',
    });
    if (!result.ok) return result;
  }
  if (piGuard !== null) {
    const result = validateEntry(piGuard, PI_GUARD_KEYS, 'receipt.components.piGuard', {
      status: (value) => typeof value === 'string' && STATUSES.includes(value),
      version: validString,
      commit: validString,
      commitVerified: (value) => typeof value === 'boolean',
      digestVerified: (value) => typeof value === 'boolean',
      artifactSha256: (value) => value === null || (typeof value === 'string' && SHA256.test(value)),
      installPath: isAbsolutePath,
      sourcePath: validString,
      piVersion: validString,
      verifiedBy: (value) => value === 'pi-list' || value === 'unverified',
    });
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Closed-field validation for FINAL receipts only. */
export function validateReceipt(value: unknown): ReceiptResultT {
  if (!isRecord(value)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt must be an object' };
  for (const key of Object.keys(value)) {
    if (!RECEIPT_KEYS.has(key)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: `receipt has an unknown field: ${key}` };
  }
  const envelope = validateEntry(value, RECEIPT_KEYS, 'receipt', {
    receiptVersion: (entry) => entry === RECEIPT_VERSION,
    piShuttleVersion: validString,
    installedAt: (entry) => validString(entry) && entry !== 'unknown',
    platformLane: validString,
    result: (entry) => entry === 'COMPLETE' || entry === 'PARTIAL',
    installDir: isAbsolutePath,
    binDir: isAbsolutePath,
    components: isRecord,
    omitted: Array.isArray,
    notes: Array.isArray,
  });
  if (!envelope.ok) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: envelope.message };

  const channel = value['channel'];
  const sourceIdentity = value['sourceIdentity'];
  const installPath = value['piShuttleInstallPath'];
  const treeSha256 = value['piShuttleTreeSha256'];
  if (channel !== undefined && channel !== 'stable' && channel !== 'latest') {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.channel must be stable or latest' };
  }
  if (sourceIdentity !== undefined && (typeof sourceIdentity !== 'string' || !SOURCE_IDENTITY.test(sourceIdentity))) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.sourceIdentity must be mfx-labs/pi-shuttle@<full-sha>' };
  }
  if ((channel === 'latest') !== (sourceIdentity !== undefined)) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'latest receipts require sourceIdentity and sourceIdentity requires channel latest' };
  }
  if ((installPath === undefined) !== (treeSha256 === undefined)
    || (installPath !== undefined && !isAbsolutePath(installPath))
    || (treeSha256 !== undefined && (typeof treeSha256 !== 'string' || !SHA256.test(treeSha256)))) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'pi-shuttle package path and tree SHA-256 must be present together and valid' };
  }
  if (channel === 'latest' && installPath === undefined) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'latest receipts require the exact package path and tree SHA-256' };
  }

  const components = value['components'] as Readonly<Record<string, unknown>>;
  if (!Object.hasOwn(components, 'gateway') || !Object.hasOwn(components, 'piGuard')) {
    return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.components must contain gateway and piGuard' };
  }
  for (const key of Object.keys(components)) {
    if (!COMPONENTS_KEYS.has(key)) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: `receipt.components has an unknown field: ${key}` };
  }
  const componentVerdict = validateComponents(components['gateway'], components['piGuard']);
  if (!componentVerdict.ok) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: componentVerdict.message };
  const omitted = value['omitted'] as unknown[];
  const notes = value['notes'] as unknown[];
  if (omitted.some((entry) => typeof entry !== 'string')) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.omitted must be an array of strings' };
  if (notes.some((entry) => typeof entry !== 'string')) return { ok: false, code: 'ERR-PS3-RECEIPT-INVALID', message: 'receipt.notes must be an array of strings' };

  return {
    ok: true,
    receipt: {
      receiptVersion: RECEIPT_VERSION,
      piShuttleVersion: value['piShuttleVersion'] as string,
      ...(channel !== undefined ? { channel } : {}),
      ...(sourceIdentity !== undefined ? { sourceIdentity: sourceIdentity as string } : {}),
      ...(installPath !== undefined ? { piShuttleInstallPath: installPath as string, piShuttleTreeSha256: treeSha256 as string } : {}),
      installedAt: value['installedAt'] as string,
      platformLane: value['platformLane'] as string,
      result: value['result'] as ReceiptResult,
      installDir: value['installDir'] as string,
      binDir: value['binDir'] as string,
      components: {
        gateway: components['gateway'] as GatewayReceiptEntry | null,
        piGuard: components['piGuard'] as PiGuardReceiptEntry | null,
      },
      omitted: [...(omitted as string[])],
      notes: [...(notes as string[])],
    },
  };
}

function recognizedRecoveryFacts(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).some((key) => !RECOVERY_FACT_KEYS.has(key))) return false;
  if (!validString(value['recoveredAt'])) return false;
  if (value['recoveredBy'] !== undefined && (typeof value['recoveredBy'] !== 'string' || !SOURCE_IDENTITY.test(value['recoveredBy']))) return false;
  if (value['originalInstalledAt'] !== null && !validString(value['originalInstalledAt'])) return false;
  if (!['unknown', 'stable', 'latest'].includes(String(value['originalChannel']))) return false;
  if (value['originalSourceIdentity'] !== undefined && (typeof value['originalSourceIdentity'] !== 'string' || !SOURCE_IDENTITY.test(value['originalSourceIdentity']))) return false;
  return true;
}

/** Recognize known prior recovery receipts as cleanup evidence, never authority. */
function isRecognizedIncompleteReceipt(value: unknown): boolean {
  if (!isRecord(value) || value['receiptVersion'] !== RECEIPT_VERSION || !validString(value['piShuttleVersion'])) return false;

  if (value['recovery'] !== undefined) {
    const components = value['components'];
    return Object.keys(value).every((key) => LEGACY_RECOVERY_KEYS.has(key))
      && value['installedAt'] === undefined && value['channel'] === undefined && value['sourceIdentity'] === undefined
      && validString(value['platformLane'])
      && (value['result'] === 'COMPLETE' || value['result'] === 'PARTIAL')
      && isAbsolutePath(value['installDir']) && isAbsolutePath(value['binDir'])
      && isRecord(components) && Object.hasOwn(components, 'gateway') && Object.hasOwn(components, 'piGuard')
      && Object.keys(components).every((key) => COMPONENTS_KEYS.has(key))
      && Array.isArray(value['omitted']) && value['omitted'].every((entry) => typeof entry === 'string')
      && Array.isArray(value['notes']) && value['notes'].every((entry) => typeof entry === 'string')
      && recognizedRecoveryFacts(value['recovery']);
  }

  const notes = value['notes'];
  const components = value['components'];
  if (Object.keys(value).some((key) => !RECEIPT_KEYS.has(key))
    || value['installedAt'] !== 'unknown'
    || value['channel'] !== undefined || value['sourceIdentity'] !== undefined
    || value['piShuttleInstallPath'] !== undefined || value['piShuttleTreeSha256'] !== undefined
    || !validString(value['platformLane'])
    || (value['result'] !== 'COMPLETE' && value['result'] !== 'PARTIAL')
    || !isAbsolutePath(value['installDir']) || !isAbsolutePath(value['binDir'])
    || !Array.isArray(value['omitted']) || value['omitted'].some((entry) => typeof entry !== 'string')
    || !Array.isArray(notes) || notes.some((entry) => typeof entry !== 'string')
    || !isRecord(components) || Object.keys(components).some((key) => !COMPONENTS_KEYS.has(key))
    || components['gateway'] !== null || components['piGuard'] !== null) return false;
  const markers = notes.filter((note): note is string => typeof note === 'string'
    && (note.startsWith(RECOVERY_NOTE_V1_PREFIX) || note.startsWith(RECOVERY_NOTE_V2_PREFIX)));
  if (markers.length !== 1) return false;
  const marker = markers[0]!;
  const v2 = marker.startsWith(RECOVERY_NOTE_V2_PREFIX);
  const parsed = parseJsonRejectingDuplicates(marker.slice((v2 ? RECOVERY_NOTE_V2_PREFIX : RECOVERY_NOTE_V1_PREFIX).length));
  if (!parsed.ok || !isRecord(parsed.value) || !recognizedRecoveryFacts(parsed.value['recovery'])) return false;
  const expected = v2 ? new Set(['recovery', 'observations']) : new Set(['recovery', 'components']);
  return Object.keys(parsed.value).every((key) => expected.has(key))
    && Object.hasOwn(parsed.value, v2 ? 'observations' : 'components');
}

/** Installer-only receipt classification. */
export function inspectInstallerReceipt(path: string): InstallerReceiptState {
  const read = readBoundedTextFile(path);
  if (!read.ok) {
    if (read.code === 'absent') return { kind: 'ABSENT' };
    return { kind: 'REFUSE', detail: read.message };
  }
  const parsed = parseJsonRejectingDuplicates(read.text);
  if (!parsed.ok) return { kind: 'REFUSE', detail: parsed.message };
  const final = validateReceipt(parsed.value);
  if (final.ok) return { kind: 'FINAL', receipt: final.receipt };
  if (isRecognizedIncompleteReceipt(parsed.value)) {
    return { kind: 'INCOMPLETE', detail: 'recognized legacy recovery/non-final receipt' };
  }
  return { kind: 'REFUSE', detail: final.message };
}

/** Read a FINAL receipt. Known recovery receipts are deliberately invalid here. */
export function readReceipt(path: string): ReceiptReadResult {
  const inspected = inspectInstallerReceipt(path);
  if (inspected.kind === 'FINAL') return { ok: true, receipt: inspected.receipt };
  if (inspected.kind === 'ABSENT') return { ok: false, code: 'absent', message: `${path} could not be read (ENOENT)` };
  if (inspected.kind === 'INCOMPLETE') return { ok: false, code: 'invalid', message: inspected.detail };
  return { ok: false, code: inspected.detail.includes('could not be read') ? 'read-failed' : 'invalid', message: inspected.detail };
}

/** Deterministic FINAL receipt serialization. */
export function serializeReceipt(receipt: InstallReceipt): string {
  const document = {
    receiptVersion: receipt.receiptVersion,
    piShuttleVersion: receipt.piShuttleVersion,
    ...(receipt.channel !== undefined ? { channel: receipt.channel } : {}),
    ...(receipt.sourceIdentity !== undefined ? { sourceIdentity: receipt.sourceIdentity } : {}),
    ...(receipt.piShuttleInstallPath !== undefined ? { piShuttleInstallPath: receipt.piShuttleInstallPath, piShuttleTreeSha256: receipt.piShuttleTreeSha256 } : {}),
    installedAt: receipt.installedAt,
    platformLane: receipt.platformLane,
    result: receipt.result,
    installDir: receipt.installDir,
    binDir: receipt.binDir,
    components: { gateway: receipt.components.gateway, piGuard: receipt.components.piGuard },
    omitted: [...receipt.omitted],
    notes: [...receipt.notes],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Atomically publish one FINAL receipt. The production caller owns the
 * installation-wide install.lock; receipt publication deliberately has no
 * sibling receipt lock.
 */
export function writeReceipt(path: string, receipt: InstallReceipt): ReceiptResultT {
  const current = inspectInstallerReceipt(path);
  if (current.kind !== 'ABSENT' && current.kind !== 'FINAL') {
    return { ok: false, code: 'ERR-PS2-CONFIG-INCOMPATIBLE', message: `${path} exists with incompatible content; refusing to modify it` };
  }
  const result = writeFileAtomic(path, serializeReceipt(receipt));
  if (!result.ok) return { ok: false, code: result.code, message: result.message };
  return { ok: true, receipt };
}

/** Build a fresh FINAL receipt. */
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
}): InstallReceipt {
  return {
    receiptVersion: RECEIPT_VERSION,
    piShuttleVersion: input.piShuttleVersion ?? PI_SHUTTLE_VERSION,
    ...(input.channel !== undefined ? { channel: input.channel } : {}),
    ...(input.sourceIdentity !== undefined ? { sourceIdentity: input.sourceIdentity } : {}),
    ...(input.piShuttleInstallPath !== undefined ? { piShuttleInstallPath: input.piShuttleInstallPath, piShuttleTreeSha256: input.piShuttleTreeSha256! } : {}),
    installedAt: new Date().toISOString(),
    platformLane: input.platformLane,
    result: input.result,
    installDir: input.installDir,
    binDir: input.binDir,
    components: { gateway: input.gateway, piGuard: input.piGuard },
    omitted: [...input.omitted],
    notes: [...input.notes],
  };
}
