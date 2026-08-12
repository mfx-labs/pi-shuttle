/**
 * PS-2 focused tests: deterministic project identity derivation and the
 * pure registry state transitions (register/deregister/list).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { deriveStoreId, deriveStoreLocator, deriveWorkspaceId } from '../../src/registry/identity.js';
import { deregisterSurface, listSurfaces, registerSurface } from '../../src/registry/model.js';
import type { RuntimeDocument, SurfaceConfig } from '../../src/config/document.js';

const IDENTITY = 'sha-256:' + 'a'.repeat(64);

function surface(surfaceId: string, overrides: Record<string, unknown> = {}): SurfaceConfig {
  return {
    surfaceId,
    locator: `/store/${surfaceId}`,
    serviceUid: 1000,
    forbiddenRoots: [],
    configurationIdentity: IDENTITY,
    configurationVersion: '2',
    limitProfile: {},
    ...overrides,
  } as SurfaceConfig;
}

function doc(surfaces: SurfaceConfig[]): RuntimeDocument {
  return { surfaces };
}

test('identity: workspaceId/storeId follow the approved contract formula', () => {
  const root = '/home/operator/projects/gateway';
  const expectedStoreId = createHash('sha256').update(root, 'utf8').digest('hex').slice(0, 32);
  assert.equal(deriveStoreId(root), expectedStoreId);
  assert.equal(deriveWorkspaceId(root), `pgw:w:${expectedStoreId}`);
  assert.match(deriveWorkspaceId(root), /^pgw:w:[0-9a-f]{32}$/);
  assert.match(deriveStoreId(root), /^[0-9a-f]{32}$/);
  // Deterministic across calls and across distinct-but-identical inputs.
  assert.equal(deriveStoreId(root), deriveStoreId(root));
  assert.equal(deriveWorkspaceId(root), deriveWorkspaceId(root));
  // Distinct canonical roots never collide on the 32-hex prefix.
  const other = deriveStoreId(`${root}-other`);
  assert.notEqual(other, deriveStoreId(root));
  // Store locator = <shareDir>/stores/<storeId> (approved layout).
  assert.equal(deriveStoreLocator('/home/operator/.local/share/pi-shuttle', root), join('/home/operator/.local/share/pi-shuttle', 'stores', expectedStoreId));
});

test('registry: register appends and exact re-registration is an idempotent no-op', () => {
  const s = surface('main');
  const first = registerSurface(doc([]), s);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.changed, true);
  assert.equal(first.value.surfaces.length, 1);
  const again = registerSurface(first.value, s);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.changed, false, 'exact re-registration must be a no-op');
  assert.equal(again.value, first.value, 'no-op must not allocate a new document');
});

test('registry: conflicting registrations fail closed', () => {
  const s = surface('main');
  const base = doc([s]);
  // Same surfaceId with different content.
  const conflictId = registerSurface(base, surface('main', { configurationVersion: '9' }));
  assert.equal(conflictId.ok, false);
  if (!conflictId.ok) assert.equal(conflictId.code, 'ERR-PS2-REG-DUPLICATE-SURFACE');
  // Same store locator under a different surfaceId (equivalent canonical root).
  const conflictStore = registerSurface(base, surface('other', { locator: s.locator }));
  assert.equal(conflictStore.ok, false);
  if (!conflictStore.ok) assert.equal(conflictStore.code, 'ERR-PS2-REG-DUPLICATE-STORE');
  // Same workspace identity under a different surface.
  const conflictWorkspace = registerSurface(base, surface('other', { workspaces: [{ workspaceId: 'pgw:w:same', root: '/r' }] }));
  assert.equal(conflictWorkspace.ok, true);
  if (!conflictWorkspace.ok) return;
  const conflictWs2 = registerSurface(conflictWorkspace.value, surface('third', { workspaces: [{ workspaceId: 'pgw:w:same', root: '/r2' }] }));
  assert.equal(conflictWs2.ok, false);
  if (!conflictWs2.ok) assert.equal(conflictWs2.code, 'ERR-PS2-REG-DUPLICATE-WORKSPACE');
});

test('registry: deterministic list ordering by surfaceId', () => {
  const d = doc([surface('zebra'), surface('alpha'), surface('Mike')]);
  const listed = listSurfaces(d);
  assert.deepEqual(listed.map((s) => s.surfaceId), ['Mike', 'alpha', 'zebra'], 'code-unit ordering, locale-independent');
});

test('registry: deregister removes only the registration (deregister-only semantics)', () => {
  const s1 = surface('main', { workspaces: [{ workspaceId: 'pgw:w:aaaa', root: '/proj/one' }] });
  const s2 = surface('second', { workspaces: [{ workspaceId: 'pgw:w:bbbb', root: '/proj/two' }] });
  const d = doc([s1, s2]);
  // By workspaceId.
  const byWorkspace = deregisterSurface(d, 'pgw:w:aaaa');
  assert.equal(byWorkspace.ok, true);
  if (!byWorkspace.ok) return;
  assert.deepEqual(byWorkspace.value.surfaces.map((s) => s.surfaceId), ['second']);
  // By canonical root path.
  const byRoot = deregisterSurface(d, '/proj/two');
  assert.equal(byRoot.ok, true);
  if (!byRoot.ok) return;
  assert.deepEqual(byRoot.value.surfaces.map((s) => s.surfaceId), ['main']);
  // By surfaceId.
  const bySurfaceId = deregisterSurface(d, 'main');
  assert.equal(bySurfaceId.ok, true);
  if (!bySurfaceId.ok) return;
  assert.equal(bySurfaceId.value.surfaces.length, 1);
  // The model carries no store deletion capability: the removed surface's
  // store locator is an inert string and the operation is pure (no fs).
  assert.equal(s1.locator, '/store/main');
});

test('registry: deregister of an unknown project fails closed', () => {
  const result = deregisterSurface(doc([surface('main')]), '/not/registered');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-PS2-REG-NOT-FOUND');
});
