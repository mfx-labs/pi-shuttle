/**
 * pi-shuttle runtime-configuration document model (PS-2).
 *
 * The operator-owned composition document at `~/.config/pi-shuttle/runtime.json`
 * (operator-cli-contract §7): the Gateway startup document shape
 * (`surfaces[]`, component-boundaries §3) that `project add` composes and
 * `start` later passes verbatim to the Gateway CLI.
 *
 * AUTHORITY CLASSES, KEPT SEPARATE (product-contract §1/§7): this is
 * ordinary operator-owned application configuration — closed-field shape
 * validation only, with the Gateway loader remaining the authority for the
 * document's semantics at startup. NO trusted configuration semantics live
 * here: no identity derivation, no provenance, no capability/brand material,
 * no approval/issuance vocabulary. The trusted WP-6 configuration and the
 * genuine bootstrap provenance are minted ONLY inside the Gateway package
 * (PS-1 baseline 7f3b4af...); pi-shuttle never duplicates them.
 */
import { parseJsonRejectingDuplicates, readBoundedTextFile } from './json.js';

/** Shape rule shared with the Gateway startup document (component-boundaries §3). */
const SHA256_IDENTITY_RE = /^sha-256:[0-9a-f]{64}$/;

export interface WorkspaceEntryConfig {
  readonly workspaceId: string;
  readonly root: string;
  readonly artifactLocation?: string;
}

/** One operator-composed surface (closed fields; shape of the Gateway startup document). */
export interface SurfaceConfig {
  readonly surfaceId: string;
  readonly locator: string;
  readonly serviceUid: number;
  readonly forbiddenRoots: readonly string[];
  readonly configurationIdentity: string;
  readonly configurationVersion: string;
  readonly limitProfile: Readonly<Record<string, number>>;
  readonly workspaces?: readonly WorkspaceEntryConfig[];
  readonly gitPath?: string;
  readonly gitHome?: string;
  readonly gitTmpdir?: string;
}

/** The operator runtime document: an ordered list of composed surfaces. */
export interface RuntimeDocument {
  readonly surfaces: readonly SurfaceConfig[];
}

export type DocumentResult = { readonly ok: true; readonly document: RuntimeDocument } | { readonly ok: false; readonly code: string; readonly message: string };

export type DocumentReadResult =
  | { readonly ok: true; readonly document: RuntimeDocument }
  | { readonly ok: false; readonly code: 'absent' | 'invalid' | 'read-failed'; readonly message: string };

const SURFACE_KEYS = new Set(['surfaceId', 'locator', 'serviceUid', 'forbiddenRoots', 'configurationIdentity', 'configurationVersion', 'limitProfile', 'workspaces', 'gitPath', 'gitHome', 'gitTmpdir']);
const WORKSPACE_KEYS = new Set(['workspaceId', 'root', 'artifactLocation']);
const DOCUMENT_KEYS = new Set(['surfaces']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/');
}

/** Closed-field validation of one workspace entry. */
function validateWorkspace(raw: unknown, index: number): { readonly ok: true; readonly workspace: WorkspaceEntryConfig } | { readonly ok: false; readonly message: string } {
  const label = `surfaces[i].workspaces[${index}]`;
  if (!isRecord(raw)) return { ok: false, message: `${label} must be an object` };
  for (const key of Object.keys(raw)) {
    if (!WORKSPACE_KEYS.has(key)) return { ok: false, message: `${label} has an unknown field: ${key}` };
  }
  const workspaceId = raw['workspaceId'];
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    return { ok: false, message: `${label}.workspaceId must be a non-empty string` };
  }
  const root = raw['root'];
  if (!isAbsolutePath(root)) return { ok: false, message: `${label}.root must be an absolute path string` };
  let artifactLocation: string | undefined;
  if (raw['artifactLocation'] !== undefined) {
    const rawLocation = raw['artifactLocation'];
    if (!isAbsolutePath(rawLocation)) return { ok: false, message: `${label}.artifactLocation must be an absolute path string` };
    artifactLocation = rawLocation;
  }
  return { ok: true, workspace: { workspaceId, root, ...(artifactLocation !== undefined ? { artifactLocation } : {}) } };
}

