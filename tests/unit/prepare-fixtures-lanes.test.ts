/**
 * ADR-002 B — lane-aware Gateway artifact preparation: focused tests for
 * prepare-fixtures.sh lane selection and Intel-boundary verification.
 * Network-free: lane selection is proven through the fail-closed HEAD
 * verification messages (a synthetic repo at any other HEAD reports the
 * lane-selected expected commit), and the Intel tarball boundary is
 * proven statically against the committed script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..', 'scripts', 'prepare-fixtures.sh');

const HISTORICAL_COMMIT = '55f764290a4567a20557f1db19d2a6fb97572a97';
const INTEL_COMMIT = 'a90284b06420effb1ec1eeef14e7ed82e02c64e9';
const INTEL_ADDON_SHA256 = '0667af87eaf541a92fa299cd21cd2202dc825c6af9da650fd96cebf4553f6382';
const LINUX_LANE = 'linux-x86_64-posix-utf8-node22';
const ARM64_LANE = 'darwin-arm64-posix-utf8-node22';
const INTEL_LANE = 'darwin-x86_64-posix-utf8-node22';

function scriptText(): string {
  return readFileSync(SCRIPT, 'utf8');
}

function git(dir: string, args: string[]): void {
  const run = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')} failed: ${run.stderr}`);
}

function makeRepo(root: string, name: string): string {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'ps6-b-test']);
  git(repo, ['config', 'user.email', 'ps6-b-test@local']);
  writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"0.0.0"}\n');
  git(repo, ['add', 'package.json']);
  git(repo, ['commit', '-qm', 'init']);
  return repo;
}

/** Run the script with synthetic checkouts; the selected lane's expected commit is observable in the failure message. */
function runWithLane(root: string, lane: string): { readonly code: number; readonly output: string } {
  const run = spawnSync('bash', [
    SCRIPT,
    '--gateway-checkout', join(root, 'gateway'),
    '--pi-guard-checkout', join(root, 'pi-guard'),
    '--out', join(root, 'out'),
    '--lane', lane,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: run.status ?? -1, output: `${run.stdout ?? ''}\n${run.stderr ?? ''}` };
}

test('lane selection: linux selects the historical Gateway commit', () => {
  const root = join('/tmp', `ps6b-lane-test-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    makeRepo(root, 'gateway');
    makeRepo(root, 'pi-guard');
    const run = runWithLane(root, LINUX_LANE);
    assert.equal(run.code, 1, 'synthetic HEAD must fail the exact-pin check');
    assert.ok(run.output.includes(`expected ${HISTORICAL_COMMIT}`), `linux lane must pin the historical commit:\n${run.output}`);
    assert.ok(!run.output.includes(INTEL_COMMIT), 'linux lane must never pin the fork commit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lane selection: darwin-arm64 selects the SAME historical commit — never the fork', () => {
  const root = join('/tmp', `ps6b-lane-test-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    makeRepo(root, 'gateway');
    makeRepo(root, 'pi-guard');
    const run = runWithLane(root, ARM64_LANE);
    assert.equal(run.code, 1, 'synthetic HEAD must fail the exact-pin check');
    assert.ok(run.output.includes(`expected ${HISTORICAL_COMMIT}`), `arm64 lane must pin the historical commit:\n${run.output}`);
    assert.ok(!run.output.includes(INTEL_COMMIT), 'arm64 lane must never pin the fork commit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lane selection: darwin-x86_64 selects the macOS fork commit', () => {
  const root = join('/tmp', `ps6b-lane-test-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    makeRepo(root, 'gateway');
    makeRepo(root, 'pi-guard');
    const run = runWithLane(root, INTEL_LANE);
    assert.equal(run.code, 1, 'synthetic HEAD must fail the exact-pin check');
    assert.ok(run.output.includes(`expected ${INTEL_COMMIT}`), `Intel lane must pin the fork commit:\n${run.output}`);
    assert.ok(!run.output.includes(`expected ${HISTORICAL_COMMIT}`), 'Intel lane must never pin the historical commit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown/unmapped lane fails closed with exit 2 — no fallback', () => {
  const run = spawnSync('bash', [
    SCRIPT,
    '--gateway-checkout', '/nonexistent/gateway',
    '--pi-guard-checkout', '/nonexistent/pi-guard',
    '--out', '/nonexistent/out',
    '--lane', 'win32-x64-posix-utf8-node22',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(run.status, 2, 'unknown lane must exit 2 before checkout verification');
  assert.ok(`${run.stderr}`.includes('unknown gateway lane'), `unknown-lane message expected:\n${run.stderr}`);
});

test('script statics: the three lane identities and Intel boundary are committed exactly', () => {
  const text = scriptText();
  // Lane identity literals (authoritative manifest pins).
  assert.ok(text.includes(`GATEWAY_COMMIT="${HISTORICAL_COMMIT}"`), 'historical pin literal preserved');
  assert.ok(text.includes(`GATEWAY_COMMIT_MACOS_INTEL="${INTEL_COMMIT}"`), 'Intel fork pin literal present');
  assert.ok(text.includes('@project-gateway/macos-core'), 'Intel package identity present');
  assert.ok(text.includes('project-gateway-macos-core-0.1.0.tgz'), 'Intel artifact filename present');
  assert.ok(text.includes('project-gateway-macos-mcp'), 'Intel bin identity present');
  assert.ok(text.includes('@project-gateway/artifact-core'), 'historical package identity present');
  assert.ok(text.includes('project-gateway-artifact-core-0.1.0.tgz'), 'historical artifact filename present');
  // Intel tarball boundary: required entries present, forbidden entries absent.
  for (const entry of ['package/package.json', 'package/native/index.mjs', 'package/native/darwin-x64/gateway_fs.node', '^package/dist/']) {
    assert.ok(text.includes(entry), `Intel required boundary entry committed: ${entry}`);
  }
  for (const entry of ['package/native/darwin-arm64/gateway_fs.node', 'package/native/src', 'package/native/build', 'package/native/test']) {
    assert.ok(text.includes(entry), `Intel forbidden boundary entry committed: ${entry}`);
  }
  // arm64 never selects the fork: the arm64 branch assigns the historical pin.
  assert.ok(/elif \[ "\$LANE" = "\$LINUX_HOST_LANE" \] \|\| \[ "\$LANE" = "\$DARWIN_ARM64_HOST_LANE" \][\s\S]{0,400}?GATEWAY_COMMIT_EFFECTIVE="\$GATEWAY_COMMIT"/.test(text), 'arm64 branch must assign the historical pin, never the fork pin');
  // The authoritative manifest digest stays untouched by B.
  assert.ok(!text.includes('artifactSha256'), 'prepare-fixtures.sh must not write the authoritative manifest digest');
  // Provenance correction (PGM-DIST-1 a90284b): the Intel addon is a TRACKED
  // file in the pinned tree; the clean clone carries it. Regression guards:
  // the script must never copy the addon out of the operator checkout, and
  // must prove tracking via git ls-files with the exact accepted digest.
  assert.ok(!text.includes('$GATEWAY_CHECKOUT/$ADDON_REL'), 'regression: script must never reference/copy the addon from the operator checkout');
  assert.ok(!text.includes('cp "$GATEWAY_CHECKOUT'), 'regression: no addon copy from outside the pinned clean clone');
  assert.ok(text.includes('git -C "$WORK/gateway" ls-files --error-unmatch -- "$ADDON_REL"'), 'script must prove the addon is TRACKED in the scratch clone');
  assert.ok(text.includes(`ADDON_SHA256="${INTEL_ADDON_SHA256}"`), 'script must pin the accepted addon digest');
  assert.ok(text.includes('exactly the six accepted primitives'), 'script must verify the extracted loader exposes exactly the six accepted primitives');
});
