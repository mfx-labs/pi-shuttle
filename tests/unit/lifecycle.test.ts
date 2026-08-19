/**
 * PS-4 focused tests: `project add | list | remove` — canonicalization,
 * deterministic identity, Gateway bootstrap composition (fake Gateway CLI),
 * transactional registration, idempotence, deregister-only remove, re-add
 * store reuse, failure/residual semantics, and concurrency.
 *
 * F-01 correction: every project command now gates on a RECONCILED
 * Manifest-Native Installation Receipt Schema 1 (the manifest-native
 * lifecycle resolver); the previous-generation install.json receipt is
 * never consulted. All fixtures below materialize a valid manifest-native
 * namespace whose Gateway bin is the bootstrap-capable fake CLI, and pass
 * the paired fixture resolver seam. Clean/malformed-state and legacy
 * install.json-bait cases are asserted explicitly (anti-regression).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRuntimeDocument } from '../../src/config/document.js';
import { canonicalizePath, resolveLayout, resolveManifestNativeLayout } from '../../src/host/environment.js';
import { deriveStoreId, deriveStoreLocator, deriveSurfaceId, deriveWorkspaceId } from '../../src/registry/identity.js';
import { addProject, duplicateObjectRegistration, listProjects, removeProject } from '../../src/lifecycle/projects.js';
import type { OperatorContext } from '../../src/lifecycle/state.js';
import { cleanupEnv, FAKE_GATEWAY_SCRIPT, fixturePathEnv, makeEnv, makeNativeProjectEnv, makeProjectRoot, writeFakeGit } from '../helpers/lifecycle-fixtures.js';
import { nativeResolver } from '../helpers/manifest-native-fixtures.js';
import { buildInstallFixtureRelease, freshInstallDeps, installMetadataFetcher, runFreshInstall } from '../helpers/manifest-native-install-fixtures.js';
import { FIXTURE_NOW, fixtureVerifier } from '../helpers/release-trust-fixtures.js';

function contextFor(env: string, extraPathEnv: NodeJS.ProcessEnv = {}): OperatorContext {
  const layout = resolveLayout(env);
  return { env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv: fixturePathEnv(env, extraPathEnv) };
}

test('project add: valid manifest-native installation + project add registers (F-01 case A)', async () => {
  const { env, root, layout, ctx } = await makeNativeProjectEnv();
  try {
    const outcome = await addProject(ctx, root);
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.ok(outcome.stdout.includes(deriveWorkspaceId(root)), outcome.stdout);
    assert.ok(outcome.stdout.includes(root), outcome.stdout);
    assert.ok(outcome.stdout.includes(deriveStoreLocator(ctx.layout.shareDir, root)), outcome.stdout);
    assert.match(outcome.stdout, /state: +initialized/, outcome.stdout);
    // Registration is present in the authoritative runtime document.
    const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(read.ok, true, read.ok ? '' : read.message);
    if (!read.ok) return;
    assert.equal(read.document.surfaces.length, 1);
    const surface = read.document.surfaces[0]!;
    assert.equal(surface.surfaceId, deriveSurfaceId(root));
    assert.equal(surface.configurationIdentity.startsWith('sha-256:'), true);
    assert.equal(surface.workspaces?.[0]?.root, root);
    // SIR-PS4-001: the resolved artifactLocation must correlate exactly
    // with the path pi-shuttle prepared (`<canonicalRoot>/artifacts`).
    assert.equal(surface.workspaces?.[0]?.artifactLocation, join(root, 'artifacts'));
    // Operator-owned directories exist (locator parent 0700, git isolation, artifacts).
    assert.equal(existsSync(join(surface.locator, 'store-v1')), true);
    assert.equal(existsSync(surface.gitHome!), true);
    assert.equal(existsSync(surface.gitTmpdir!), true);
    assert.equal(existsSync(join(root, 'artifacts')), true);
    // No project-content mutation beyond the approved artifacts dir.
    assert.deepEqual(readdirSync(root).sort(), ['MARKER.txt', 'artifacts']);
    // F-01: the manifest-native receipt is the authority; install.json is absent.
    assert.equal(existsSync(join(layout.stateDir, 'install.json')), false, 'install.json must remain absent');
    assert.equal(existsSync(resolveManifestNativeLayout(env).receiptPath), true, 'Receipt Schema 1 must be present');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: relative input is canonicalized (cwd-relative)', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const prev = process.cwd();
    process.chdir(env);
    let outcome;
    try {
      outcome = await addProject(ctx, 'proj');
    } finally {
      process.chdir(prev);
    }
    assert.equal(outcome!.exitCode, 0, outcome!.stderr);
    const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.document.surfaces[0]?.workspaces?.[0]?.root, root);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: nonexistent path fails closed after the manifest-native gate', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const outcome = await addProject(ctx, join(env, 'does-not-exist'));
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-ROOT-UNRESOLVABLE'), outcome.stderr);
    assert.ok(outcome.stderr.includes('does not resolve'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: symlinked project root is canonicalized before identity derivation', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const real = makeProjectRoot(env, 'real-root');
    const link = join(env, 'link-root');
    symlinkSync(real, link);
    const outcome = await addProject(ctx, link);
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) {
      const surface = read.document.surfaces[0]!;
      // The canonical root is the identity input; the symlink path is not.
      assert.equal(surface.workspaces?.[0]?.root, real);
      assert.equal(surface.surfaceId, deriveSurfaceId(real));
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add: not-a-git-repository fails closed (read-only probe)', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    // A fake git that fails the rev-parse probe.
    const failGit = join(env, 'fail-bin');
    mkdirSync(failGit, { mode: 0o700 });
    writeFakeGit(failGit);
    writeFileSync(join(failGit, 'git'), `#!/usr/bin/env node
process.stderr.write('fatal: not a git repository\\n');
process.exit(128);
`, { mode: 0o700 });
    const ctx2 = { ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), PATH: `${failGit}:${ctx.pathEnv?.PATH ?? ''}` } } as OperatorContext;
    const outcome = await addProject(ctx2, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-ROOT-NOT-GIT'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add/remove/list: CLEAN manifest-native state fails closed (F-01 case D) — no install.json is requested', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    const ctx = contextFor(env);
    const add = await addProject(ctx, root);
    assert.equal(add.exitCode, 1);
    assert.ok(add.stderr.includes('ERR-MN-PROJECT-NO-INSTALLATION'), add.stderr);
    assert.ok(!add.stderr.includes('install.json'), add.stderr);
    const list = await listProjects(ctx);
    assert.equal(list.exitCode, 1);
    assert.ok(list.stderr.includes('ERR-MN-PROJECT-NO-INSTALLATION'), list.stderr);
    const remove = await removeProject(ctx, deriveWorkspaceId(root));
    assert.equal(remove.exitCode, 1);
    assert.ok(remove.stderr.includes('ERR-MN-PROJECT-NO-INSTALLATION'), remove.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add/list/remove: malformed manifest-native state fails closed (F-01 case E)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    const mnLayout = resolveManifestNativeLayout(env);
    mkdirSync(mnLayout.authorityRoot, { recursive: true, mode: 0o700 });
    writeFileSync(mnLayout.receiptPath, 'not-json{{{', { mode: 0o600 });
    const ctx = contextFor(env);
    for (const [name, run] of [
      ['add', async () => addProject(ctx, root)],
      ['list', async () => listProjects(ctx)],
      ['remove', async () => removeProject(ctx, deriveWorkspaceId(root))],
    ] as const) {
      const outcome = await run();
      assert.equal(outcome.exitCode, 1, name);
      assert.ok(outcome.stderr.includes('ERR-MN-PROJECT-STATE-MALFORMED'), `${name}: ${outcome.stderr}`);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add: legacy install.json bait is ignored; manifest-native is the authority (F-01 case F)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    // Garbage-free but valid previous-generation install.json bait, with
    // NO manifest-native installation.
    const layout = resolveLayout(env);
    mkdirSync(layout.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.installReceiptPath, JSON.stringify({
      receiptVersion: 1, piShuttleVersion: '0.1.4', channel: 'stable',
      sourceIdentity: 'mfx-labs/pi-shuttle@' + 'a'.repeat(40), piShuttleInstallPath: layout.shareDir,
      piShuttleTreeSha256: 'a'.repeat(64), installedAt: '2026-01-01T00:00:00.000Z', result: 'COMPLETE',
      platformLane: 'linux-x86_64-posix-utf8-node22', installDir: layout.shareDir, binDir: layout.binDir,
      components: { gateway: { status: 'installed-verified', version: '0.1.0', commit: 'a'.repeat(40), commitVerified: false, digestVerified: false, artifactSha256: 'a'.repeat(64), installPath: join(layout.shareDir, 'gw'), binPath: join(layout.shareDir, 'gw', 'bin.js'), smoke: 'passed' }, piGuard: null },
      omitted: ['pi-guard'], notes: [],
    }, null, 2) + '\n', { mode: 0o600 });
    const ctx = contextFor(env);
    // (a) bait alone → still fails (no manifest-native installation).
    const withBaitOnly = await addProject(ctx, root);
    assert.equal(withBaitOnly.exitCode, 1, withBaitOnly.stderr);
    assert.ok(withBaitOnly.stderr.includes('ERR-MN-PROJECT-NO-INSTALLATION'), withBaitOnly.stderr);
    assert.ok(!withBaitOnly.stderr.includes('ERR-PS4-RECEIPT-ABSENT'), withBaitOnly.stderr);

    // (b) valid manifest-native installation + bait left in place → uses
    //     manifest-native and ignores the legacy file.
    const { env: env2, ctx: ctx2 } = await makeNativeProjectEnv();
    try {
      const root2 = makeProjectRoot(env2, 'proj2');
      // Replant the same bait under the valid env.
      const layout2 = resolveLayout(env2);
      mkdirSync(layout2.stateDir, { recursive: true, mode: 0o700 });
      writeFileSync(layout2.installReceiptPath, '{"bait":"legacy","should":"be-ignored"}\n', { mode: 0o600 });
      const outcome = await addProject(ctx2, root2);
      assert.equal(outcome.exitCode, 0, outcome.stderr);
      const list = await listProjects(ctx2);
      assert.equal(list.exitCode, 0, list.stderr);
      assert.ok(list.stdout.includes(deriveWorkspaceId(root2)), list.stdout);
    } finally {
      cleanupEnv(env2);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add: duplicate-object guard — identical spelling and distinct objects pass; same object under a different spelling is refused (PS6-MAC-001, pure)', async () => {
  const env = makeEnv();
  try {
    const a = makeProjectRoot(env, 'alpha');
    const b = makeProjectRoot(env, 'beta');
    assert.equal(duplicateObjectRegistration(a, [a]), null, 'identical spelling is the normal replay path');
    assert.equal(duplicateObjectRegistration(a, []), null, 'no registrations → no duplicate');
    assert.equal(duplicateObjectRegistration(a, [b]), null, 'distinct objects → no duplicate');
    assert.equal(duplicateObjectRegistration(join(env, 'absent'), [a]), null, 'unobservable candidate → no duplicate (never fatal)');
    // Defense in depth: a symlink to the same object is detected by
    // object identity (production canonicalizes symlinks first, so this is
    // the fail-closed backstop).
    const link = join(env, 'alias');
    symlinkSync(a, link);
    assert.equal(duplicateObjectRegistration(link, [a]), a, 'same object via symlink spelling → duplicate detected');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: case-variant spelling of a registered project fails closed with one registration (PS6-MAC-001, darwin)', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('case-variant duplicate-object evidence requires a case-insensitive darwin volume; running on ' + process.platform);
    return;
  }
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const root = makeProjectRoot(env, 'Project');
    const first = await addProject(ctx, root);
    assert.equal(first.exitCode, 0, first.stderr);
    const variant = join(env, 'project');
    if (canonicalizePath(variant) === null) {
      t.diagnostic(`volume at ${env} is case-sensitive: 'project' does not resolve to 'Project'; variant-duplicate assertion skipped`);
      t.skip('case-sensitive volume; variant duplicate not applicable');
      return;
    }
    const second = await addProject(ctx, variant);
    assert.equal(second.exitCode, 1, second.stderr);
    assert.ok(second.stderr.includes('ERR-PS4-REG-DUPLICATE-OBJECT'), second.stderr);
    assert.ok(second.stderr.includes('same filesystem object'), second.stderr);
    const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.document.surfaces.length, 1, 'one filesystem object ⇒ exactly one registration');
    assert.equal(readdirSync(ctx.layout.storesDir).length, 1, 'no duplicate store authority created');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: unsupported platform (windows) exits 2 before any Gateway work', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const ctxWin = { ...ctx, env: { home: env, platform: 'win32', arch: 'x64' } };
    const outcome = await addProject(ctxWin, makeProjectRoot(env, 'proj-win'));
    assert.equal(outcome.exitCode, 2);
    assert.ok(outcome.stderr.includes('ERR-PS4-PREFLIGHT-PLATFORM'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: both descriptor-bound Darwin targets pass shared platform preflight and reach the manifest-native gate', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    const baseContext = contextFor(env);
    for (const arch of ['x64', 'arm64']) {
      const ctx = { ...baseContext, env: { home: env, platform: 'darwin', arch } };
      const outcome = await addProject(ctx, root);
      assert.equal(outcome.exitCode, 1, `darwin/${arch} must reach the later manifest-native gate`);
      assert.ok(outcome.stderr.includes('ERR-MN-PROJECT-NO-INSTALLATION'), outcome.stderr);
      assert.ok(!outcome.stderr.includes('ERR-PS4-PREFLIGHT-PLATFORM'), outcome.stderr);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add: exact re-add is an idempotent no-op (same identity, one registry entry, byte-identical replay)', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const first = await addProject(ctx, root);
    assert.equal(first.exitCode, 0, first.stderr);
    const readAfterFirst = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(readAfterFirst.ok, true);
    const surface1 = readAfterFirst.ok ? readAfterFirst.document.surfaces[0]! : null;

    const second = await addProject(ctx, root);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.ok(second.stdout.includes('already registered'), second.stdout);
    const readAfterSecond = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(readAfterSecond.ok, true);
    if (readAfterFirst.ok && readAfterSecond.ok) {
      assert.equal(readAfterSecond.document.surfaces.length, 1);
      assert.equal(readAfterSecond.document.surfaces[0]!.configurationIdentity, surface1!.configurationIdentity);
      assert.equal(readAfterSecond.document.surfaces[0]!.locator, surface1!.locator);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add: Gateway bootstrap failure is typed and changes no registry state', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const ctxF = { ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), FIXTURE_GATEWAY_MODE: 'exit1' } };
    const outcome = await addProject(ctxF, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-FAILED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('ERR-FIXTURE'), outcome.stderr);
    assert.ok(!existsSync(join(resolveLayout(env).runtimeConfigPath)), 'no registration may be persisted');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: malformed Gateway output fails closed (no registration)', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const ctxF = { ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), FIXTURE_GATEWAY_MODE: 'malformed' } };
    const outcome = await addProject(ctxF, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-OUTPUT'), outcome.stderr);
    assert.ok(!existsSync(resolveLayout(env).runtimeConfigPath));
  } finally {
    cleanupEnv(env);
  }
});

test('project add: Gateway success without resolved output fails closed', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const ctxF = { ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), FIXTURE_GATEWAY_MODE: 'no-output' } };
    const outcome = await addProject(ctxF, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-OUTPUT'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: mismatched resolved root/workspace fails closed with residual truthfulness', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const ctxF = { ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), FIXTURE_GATEWAY_MODE: 'mismatch' } };
    const outcome = await addProject(ctxF, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-MISMATCH'), outcome.stderr);
    assert.ok(outcome.stderr.includes('workspace root mismatch'), outcome.stderr);
    assert.ok(outcome.stderr.includes('preserved'), outcome.stderr);
    assert.ok(!existsSync(resolveLayout(env).runtimeConfigPath));
  } finally {
    cleanupEnv(env);
  }
});

test('project add: bootstrap succeeds but registry persistence fails → residual reported truthfully, store preserved', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const layout = resolveLayout(env);
    // Block the runtime document with a directory at its path: the
    // transactional writer fails closed before any publish.
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    mkdirSync(layout.runtimeConfigPath, { mode: 0o700 });
    const outcome = await addProject(ctx, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-REGISTER-FAILED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('PRESERVED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('re-run'), outcome.stderr);
    const locator = deriveStoreLocator(layout.shareDir, root);
    assert.equal(existsSync(join(locator, 'store-v1')), true);
  } finally {
    cleanupEnv(env);
  }
});

test('project list: empty registry is a successful valid state under a valid installation (F-01 case B)', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const outcome = await listProjects(ctx);
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.equal(outcome.stdout, 'no registered projects\n');
    assert.equal(outcome.stderr, '');
  } finally {
    cleanupEnv(env);
  }
});

test('project list: one and multiple projects with deterministic order; no subprocess needed', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const rootA = makeProjectRoot(env, 'proj-a');
    const rootB = makeProjectRoot(env, 'proj-b');
    assert.equal((await addProject(ctx, rootA)).exitCode, 0);
    assert.equal((await addProject(ctx, rootB)).exitCode, 0);

    const one = await listProjects(ctx);
    // PATH with NO executables proves list never spawns a subprocess.
    const noExec = await listProjects({ ...ctx, pathEnv: { PATH: '' } });
    assert.equal(noExec.exitCode, 0, noExec.stderr);
    assert.ok(noExec.stdout.includes(deriveWorkspaceId(rootA)));
    assert.ok(noExec.stdout.includes(rootA));
    assert.ok(noExec.stdout.includes(deriveWorkspaceId(rootB)));

    const lines = one.stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    const sorted = [deriveSurfaceId(rootA), deriveSurfaceId(rootB)].sort();
    assert.equal(lines[0]!.includes(sorted[0]!), true);
    assert.equal(lines[1]!.includes(sorted[1]!), true);
    for (const line of lines) {
      assert.match(line, /^pgw:w:[0-9a-f]{32}  \/.*  surface pgw-[0-9a-f]{32}  store \//);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project list: invalid runtime document fails closed with a typed error', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const layout = resolveLayout(env);
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, '{"foreign": true}', { mode: 0o600 });
    const outcome = await listProjects(ctx);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-LIST-INVALID'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project remove: by workspace id — deregisters only; store, project, and history remain (F-01 case C)', async () => {
  const { env, ctx, root } = await makeNativeProjectEnv();
  try {
    assert.equal((await addProject(ctx, root)).exitCode, 0);
    const layout = resolveLayout(env);
    const locator = deriveStoreLocator(layout.shareDir, root);

    const outcome = await removeProject(ctx, deriveWorkspaceId(root));
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.ok(outcome.stdout.includes(`deregistered ${deriveWorkspaceId(root)}`), outcome.stdout);
    assert.ok(outcome.stdout.includes(`preserved at ${locator}`), outcome.stdout);

    const read = readRuntimeDocument(layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.document.surfaces.length, 0);
    assert.equal(existsSync(join(locator, 'store-v1', 'metadata.json')), true);
    assert.equal(existsSync(join(root, 'MARKER.txt')), true);
    assert.equal(existsSync(join(root, 'artifacts')), true);
  } finally {
    cleanupEnv(env);
  }
});

test('project remove: by canonical path and by surface id; unknown target fails closed', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const rootA = makeProjectRoot(env, 'proj-a');
    const rootB = makeProjectRoot(env, 'proj-b');
    assert.equal((await addProject(ctx, rootA)).exitCode, 0);
    assert.equal((await addProject(ctx, rootB)).exitCode, 0);
    const layout = resolveLayout(env);

    const byPath = await removeProject(ctx, rootA);
    assert.equal(byPath.exitCode, 0, byPath.stderr);
    const read1 = readRuntimeDocument(layout.runtimeConfigPath);
    if (read1.ok) assert.equal(read1.document.surfaces.length, 1);

    const bySurface = await removeProject(ctx, deriveSurfaceId(rootB));
    assert.equal(bySurface.exitCode, 0, bySurface.stderr);
    const read2 = readRuntimeDocument(layout.runtimeConfigPath);
    if (read2.ok) assert.equal(read2.document.surfaces.length, 0);

    const unknown = await removeProject(ctx, 'pgw:w:ffffffffffffffffffffffffffffffff');
    assert.equal(unknown.exitCode, 1);
    assert.ok(unknown.stderr.includes('ERR-PS2-REG-NOT-FOUND'), unknown.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project remove: deregister → re-add reuses the same store and identity (replay verification)', async () => {
  const { env, ctx, root } = await makeNativeProjectEnv();
  try {
    assert.equal((await addProject(ctx, root)).exitCode, 0);
    const layout = resolveLayout(env);
    const locator = deriveStoreLocator(layout.shareDir, root);
    assert.equal(existsSync(join(locator, 'store-v1', 'metadata.json')), true);

    assert.equal((await removeProject(ctx, deriveWorkspaceId(root))).exitCode, 0);
    assert.equal(existsSync(join(locator, 'store-v1', 'metadata.json')), true);

    const readd = await addProject(ctx, root);
    assert.equal(readd.exitCode, 0, readd.stderr);
    assert.match(readd.stdout, /state: +verification-replay/, readd.stdout);
    const read = readRuntimeDocument(layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.document.surfaces.length, 1);
      assert.equal(read.document.surfaces[0]!.locator, locator);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add/list/remove: existing registered-project workflow under a valid installation (F-01 case G); project filesystem content never deleted', async () => {
  const { env, ctx, root } = await makeNativeProjectEnv();
  try {
    const marker = join(root, 'MARKER.txt');
    assert.equal(existsSync(marker), true);
    const add = await addProject(ctx, root);
    assert.equal(add.exitCode, 0, add.stderr);
    const list1 = await listProjects(ctx);
    assert.equal(list1.exitCode, 0, list1.stderr);
    assert.ok(list1.stdout.includes(deriveWorkspaceId(root)), list1.stdout);
    const remove = await removeProject(ctx, deriveWorkspaceId(root));
    assert.equal(remove.exitCode, 0, remove.stderr);
    const list2 = await listProjects(ctx);
    assert.equal(list2.exitCode, 0, list2.stderr);
    assert.equal(list2.stdout, 'no registered projects\n');
    // Project filesystem content is untouched across add/list/remove.
    assert.equal(existsSync(marker), true, 'project content must survive');
    assert.equal(existsSync(join(root, 'artifacts')), true, 'artifacts dir survives (deregister only)');
  } finally {
    cleanupEnv(env);
  }
});

test('project remove: concurrent add/remove serialize via the operation lock (slow bootstrap)', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    const root = makeProjectRoot(env, 'slow-proj');
    const layout = resolveLayout(env);
    const lockPath = join(layout.stateDir, 'project.lock');
    // Register once so the competing remove is meaningful.
    assert.equal((await addProject(ctx, root)).exitCode, 0);
    // Re-add with a slow Gateway bootstrap: project.lock is held across the
    // entire add (bootstrap + registry finalization).
    const ctxSlow = { ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), FIXTURE_GATEWAY_MODE: 'slow' } };
    const slowAdd = addProject(ctxSlow, root);
    let held = false;
    for (let i = 0; i < 100 && !held; i++) {
      held = existsSync(lockPath);
      if (!held) await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(held, true, 'the slow add must hold project.lock');
    const removed = await removeProject(ctx, root);
    assert.equal(removed.exitCode, 1, removed.stderr);
    assert.ok(removed.stderr.includes('ERR-PS4-BUSY'), removed.stderr);
    assert.ok(removed.stderr.includes('project.lock'), removed.stderr);
    assert.ok(removed.stderr.includes('stale lock'), removed.stderr);
    const add = await slowAdd;
    assert.equal(add.exitCode, 0, add.stderr);
    assert.ok(add.stdout.includes('already registered'), add.stdout);
    const read = readRuntimeDocument(layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.document.surfaces.length, 1, 'exactly one registration survives');
      assert.equal(read.document.surfaces[0]!.locator, deriveStoreLocator(layout.shareDir, root));
    }
    assert.equal(existsSync(lockPath), false, 'project.lock must be released at terminal state');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: two distinct projects both register with no lost registration (multi-project coexistence)', async () => {
  const { env, ctx } = await makeNativeProjectEnv();
  try {
    // Concurrent registration requires separate processes (acquireLock
    // retries with blocking sleepSync, which is a per-process busywait — a
    // same-process concurrent peer is starved). The meaningful invariant —
    // distinct projects coexist with both registrations present — is
    // asserted here; the lock-serialization/BUSY property is covered by the
    // dedicated slow-bootstrap concurrency test above.
    const rootA = makeProjectRoot(env, 'proj-a');
    const rootB = makeProjectRoot(env, 'proj-b');
    const first = await addProject(ctx, rootA);
    assert.equal(first.exitCode, 0, first.stderr);
    const second = await addProject(ctx, rootB);
    assert.equal(second.exitCode, 0, second.stderr);
    const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.equal(read.document.surfaces.length, 2, 'both registrations survive');
      const roots = new Set(read.document.surfaces.flatMap((s) => (s.workspaces ?? []).map((w) => w.root)));
      assert.equal(roots.has(rootA), true);
      assert.equal(roots.has(rootB), true);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add: resolved artifactLocation mismatch fails closed (inside-root and outside-root), residual store preserved', async () => {
  const { env, root, ctx } = await makeNativeProjectEnv();
  try {
    const layout = resolveLayout(env);
    const locator = deriveStoreLocator(layout.shareDir, root);
    for (const artifact of [join(root, 'artifacts-other'), join(env, 'outside-artifacts')]) {
      const outcome = await addProject({ ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), FIXTURE_GATEWAY_ARTIFACT: artifact } }, root);
      assert.equal(outcome.exitCode, 1, outcome.stderr);
      assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-MISMATCH'), outcome.stderr);
      assert.ok(outcome.stderr.includes('artifactLocation mismatch'), outcome.stderr);
      assert.ok(outcome.stderr.includes('preserved'), outcome.stderr);
      assert.ok(!existsSync(layout.runtimeConfigPath), 'no registration may be persisted');
      assert.equal(existsSync(join(locator, 'store-v1')), true, 'Gateway-created trusted-store residual must be preserved');
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add: healthy env via real CLI-equivalent path (black-box operand) — next-step command (F-01 case H)', async () => {
  // The production manifest-native resolver cannot verify fixture-signed
  // chains, so the headline next-step is exercised against the RECONCILED
  // Receipt Schema 1 installation produced by the manifest-native
  // materializer (the smallest isolated release/fresh-install seam),
  // through the identical production addProject/listProjects/removeProject
  // entry points and the paired fixture resolver. install.json is absent.
  const { env, root, layout, ctx, pathEnv } = await makeNativeProjectEnv();
  try {
    assert.equal(existsSync(join(layout.stateDir, 'install.json')), false, 'clean install must not write install.json');
    // Next-step command (the installer advertises `pi-shuttle project add <path>`).
    const add = await addProject(ctx, root);
    assert.equal(add.exitCode, 0, add.stderr);
    assert.equal(add.stdout.includes('registered project'), true, add.stdout);
    void pathEnv;
    const list = await listProjects(ctx);
    assert.equal(list.exitCode, 0, list.stderr);
    assert.ok(list.stdout.includes(deriveWorkspaceId(root)), list.stdout);
    const remove = await removeProject(ctx, deriveWorkspaceId(root));
    assert.equal(remove.exitCode, 0, remove.stderr);
    assert.equal(existsSync(join(layout.stateDir, 'install.json')), false, 'install.json remains absent throughout');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: installer next-step E2E — real manifest-native fresh install → no install.json → project add/list/remove (F-01 case H)', async () => {
  const home = makeEnv();
  try {
    const verifier = fixtureVerifier(FIXTURE_NOW);
    const release = await buildInstallFixtureRelease({}, FAKE_GATEWAY_SCRIPT);
    // Clean manifest-native fresh install through the real orchestrator.
    const installOutcome = await runFreshInstall(home, release, freshInstallDeps(verifier, installMetadataFetcher(release)));
    assert.equal(installOutcome.kind, 'INSTALLED', JSON.stringify(installOutcome));
    const layout = resolveLayout(home);
    assert.equal(existsSync(join(layout.stateDir, 'install.json')), false, 'clean install must not write install.json');
    assert.equal(existsSync(resolveManifestNativeLayout(home).receiptPath), true, 'Receipt Schema 1 must be present after install');
    // Execute exactly the installer next-step command: project add on a real temporary Git project.
    const ctx: OperatorContext = {
      env: { home, platform: 'linux', arch: 'x64' },
      layout,
      nodeExecutable: process.execPath,
      pathEnv: fixturePathEnv(home, { HOME: home }),
      resolveManifestNative: nativeResolver(verifier),
    };
    const root = makeProjectRoot(home, 'proj-h');
    const add = await addProject(ctx, root);
    assert.equal(add.exitCode, 0, add.stderr);
    const list = await listProjects(ctx);
    assert.equal(list.exitCode, 0, list.stderr);
    assert.ok(list.stdout.includes(deriveWorkspaceId(root)), list.stdout);
    const remove = await removeProject(ctx, deriveWorkspaceId(root));
    assert.equal(remove.exitCode, 0, remove.stderr);
    assert.equal(existsSync(join(layout.stateDir, 'install.json')), false, 'install.json stays absent through the whole workflow');
  } finally {
    cleanupEnv(home);
  }
});
