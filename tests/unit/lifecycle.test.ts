/**
 * PS-4 focused tests: `project add | list | remove` — canonicalization,
 * deterministic identity, Gateway bootstrap composition (fake Gateway CLI),
 * transactional registration, idempotence, deregister-only remove, re-add
 * store reuse, failure/residual semantics, and concurrency.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRuntimeDocument } from '../../src/config/document.js';
import { resolveLayout } from '../../src/host/environment.js';
import { deriveStoreId, deriveStoreLocator, deriveSurfaceId, deriveWorkspaceId } from '../../src/registry/identity.js';
import { addProject, listProjects, removeProject } from '../../src/lifecycle/projects.js';
import type { OperatorContext } from '../../src/lifecycle/state.js';
import { cleanupEnv, fixturePathEnv, installFixtureGateway, makeEnv, makeProjectRoot, runCli, writeReceiptFixture, writeFakeGit } from '../helpers/lifecycle-fixtures.js';

function contextFor(env: string, extraPathEnv: NodeJS.ProcessEnv = {}): OperatorContext {
  const layout = resolveLayout(env);
  return { env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv: fixturePathEnv(env, extraPathEnv) };
}

test('project add: valid project registers with deterministic identity and a runtime config accepted by the model', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
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
  } finally {
    cleanupEnv(env);
  }
});

test('project add: relative input is canonicalized (real-CLI subprocess, cwd-relative)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env, 'proj');
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
    const runEnv = { ...ctx.pathEnv, HOME: env };
    const outcome = await runCli(['project', 'add', 'proj'], runEnv, { cwd: env });
    assert.equal(outcome.code, 0, outcome.stderr);
    const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.document.surfaces[0]?.workspaces?.[0]?.root, root);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: nonexistent path fails closed', async () => {
  const env = makeEnv();
  try {
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
    const outcome = await addProject(ctx, join(env, 'does-not-exist'));
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-ROOT-UNRESOLVABLE'), outcome.stderr);
    assert.ok(outcome.stderr.includes('does not resolve'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: symlinked project root is canonicalized before identity derivation', async () => {
  const env = makeEnv();
  try {
    const real = makeProjectRoot(env, 'real-root');
    const link = join(env, 'link-root');
    symlinkSync(real, link);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
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
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
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

test('project add: receipt gates — absent receipt, unverified gateway, no gateway entry', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    const ctx = contextFor(env);
    const absent = await addProject(ctx, root);
    assert.equal(absent.exitCode, 1);
    assert.ok(absent.stderr.includes('ERR-PS4-RECEIPT-ABSENT'), absent.stderr);

    writeReceiptFixture(env, { gateway: { status: 'installed-unverified', installPath: join(resolveLayout(env).packagesDir, 'project-gateway-artifact-core@0.1.0'), binPath: join(env, 'nope') } });
    const unverified = await addProject(ctx, root);
    assert.equal(unverified.exitCode, 1);
    assert.ok(unverified.stderr.includes('ERR-PS4-RECEIPT-GATEWAY-UNVERIFIED'), unverified.stderr);

    writeReceiptFixture(env, { gateway: null, piGuard: null, result: 'PARTIAL', omitted: ['project-gateway-mcp'] });
    const missing = await addProject(ctx, root);
    assert.equal(missing.exitCode, 1);
    assert.ok(missing.stderr.includes('ERR-PS4-RECEIPT-NO-GATEWAY'), missing.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: unsupported platform (macOS Intel) exits 2 before any Gateway work', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = { ...contextFor(env), env: { home: env, platform: 'darwin', arch: 'x64' } };
    const outcome = await addProject(ctx, root);
    assert.equal(outcome.exitCode, 2);
    assert.ok(outcome.stderr.includes('ERR-PS4-PREFLIGHT-PLATFORM'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: exact re-add is an idempotent no-op (same identity, one registry entry, byte-identical replay)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
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
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env, { FIXTURE_GATEWAY_MODE: 'exit1' });
    const outcome = await addProject(ctx, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-FAILED'), outcome.stderr);
    assert.ok(outcome.stderr.includes('ERR-FIXTURE'), outcome.stderr);
    assert.ok(!existsSync(join(resolveLayout(env).runtimeConfigPath)), 'no registration may be persisted');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: malformed Gateway output fails closed (no registration)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env, { FIXTURE_GATEWAY_MODE: 'malformed' });
    const outcome = await addProject(ctx, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-OUTPUT'), outcome.stderr);
    assert.ok(!existsSync(resolveLayout(env).runtimeConfigPath));
  } finally {
    cleanupEnv(env);
  }
});

test('project add: Gateway success without resolved output fails closed', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env, { FIXTURE_GATEWAY_MODE: 'no-output' });
    const outcome = await addProject(ctx, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-OUTPUT'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: mismatched resolved root/workspace fails closed with residual truthfulness', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env, { FIXTURE_GATEWAY_MODE: 'mismatch' });
    const outcome = await addProject(ctx, root);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-MISMATCH'), outcome.stderr);
    assert.ok(outcome.stderr.includes('workspace root mismatch'), outcome.stderr);
    assert.ok(outcome.stderr.includes('preserved'), outcome.stderr);
    // No registration persisted.
    assert.ok(!existsSync(resolveLayout(env).runtimeConfigPath));
  } finally {
    cleanupEnv(env);
  }
});

test('project add: bootstrap succeeds but registry persistence fails → residual reported truthfully, store preserved', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
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
    // The Gateway store survives (never deleted to roll back metadata).
    const locator = deriveStoreLocator(layout.shareDir, root);
    assert.equal(existsSync(join(locator, 'store-v1')), true);
  } finally {
    cleanupEnv(env);
  }
});

test('project list: empty registry is a successful valid state', () => {
  const env = makeEnv();
  try {
    const ctx = contextFor(env);
    const outcome = listProjects(ctx);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.stdout, 'no registered projects\n');
    assert.equal(outcome.stderr, '');
  } finally {
    cleanupEnv(env);
  }
});

test('project list: one and multiple projects with deterministic order; no subprocess needed', async () => {
  const env = makeEnv();
  try {
    const rootA = makeProjectRoot(env, 'proj-a');
    const rootB = makeProjectRoot(env, 'proj-b');
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
    assert.equal((await addProject(ctx, rootA)).exitCode, 0);
    assert.equal((await addProject(ctx, rootB)).exitCode, 0);

    const one = listProjects(ctx);
    // PATH with NO executables proves list never spawns a subprocess.
    const noExec = listProjects({ ...ctx, pathEnv: { PATH: '' } });
    assert.equal(noExec.exitCode, 0, noExec.stderr);
    assert.ok(noExec.stdout.includes(deriveWorkspaceId(rootA)));
    assert.ok(noExec.stdout.includes(rootA));
    assert.ok(noExec.stdout.includes(deriveWorkspaceId(rootB)));

    const lines = one.stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    // Deterministic code-unit ordering by surfaceId.
    const sorted = [deriveSurfaceId(rootA), deriveSurfaceId(rootB)].sort();
    assert.equal(lines[0]!.includes(sorted[0]!), true);
    assert.equal(lines[1]!.includes(sorted[1]!), true);
    // One line per project: workspaceId, canonical root, surface id, store locator.
    for (const line of lines) {
      assert.match(line, /^pgw:w:[0-9a-f]{32}  \/.*  surface pgw-[0-9a-f]{32}  store \//);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project list: invalid runtime document fails closed with a typed error', () => {
  const env = makeEnv();
  try {
    const ctx = contextFor(env);
    const layout = resolveLayout(env);
    mkdirSync(layout.configDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.runtimeConfigPath, '{"foreign": true}', { mode: 0o600 });
    const outcome = listProjects(ctx);
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.stderr.includes('ERR-PS4-LIST-INVALID'), outcome.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project remove: by workspace id — deregisters only; store, project, and history remain', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
    assert.equal((await addProject(ctx, root)).exitCode, 0);
    const layout = resolveLayout(env);
    const locator = deriveStoreLocator(layout.shareDir, root);

    const outcome = removeProject(ctx, deriveWorkspaceId(root));
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    assert.ok(outcome.stdout.includes(`deregistered ${deriveWorkspaceId(root)}`), outcome.stdout);
    assert.ok(outcome.stdout.includes(`preserved at ${locator}`), outcome.stdout);

    const read = readRuntimeDocument(layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.document.surfaces.length, 0);
    // Store evidence survives; project content survives; artifacts dir survives.
    assert.equal(existsSync(join(locator, 'store-v1', 'metadata.json')), true);
    assert.equal(existsSync(join(root, 'MARKER.txt')), true);
    assert.equal(existsSync(join(root, 'artifacts')), true);
  } finally {
    cleanupEnv(env);
  }
});

test('project remove: by canonical path and by surface id; unknown target fails closed', async () => {
  const env = makeEnv();
  try {
    const rootA = makeProjectRoot(env, 'proj-a');
    const rootB = makeProjectRoot(env, 'proj-b');
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
    assert.equal((await addProject(ctx, rootA)).exitCode, 0);
    assert.equal((await addProject(ctx, rootB)).exitCode, 0);
    const layout = resolveLayout(env);

    const byPath = removeProject(ctx, rootA);
    assert.equal(byPath.exitCode, 0, byPath.stderr);
    const read1 = readRuntimeDocument(layout.runtimeConfigPath);
    if (read1.ok) assert.equal(read1.document.surfaces.length, 1);

    const bySurface = removeProject(ctx, deriveSurfaceId(rootB));
    assert.equal(bySurface.exitCode, 0, bySurface.stderr);
    const read2 = readRuntimeDocument(layout.runtimeConfigPath);
    if (read2.ok) assert.equal(read2.document.surfaces.length, 0);

    const unknown = removeProject(ctx, 'pgw:w:ffffffffffffffffffffffffffffffff');
    assert.equal(unknown.exitCode, 1);
    assert.ok(unknown.stderr.includes('ERR-PS2-REG-NOT-FOUND'), unknown.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project remove: deregister → re-add reuses the same store and identity (replay verification)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
    assert.equal((await addProject(ctx, root)).exitCode, 0);
    const layout = resolveLayout(env);
    const locator = deriveStoreLocator(layout.shareDir, root);
    assert.equal(existsSync(join(locator, 'store-v1', 'metadata.json')), true);

    assert.equal(removeProject(ctx, deriveWorkspaceId(root)).exitCode, 0);
    // Store preserved after deregistration.
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

test('project remove: concurrent add/remove serialize via the operation lock (real-CLI, slow bootstrap)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env, 'slow-proj');
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const layout = resolveLayout(env);
    const baseEnv = fixturePathEnv(env, { HOME: env, FIXTURE_GATEWAY_MODE: 'slow' });
    // Add holds the operation lock across a 3 s bootstrap; the second
    // invocation must fail closed with the deterministic BUSY result.
    const [first, second] = await Promise.all([
      runCli(['project', 'add', root], baseEnv),
      runCli(['project', 'add', root], baseEnv),
    ]);
    const codes = [first.code, second.code].sort();
    assert.deepEqual(codes, [0, 1], `expected one success and one BUSY failure: ${first.code}/${second.code} ${first.stderr}${second.stderr}`);
    const failed = first.code === 1 ? first : second;
    assert.ok(failed.stderr.includes('ERR-PS4-BUSY'), failed.stderr);
    assert.ok(failed.stderr.includes('project.lock'), failed.stderr);
    assert.ok(failed.stderr.includes('stale lock'), failed.stderr);
    const read = readRuntimeDocument(layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.document.surfaces.length, 1, 'exactly one registration survives');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: concurrent different-project adds both succeed with no lost registration (real-CLI)', async () => {
  const env = makeEnv();
  try {
    const rootA = makeProjectRoot(env, 'proj-a');
    const rootB = makeProjectRoot(env, 'proj-b');
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const layout = resolveLayout(env);
    const baseEnv = fixturePathEnv(env, { HOME: env });
    const [first, second] = await Promise.all([
      runCli(['project', 'add', rootA], baseEnv),
      runCli(['project', 'add', rootB], baseEnv),
    ]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    const read = readRuntimeDocument(layout.runtimeConfigPath);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.document.surfaces.length, 2, 'both registrations survive');
  } finally {
    cleanupEnv(env);
  }
});

test('project add/list/remove: no receipt required for list; remove of unknown state is typed', async () => {
  const env = makeEnv();
  try {
    const ctx = contextFor(env);
    const list = listProjects(ctx);
    assert.equal(list.exitCode, 0, list.stderr);
    assert.equal(list.stdout, 'no registered projects\n');
    const remove = removeProject(ctx, 'pgw:w:0123456789abcdef0123456789abcdef');
    assert.equal(remove.exitCode, 1);
    assert.ok(remove.stderr.includes('ERR-PS2-REG-NOT-FOUND'), remove.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('project add: resolved artifactLocation mismatch fails closed (inside-root and outside-root), residual store preserved', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const ctx = contextFor(env);
    const layout = resolveLayout(env);
    const locator = deriveStoreLocator(layout.shareDir, root);
    // Both a wrong-but-still-inside-root artifact location and a wrong
    // descendant location (outside this root) must fail closed identically.
    for (const artifact of [join(root, 'artifacts-other'), join(env, 'outside-artifacts')]) {
      const outcome = await addProject({ ...ctx, pathEnv: { ...(ctx.pathEnv ?? process.env), FIXTURE_GATEWAY_ARTIFACT: artifact } }, root);
      assert.equal(outcome.exitCode, 1, outcome.stderr);
      assert.ok(outcome.stderr.includes('ERR-PS4-BOOTSTRAP-MISMATCH'), outcome.stderr);
      assert.ok(outcome.stderr.includes('artifactLocation mismatch'), outcome.stderr);
      // Residual truthfulness: the Gateway-created store is preserved and
      // the message says so; no registration is persisted.
      assert.ok(outcome.stderr.includes('preserved'), outcome.stderr);
      assert.ok(!existsSync(layout.runtimeConfigPath), 'no registration may be persisted');
      assert.equal(existsSync(join(locator, 'store-v1')), true, 'Gateway-created trusted-store residual must be preserved');
    }
  } finally {
    cleanupEnv(env);
  }
});

test('project add vs remove: competing remove BUSYs while add holds the operation lock; final state coherent (real-CLI, SIR-PS4-004)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env, 'contend');
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const layout = resolveLayout(env);
    const locator = deriveStoreLocator(layout.shareDir, root);
    const baseEnv = fixturePathEnv(env, { HOME: env });
    // Register once so the competing remove is meaningful.
    assert.equal((await runCli(['project', 'add', root], baseEnv)).code, 0);
    // Re-add with a slow Gateway bootstrap: project.lock is held across the
    // entire add (bootstrap + registry finalization).
    const slowAdd = runCli(['project', 'add', root], { ...baseEnv, FIXTURE_GATEWAY_MODE: 'slow' });
    // Wait until the operation lock is observably held by the slow add.
    const lockPath = join(layout.stateDir, 'project.lock');
    let held = false;
    for (let i = 0; i < 100 && !held; i++) {
      held = existsSync(lockPath);
      if (!held) await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(held, true, 'the slow add must hold project.lock');
    // Competing remove within the bounded policy: deterministic BUSY.
    const removed = await runCli(['project', 'remove', root], baseEnv);
    assert.equal(removed.code, 1, removed.stderr);
    assert.ok(removed.stderr.includes('ERR-PS4-BUSY'), removed.stderr);
    assert.ok(removed.stderr.includes('project.lock'), removed.stderr);
    assert.ok(removed.stderr.includes('stale lock'), removed.stderr);
    // The slow add then completes as an exact idempotent replay.
    const add = await slowAdd;
    assert.equal(add.code, 0, add.stderr);
    assert.ok(add.stdout.includes('already registered'), add.stdout);
    // Final invariants: exactly one coherent registration, no duplicate,
    // store intact, lock released at terminal state.
    const read = readRuntimeDocument(layout.runtimeConfigPath);
    assert.equal(read.ok, true, read.ok ? '' : read.message);
    if (read.ok) {
      assert.equal(read.document.surfaces.length, 1, 'exactly one registration survives');
      assert.equal(read.document.surfaces[0]!.locator, locator);
    }
    assert.equal(existsSync(join(locator, 'store-v1')), true, 'trusted store must never be destructively removed');
    assert.equal(existsSync(lockPath), false, 'project.lock must be released at terminal state');
  } finally {
    cleanupEnv(env);
  }
});

test('project add: healthy env via real CLI (full black-box path)', async () => {
  const env = makeEnv();
  try {
    const root = makeProjectRoot(env);
    installFixtureGateway(env);
    writeReceiptFixture(env);
    const pathEnv = fixturePathEnv(env, { HOME: env });
    const outcome = await runCli(['project', 'add', root], pathEnv);
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.equal(outcome.stdout.includes('registered project'), true, outcome.stdout);
    assert.equal(outcome.stderr, '');
    const list = await runCli(['project', 'list'], pathEnv);
    assert.equal(list.code, 0, list.stderr);
    assert.ok(list.stdout.includes(deriveWorkspaceId(root)), list.stdout);
  } finally {
    cleanupEnv(env);
  }
});