/** Closed-field validation of one surface entry (shape rules of the Gateway startup document). */
function validateSurface(raw: unknown, index: number): { readonly ok: true; readonly surface: SurfaceConfig } | { readonly ok: false; readonly message: string } {
  const label = `surfaces[${index}]`;
  if (!isRecord(raw)) return { ok: false, message: `${label} must be an object` };
  for (const key of Object.keys(raw)) {
    if (!SURFACE_KEYS.has(key)) return { ok: false, message: `${label} has an unknown field: ${key}` };
  }
  const surfaceId = raw['surfaceId'];
  if (typeof surfaceId !== 'string' || surfaceId.length === 0) {
    return { ok: false, message: `${label}.surfaceId must be a non-empty string` };
  }
  const locator = raw['locator'];
  if (!isAbsolutePath(locator)) return { ok: false, message: `${label}.locator must be an absolute path string` };
  const serviceUid = raw['serviceUid'];
  if (typeof serviceUid !== 'number' || !Number.isSafeInteger(serviceUid) || serviceUid < 0) {
    return { ok: false, message: `${label}.serviceUid must be a non-negative safe integer` };
  }
  const forbiddenRoots = raw['forbiddenRoots'];
  if (!Array.isArray(forbiddenRoots) || forbiddenRoots.some((r) => !isAbsolutePath(r))) {
    return { ok: false, message: `${label}.forbiddenRoots must be an array of absolute path strings` };
  }
  const configurationIdentity = raw['configurationIdentity'];
  if (typeof configurationIdentity !== 'string' || !SHA256_IDENTITY_RE.test(configurationIdentity)) {
    return { ok: false, message: `${label}.configurationIdentity must use sha-256:<64-hex> syntax` };
  }
  const configurationVersion = raw['configurationVersion'];
  if (typeof configurationVersion !== 'string' || configurationVersion.length === 0) {
    return { ok: false, message: `${label}.configurationVersion must be a non-empty string` };
  }
  const limitProfile = raw['limitProfile'];
  if (!isRecord(limitProfile) || Object.values(limitProfile).some((v) => typeof v !== 'number')) {
    return { ok: false, message: `${label}.limitProfile must be an object of number values` };
  }
  // All values are numbers (validated above); narrow the type honestly.
  const limitProfileValidated: Record<string, number> = {};
  for (const key of Object.keys(limitProfile)) {
    limitProfileValidated[key] = limitProfile[key] as number;
  }
  let workspaces: WorkspaceEntryConfig[] | undefined;
  if (raw['workspaces'] !== undefined) {
    const rawWorkspaces = raw['workspaces'];
    if (!Array.isArray(rawWorkspaces)) return { ok: false, message: `${label}.workspaces must be an array` };
    const validated: WorkspaceEntryConfig[] = [];
    for (let i = 0; i < rawWorkspaces.length; i++) {
      const w = validateWorkspace(rawWorkspaces[i], i);
      if (!w.ok) return w;
      validated.push(w.workspace);
    }
    workspaces = validated;
  }
  let gitPath: string | undefined;
  if (raw['gitPath'] !== undefined) {
    if (!isAbsolutePath(raw['gitPath'])) return { ok: false, message: `${label}.gitPath must be an absolute path string` };
    gitPath = raw['gitPath'];
  }
  let gitHome: string | undefined;
  if (raw['gitHome'] !== undefined) {
    if (!isAbsolutePath(raw['gitHome'])) return { ok: false, message: `${label}.gitHome must be an absolute path string` };
    gitHome = raw['gitHome'];
  }
  let gitTmpdir: string | undefined;
  if (raw['gitTmpdir'] !== undefined) {
    if (!isAbsolutePath(raw['gitTmpdir'])) return { ok: false, message: `${label}.gitTmpdir must be an absolute path string` };
    gitTmpdir = raw['gitTmpdir'];
  }
  return {
    ok: true,
    surface: {
      surfaceId,
      locator,
      serviceUid,
      forbiddenRoots: [...forbiddenRoots],
      configurationIdentity,
      configurationVersion,
      limitProfile: limitProfileValidated,
      ...(workspaces !== undefined ? { workspaces } : {}),
      ...(gitPath !== undefined ? { gitPath } : {}),
      ...(gitHome !== undefined ? { gitHome } : {}),
      ...(gitTmpdir !== undefined ? { gitTmpdir } : {}),
    },
  };
}

