/**
 * Project registry data model (PS-2): PURE state transitions over the
 * operator runtime document. No filesystem, no subprocess, no Gateway
 * interaction — the operational `project add/list/remove` lifecycle (which
 * canonicalizes roots, invokes the Gateway bootstrap verb, and persists)
 * is owned by PS-4 and will use these primitives.
 *
 * remove = DEREGISTER ONLY (product decision, operator-cli-contract §5):
 * this model can never delete a project directory, Git history, a Gateway
 * trusted store, or any lifecycle record — it has no such capability and
 * holds no such reference beyond the surface's opaque `locator` string.
 */
import type { RuntimeDocument, SurfaceConfig } from '../config/document.js';

export type RegistryResult<T> = { readonly ok: true; readonly value: T; readonly changed: boolean } | { readonly ok: false; readonly code: string; readonly message: string };

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function sameLimitProfile(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i] || a[ka[i]!] !== b[ka[i]!]) return false;
  }
  return true;
}

/** Deep structural equality of two surfaces (for idempotent exact re-registration). */
export function surfaceEqual(a: SurfaceConfig, b: SurfaceConfig): boolean {
  if (a.surfaceId !== b.surfaceId || a.locator !== b.locator || a.serviceUid !== b.serviceUid || a.configurationIdentity !== b.configurationIdentity || a.configurationVersion !== b.configurationVersion) return false;
  if (!sameStringSet(a.forbiddenRoots, b.forbiddenRoots)) return false;
  if (!sameLimitProfile(a.limitProfile, b.limitProfile)) return false;
  if ((a.workspaces === undefined) !== (b.workspaces === undefined)) return false;
  if (a.workspaces !== undefined && b.workspaces !== undefined) {
    if (a.workspaces.length !== b.workspaces.length) return false;
    for (let i = 0; i < a.workspaces.length; i++) {
      const wa = a.workspaces[i]!;
      const wb = b.workspaces[i]!;
      if (wa.workspaceId !== wb.workspaceId || wa.root !== wb.root || wa.artifactLocation !== wb.artifactLocation) return false;
    }
  }
  if (a.gitPath !== b.gitPath || a.gitHome !== b.gitHome || a.gitTmpdir !== b.gitTmpdir) return false;
  return true;
}

/**
 * Register one surface. Idempotent exact re-registration is a no-op;
 * conflicting registrations (same surfaceId, same store locator, or same
 * workspace identity) fail closed — equivalent canonical roots derive the
 * same storeId/locator/workspaceId, so duplicate-by-equivalent-path is
 * rejected here by construction.
 */
export function registerSurface(document: RuntimeDocument, surface: SurfaceConfig): RegistryResult<RuntimeDocument> {
  const existing = document.surfaces.find((s) => s.surfaceId === surface.surfaceId);
  if (existing !== undefined) {
    if (surfaceEqual(existing, surface)) return { ok: true, value: document, changed: false };
    return { ok: false, code: 'ERR-PS2-REG-DUPLICATE-SURFACE', message: `surfaceId is already registered: ${surface.surfaceId}` };
  }
  const sameLocator = document.surfaces.find((s) => s.locator === surface.locator);
  if (sameLocator !== undefined) {
    return { ok: false, code: 'ERR-PS2-REG-DUPLICATE-STORE', message: `a surface is already registered for store locator ${surface.locator}` };
  }
  const sameWorkspace = surface.workspaces?.find((w) =>
    document.surfaces.some((s) => s.workspaces?.some((ow) => ow.workspaceId === w.workspaceId)),
  );
  if (sameWorkspace !== undefined) {
    return { ok: false, code: 'ERR-PS2-REG-DUPLICATE-WORKSPACE', message: `workspaceId is already registered: ${sameWorkspace.workspaceId}` };
  }
  return { ok: true, value: { surfaces: [...document.surfaces, surface] }, changed: true };
}

/**
 * Deregister one surface by surfaceId, workspaceId, or canonical root path
 * (the target must already be canonical — PS-4 canonicalizes operator input
 * before calling). Deregistration ONLY removes the registration entry;
 * stores, project directories, and Git history are never referenced for
 * deletion. Unknown target fails closed.
 */
export function deregisterSurface(document: RuntimeDocument, target: string): RegistryResult<RuntimeDocument> {
  const index = document.surfaces.findIndex((s) =>
    s.surfaceId === target ||
    s.workspaces?.some((w) => w.workspaceId === target) ||
    s.workspaces?.some((w) => w.root === target),
  );
  if (index < 0) {
    return { ok: false, code: 'ERR-PS2-REG-NOT-FOUND', message: `no registered project matches: ${target}` };
  }
  return { ok: true, value: { surfaces: document.surfaces.filter((_, i) => i !== index) }, changed: true };
}

/** Deterministic listing: locale-independent code-unit ordering by surfaceId. */
export function listSurfaces(document: RuntimeDocument): readonly SurfaceConfig[] {
  return [...document.surfaces].sort((a, b) => (a.surfaceId < b.surfaceId ? -1 : a.surfaceId > b.surfaceId ? 1 : 0));
}
