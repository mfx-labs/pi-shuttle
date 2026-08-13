/**
 * PS-6 APFS path-identity evidence tests (corrected after the real
 * macos-15 arm64 runner evidence — PS6-MAC-001).
 *
 * EMPIRICAL FACT (recorded from the Lane B runner, default APFS):
 * `realpath` on macOS preserves the INPUT spelling of the final path
 * component — it does NOT return the on-disk case, and it does NOT
 * normalize Unicode (NFC input stays NFC). Therefore case and Unicode
 * variant spellings of ONE directory produce DIFFERENT canonical strings
 * and DIFFERENT pi-shuttle identities. The product therefore enforces the
 * contract's fail-closed clause (operator-cli-contract §3: "no duplicate
 * registration (fail closed on conflicting registration of the same root
 * under a different identity)") with a dev+ino duplicate-object guard:
 * one filesystem object ⇒ exactly one registration.
 *
 * These tests exercise the EXISTING canonicalization model and the guard
 * — no case-folding or string normalization is implemented or asserted
 * anywhere.
 *
 * Lane classification:
 *  - symlink alias: host-independent (runs on every lane);
 *  - case variant: real default APFS evidence (darwin only). On a
 *    case-sensitive volume the variant spelling does not resolve — the
 *    volume fact is recorded truthfully and ONLY the case-alias assertion
 *    is skipped (never converted into a product failure);
 *  - Unicode NFC/NFD spelling: darwin only; same truthful skip policy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizePath } from '../../src/host/environment.js';
import { deriveStoreId, deriveSurfaceId, deriveWorkspaceId } from '../../src/registry/identity.js';
import { registerSurface } from '../../src/registry/model.js';
import { duplicateObjectRegistration } from '../../src/lifecycle/projects.js';
import type { SurfaceConfig } from '../../src/config/document.js';

function makeProjectDir(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { mode: 0o700 });
  return dir;
}

function surfaceFor(canonicalRoot: string, locator: string): SurfaceConfig {
  return {
    surfaceId: deriveSurfaceId(canonicalRoot),
    locator,
    serviceUid: 1000,
    forbiddenRoots: [canonicalRoot],
    configurationIdentity: `sha-256:${'0'.repeat(64)}`,
    configurationVersion: '2',
    limitProfile: {},
    workspaces: [{ workspaceId: deriveWorkspaceId(canonicalRoot), root: canonicalRoot }],
    gitPath: '/usr/bin/git',
    gitHome: `${locator}/git-home`,
    gitTmpdir: `${locator}/git-tmp`,
  };
}

test('PS6: symlink alias resolves to one canonical project and one identity (host-independent)', (t) => {
  const root = join(process.env.HOME ?? '/tmp', `.ps6-apfs-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(root, { mode: 0o700 });
    const project = makeProjectDir(root, 'Project');
    const alias = join(root, 'alias');
    symlinkSync(project, alias);

    const canonicalDirect = canonicalizePath(project);
    const canonicalAlias = canonicalizePath(alias);
    assert.notEqual(canonicalDirect, null);
    assert.notEqual(canonicalAlias, null);
    if (canonicalDirect === null || canonicalAlias === null) return;
    assert.equal(canonicalAlias, canonicalDirect, 'the symlink alias must canonicalize to the same path');
    assert.equal(canonicalAlias.startsWith(alias), false, 'the canonical spelling is the realpath spelling, not the alias path');

    // One identity from both spellings.
    assert.equal(deriveStoreId(canonicalAlias), deriveStoreId(canonicalDirect));
    assert.equal(deriveWorkspaceId(canonicalAlias), deriveWorkspaceId(canonicalDirect));
    assert.equal(deriveSurfaceId(canonicalAlias), deriveSurfaceId(canonicalDirect));

    // Registry dedupe: the second registration is an exact replay no-op.
    const locator = join(root, 'stores', deriveStoreId(canonicalDirect));
    const first = registerSurface({ surfaces: [] }, surfaceFor(canonicalDirect, locator));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.changed, true);
    const second = registerSurface(first.value, surfaceFor(canonicalAlias, locator));
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.changed, false, 're-adding through the alias must be an exact replay, never a duplicate registration');
    assert.equal(second.value.surfaces.length, 1, 'one canonical object ⇒ one registry surface');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PS6: case variant on default APFS — one filesystem object, at most one registration (PS6-MAC-001)', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('case-variant evidence requires real default APFS (darwin); running on ' + process.platform);
    return;
  }
  const root = join(process.env.HOME ?? '/tmp', `.ps6-apfs-case-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(root, { mode: 0o700 });
    const project = makeProjectDir(root, 'Project');
    const canonicalUpper = canonicalizePath(project);
    assert.notEqual(canonicalUpper, null);
    if (canonicalUpper === null) return;
    const lowerSpelling = join(root, 'project');
    const canonicalLower = canonicalizePath(lowerSpelling);

    if (canonicalLower === null) {
      // Case-sensitive volume: the variant spelling is a distinct/absent
      // entry. Record the volume fact truthfully and skip ONLY the
      // case-alias assertion — this is not a product failure.
      t.diagnostic(`volume at ${root} is case-sensitive: 'project' does not resolve to 'Project'; case-alias assertion skipped`);
      t.skip('volume is case-sensitive; case-alias assertion not applicable');
      return;
    }

    // One filesystem object: same device + inode across spellings.
    const stUpper = statSync(canonicalUpper);
    const stLower = statSync(canonicalLower);
    assert.equal(stLower.dev, stUpper.dev, 'same device');
    assert.equal(stLower.ino, stUpper.ino, 'same inode — one filesystem object');

    if (canonicalLower === canonicalUpper) {
      // (Uncommon) realpath normalized the spelling: one canonical string
      // ⇒ one identity directly.
      assert.equal(deriveStoreId(canonicalLower), deriveStoreId(canonicalUpper));
      assert.equal(duplicateObjectRegistration(canonicalUpper, [canonicalLower]), null, 'identical spelling is the normal replay path');
    } else {
      // Recorded empirical macOS default-APFS behavior (PS6-MAC-001):
      // realpath preserves the input spelling of the final component, so
      // the variant produces a different canonical string and a different
      // identity — and the product MUST fail closed before a duplicate
      // registration via the dev+ino duplicate-object guard.
      t.diagnostic(`realpath preserves input spelling on this APFS volume: '${canonicalLower}' vs '${canonicalUpper}' — duplicate-object guard is the fail-closed mechanism`);
      assert.notEqual(deriveStoreId(canonicalLower), deriveStoreId(canonicalUpper), 'variant spellings produce different identities (why the guard exists)');
      assert.equal(duplicateObjectRegistration(canonicalUpper, [canonicalLower]), canonicalLower, 'the already-registered variant spelling must be detected by object identity');
      assert.equal(duplicateObjectRegistration(canonicalLower, [canonicalUpper]), canonicalUpper, 'symmetrical detection');
      assert.equal(duplicateObjectRegistration(canonicalUpper, [canonicalUpper]), null, 'identical spelling is never a duplicate');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PS6: Unicode NFC/NFD spelling variants — one filesystem object, at most one registration (PS6-MAC-001)', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Unicode spelling evidence requires APFS name handling (darwin); running on ' + process.platform);
    return;
  }
  const root = join(process.env.HOME ?? '/tmp', `.ps6-apfs-unicode-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(root, { mode: 0o700 });
    // On-disk (NFD) spelling: "café" decomposed.
    const nfd = 'cafe\u0301';
    const project = makeProjectDir(root, nfd);
    const canonicalOnDisk = canonicalizePath(project);
    assert.notEqual(canonicalOnDisk, null);
    if (canonicalOnDisk === null) return;
    // NFC spelling: "café" composed — the same filesystem object.
    const nfc = 'caf\u00e9';
    const canonicalNfc = canonicalizePath(join(root, nfc));
    if (canonicalNfc === null) {
      t.diagnostic(`NFC spelling did not resolve at ${root}; Unicode-alias assertion skipped`);
      t.skip('NFC spelling not resolvable on this volume');
      return;
    }
    // One filesystem object across spellings.
    const stA = statSync(canonicalOnDisk);
    const stB = statSync(canonicalNfc);
    assert.equal(stB.dev, stA.dev, 'same device');
    assert.equal(stB.ino, stA.ino, 'same inode — one filesystem object');
    if (canonicalNfc === canonicalOnDisk) {
      assert.equal(deriveStoreId(canonicalNfc), deriveStoreId(canonicalOnDisk), 'one identity across Unicode spellings');
    } else {
      // Recorded empirical behavior: realpath preserves the input
      // normalization — the guard fails closed on the duplicate object.
      t.diagnostic(`realpath preserves input Unicode normalization on this APFS volume — duplicate-object guard is the fail-closed mechanism`);
      assert.notEqual(deriveStoreId(canonicalNfc), deriveStoreId(canonicalOnDisk));
      assert.equal(duplicateObjectRegistration(canonicalOnDisk, [canonicalNfc]), canonicalNfc);
    }
    // No string normalization is applied anywhere: the identity derives
    // from the canonical filesystem spelling only.
    assert.equal(existsSync(canonicalNfc), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