/** Validate a parsed runtime document (closed fields; shape only). */
export function validateRuntimeDocument(value: unknown): DocumentResult {
  if (!isRecord(value)) return { ok: false, code: 'ERR-PS2-CONFIG-INVALID', message: 'runtime document must be an object' };
  for (const key of Object.keys(value)) {
    if (!DOCUMENT_KEYS.has(key)) return { ok: false, code: 'ERR-PS2-CONFIG-INVALID', message: `runtime document has an unknown field: ${key}` };
  }
  const rawSurfaces = value['surfaces'];
  if (!Array.isArray(rawSurfaces)) return { ok: false, code: 'ERR-PS2-CONFIG-INVALID', message: 'runtime document must contain a surfaces array' };
  const surfaces: SurfaceConfig[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawSurfaces.length; i++) {
    const validated = validateSurface(rawSurfaces[i], i);
    if (!validated.ok) return { ok: false, code: 'ERR-PS2-CONFIG-INVALID', message: validated.message };
    if (seen.has(validated.surface.surfaceId)) {
      return { ok: false, code: 'ERR-PS2-CONFIG-INVALID', message: `surfaceId is registered more than once: ${validated.surface.surfaceId}` };
    }
    seen.add(validated.surface.surfaceId);
    surfaces.push(validated.surface);
  }
  return { ok: true, document: { surfaces } };
}

/** Parse a document text with duplicate-key rejection and closed-field validation. */
export function parseRuntimeDocument(text: string): DocumentResult {
  const parsed = parseJsonRejectingDuplicates(text);
  if (!parsed.ok) return { ok: false, code: 'ERR-PS2-CONFIG-INVALID', message: parsed.message };
  return validateRuntimeDocument(parsed.value);
}

/** Read + parse the runtime document from disk (bounded). `absent` when the file does not exist. */
export function readRuntimeDocument(path: string): DocumentReadResult {
  const read = readBoundedTextFile(path);
  if (!read.ok) {
    if (read.code === 'absent') return { ok: false, code: 'absent', message: read.message };
    return { ok: false, code: 'read-failed', message: read.message };
  }
  const parsed = parseRuntimeDocument(read.text);
  if (!parsed.ok) return { ok: false, code: 'invalid', message: parsed.message };
  return { ok: true, document: parsed.document };
}

/** Deterministic serialization: fixed key order, 2-space indent, trailing newline. */
export function serializeRuntimeDocument(document: RuntimeDocument): string {
  const surfaces = document.surfaces.map((s) => {
    const out: Record<string, unknown> = {
      surfaceId: s.surfaceId,
      locator: s.locator,
      serviceUid: s.serviceUid,
      forbiddenRoots: [...s.forbiddenRoots],
      configurationIdentity: s.configurationIdentity,
      configurationVersion: s.configurationVersion,
      limitProfile: { ...s.limitProfile },
    };
    if (s.workspaces !== undefined) {
      out['workspaces'] = s.workspaces.map((w) => {
        const wo: Record<string, unknown> = { workspaceId: w.workspaceId, root: w.root };
        if (w.artifactLocation !== undefined) wo['artifactLocation'] = w.artifactLocation;
        return wo;
      });
    }
    if (s.gitPath !== undefined) out['gitPath'] = s.gitPath;
    if (s.gitHome !== undefined) out['gitHome'] = s.gitHome;
    if (s.gitTmpdir !== undefined) out['gitTmpdir'] = s.gitTmpdir;
    return out;
  });
  return `${JSON.stringify({ surfaces }, null, 2)}\n`;
}
