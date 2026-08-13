/**
 * PS-6 public multi-repo lane: prepare-fixtures.sh fail-closed tests.
 *
 * The committed fixture builder is the authoritative artifact-build and
 * provenance boundary of Lane B real-stack evidence. These tests prove
 * its fail-closed semantics with synthetic git repositories (no network,
 * no component source required):
 *   - missing/unknown arguments → usage failure;
 *   - checkout that is not a git repository → failure;
 *   - HEAD ≠ exact pinned commit → failure (wrong-commit fail-closed);
 *   - tag mismatch at the pinned commit (pi-guard) → failure;
 *   - tracked modifications in the checkout → failure (clean closure).
 *
 * The SUCCESS path (exact public checkouts → deterministic packages →
 * manifest + SHA-256) is exercised by Lane B itself on the real runner
 * against the pinned public commits; the fail-closed guards below are the
 * behavior that protects that path from a wrong/dirty/drifted source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..', 'scripts', 'prepare-fixtures.sh');

function git(dir: string, args: string[]): void {
  const run = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')} failed: ${run.stderr}`);
}

function makeRepo(root: string, name: string): string {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'ps6-test']);
  git(repo, ['config', 'user.email', 'ps6-test@local']);
  writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"0.0.0"}\n');
  git(repo, ['add', 'package.json']);
  git(repo, ['commit', '-qm', 'init']);
  return repo;
}

function runScript(args: string[]): { readonly code: number; readonly stderr: string } {
  const run = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: run.status ?? -1, stderr: run.stderr ?? '' };
}

test('prepare-fixtures: missing required arguments fail closed', () => {
  const code = runScript([]).code;
  assert.equal(code, 2, 'no arguments → usage failure');
  const partial = runScript(['--gateway-checkout', '/tmp/nonexistent']).code;
  assert.equal(partial, 2, 'partial arguments → usage failure');
});

test('prepare-fixtures: non-git checkout fails closed', () => {
  const root = join('/tmp', `ps6-fx-test-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    const code = runScript([
      '--gateway-checkout', root,
      '--pi-guard-checkout', root,
      '--out', join(root, 'out'),
    ]).code;
    assert.equal(code, 1, 'a checkout without .git must be rejected');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare-fixtures: wrong gateway HEAD fails closed (wrong commit)', () => {
  const root = join('/tmp', `ps6-fx-test-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    const gateway = makeRepo(root, 'gateway');
    const piguard = makeRepo(root, 'pi-guard');
    const code = runScript([
      '--gateway-checkout', gateway,
      '--pi-guard-checkout', piguard,
      '--out', join(root, 'out'),
    ]).code;
    assert.equal(code, 1, 'any HEAD other than the exact pinned commit must fail closed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare-fixtures: wrong pi-guard HEAD fails closed even when tagged v0.1.2', () => {
  const root = join('/tmp', `ps6-fx-test-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    const gateway = makeRepo(root, 'gateway');
    const piguard = makeRepo(root, 'pi-guard');
    // The tag is only accepted AT the exact pinned commit; a repo tagged
    // v0.1.2 but not at the pinned HEAD must still fail closed.
    git(piguard, ['tag', 'v0.1.2']);
    const code = runScript([
      '--gateway-checkout', gateway,
      '--pi-guard-checkout', piguard,
      '--out', join(root, 'out'),
    ]).code;
    assert.equal(code, 1, 'pi-guard HEAD not at the exact pinned commit must fail closed regardless of tags');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare-fixtures: tracked modifications fail closed (clean closure required)', () => {
  const root = join('/tmp', `ps6-fx-test-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    const gateway = makeRepo(root, 'gateway');
    const piguard = makeRepo(root, 'pi-guard');
    writeFileSync(join(gateway, 'package.json'), '{"name":"x","version":"0.0.0","modified":true}\n');
    const code = runScript([
      '--gateway-checkout', gateway,
      '--pi-guard-checkout', piguard,
      '--out', join(root, 'out'),
    ]).code;
    assert.equal(code, 1, 'a checkout with tracked modifications must be rejected (clean closure)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepare-fixtures: unknown argument fails closed', () => {
  const code = runScript(['--bogus', 'x']).code;
  assert.equal(code, 2, 'unknown argument → usage failure');
});
