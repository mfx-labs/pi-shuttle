/**
 * PS-5 executable correction regression (PS5-LINUX-001): the product
 * invariant that a clean supported POSIX build/package produces a CLI
 * entrypoint that remains DIRECTLY executable after release-shaped
 * packaging, extraction, installation, and symlink composition.
 *
 *   `pi-shuttle --version` must work — NOT only `node dist/cli.js
 *   --version`. The installed `<binDir>/pi-shuttle` symlink must resolve
 *   to a regular executable target.
 *
 * Three regressions, all starting from the REAL repository build/package
 * path (no manual chmod anywhere in this file):
 *
 *   1. clean-build: compile into an ISOLATED empty output directory (the
 *      exact build compiler + config + post-build normalizer step) and
 *      prove the produced `cli.js` is a regular executable file with a
 *      correct shebang, then execute it directly;
 *   2. release-shaped package: `npm pack` the real repository, extract
 *      the actual tarball into an isolated directory, and execute
 *      `<extracted>/package/dist/cli.js --version` directly;
 *   3. installed symlink: run the REAL PS-3 installer
 *      (`install.sh --batch --gateway no --pi-guard no`) against an
 *      isolated HOME and execute `<isolated-bin>/pi-shuttle` directly
 *      (`--version` and `--help`), exactly as an operator would.
 *
 * The isolated output directory in test 1 keeps the clean-build proof
 * race-free with respect to the other suites that run against the shared
 * `dist/` (which `npm test` builds first with the same build script).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const REPO = join(import.meta.dirname, '..', '..', '..');
const NORMALIZER = join(REPO, 'scripts', 'normalize-cli-mode.mjs');

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(executable: string, args: readonly string[], options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { cwd: options.cwd ?? REPO, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ code: null, stdout, stderr: `${stderr}\n(timed out)` });
    }, options.timeoutMs ?? 120_000);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** The exact compilation step of `npm run build` into an isolated outDir, then the normalizer. */
async function isolatedBuild(): Promise<string> {
  const base = mkdtempSync(join(tmpdir(), 'ps5-clean-build-'));
  chmodSync(base, 0o700);
  const outDir = join(base, 'dist');
  const compile = await run(process.execPath, [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(REPO, 'tsconfig.json'), '--outDir', outDir], { timeoutMs: 180_000 });
  assert.equal(compile.code, 0, `tsc failed: ${compile.stderr}`);
  const normalize = await run(process.execPath, [NORMALIZER, outDir], { timeoutMs: 30_000 });
  assert.equal(normalize.code, 0, `normalizer failed: ${normalize.stderr}`);
  return outDir;
}

test('PS5-LINUX-001: a clean isolated build produces a directly executable dist/cli.js (0755, shebang intact)', async () => {
  const outDir = await isolatedBuild();
  try {
    const cliPath = join(outDir, 'cli.js');
    const stat = lstatSync(cliPath);
    assert.equal(stat.isFile(), true, 'cli.js must be a regular file (lstat)');
    assert.equal((stat.mode & 0o777), 0o755, `expected deterministic mode 0755, got ${(stat.mode & 0o777).toString(8)}`);
    assert.equal((stat.mode & 0o111) !== 0, true, 'POSIX executable bits must be present');
    const head = readFileSync(cliPath, 'utf8').slice(0, 64);
    assert.ok(head.startsWith('#!'), 'shebang must be preserved');
    assert.equal(head.split('\n')[0], '#!/usr/bin/env node', 'shebang must remain exactly #!/usr/bin/env node');
    // Exercise the produced file DIRECTLY (no `node` prefix).
    const execResult = await run(cliPath, ['--version'], { timeoutMs: 30_000 });
    assert.equal(execResult.code, 0, `direct exec failed (exit ${execResult.code}): ${execResult.stderr}`);
    assert.ok(execResult.stdout.includes('pi-shuttle 0.1.1'), execResult.stdout);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('PS5-LINUX-001: the npm-pack release-shaped artifact preserves executable semantics (extract + direct exec)', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'ps5-pack-'));
  chmodSync(packDir, 0o700);
  try {
    const pack = await run('npm', ['pack', '--pack-destination', packDir], { timeoutMs: 120_000 });
    assert.equal(pack.code, 0, `npm pack failed: ${pack.stderr}`);
    const tarball = pack.stdout.trim().split('\n').filter(Boolean).pop();
    assert.ok(tarball !== undefined && tarball.endsWith('.tgz'), `no tarball name in npm pack output: ${pack.stdout}`);
    const tgzPath = join(packDir, tarball);
    assert.equal(statSync(tgzPath).isFile(), true, `tarball missing: ${tgzPath}`);
    const extractDir = join(packDir, 'extract');
    mkdirSync(extractDir, { mode: 0o700 });
    const extract = await run('tar', ['-xzf', tgzPath, '-C', extractDir], { timeoutMs: 60_000 });
    assert.equal(extract.code, 0, `tar extraction failed: ${extract.stderr}`);
    const cliPath = join(extractDir, 'package', 'dist', 'cli.js');
    const stat = lstatSync(cliPath);
    assert.equal(stat.isFile(), true, 'packaged cli.js must be a regular file');
    assert.equal((stat.mode & 0o777), 0o755, `packaged cli.js must be 0755, got ${(stat.mode & 0o777).toString(8)}`);
    assert.equal((stat.mode & 0o111) !== 0, true, 'packaged cli.js must retain POSIX executable bits');
    // Execute the packaged CLI DIRECTLY (no `node` prefix).
    const runResult = await run(cliPath, ['--version'], { timeoutMs: 30_000 });
    assert.equal(runResult.code, 0, `packaged direct exec failed (exit ${runResult.code}): ${runResult.stderr}`);
    assert.ok(runResult.stdout.includes('pi-shuttle 0.1.1'), runResult.stdout);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
});

test('PS5-LINUX-001: the installed <binDir>/pi-shuttle symlink executes directly (real installer bin-link composition)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ps5-install-'));
  chmodSync(home, 0o700);
  try {
    // Real PS-3 installer entrypoint, batch, no components (the bin link
    // is composed before component installation; components are not
    // needed to prove the link/executable composition).
    const install = await run('bash', [join(REPO, 'install.sh'), '--batch', '--gateway', 'no', '--pi-guard', 'no'], {
      env: { ...process.env, HOME: home },
      timeoutMs: 120_000,
    });
    // PARTIAL (both components omitted) is the truthful expected result;
    // the installer must still have composed the bin link.
    assert.equal(install.code, 1, `installer must exit 1 (PARTIAL) here: ${install.stdout}${install.stderr}`);
    assert.ok(install.stdout.includes('PARTIAL'), install.stdout);
    const binLink = join(home, '.local', 'bin', 'pi-shuttle');
    assert.equal(lstatSync(binLink).isSymbolicLink(), true, `bin link missing: ${binLink}`);
    const resolved = join(REPO, 'dist', 'cli.js');
    assert.equal(readlinkSync(binLink), resolved, 'bin link must point at the installed CLI target');
    assert.equal(statSync(binLink).isFile(), true, 'bin link must resolve to a regular file');
    assert.equal((statSync(binLink).mode & 0o111) !== 0, true, 'bin link target must be executable');
    // Operator-style direct invocation (no `node` prefix).
    const version = await run(binLink, ['--version'], { timeoutMs: 30_000 });
    assert.equal(version.code, 0, `bin link direct exec failed (exit ${version.code}): ${version.stderr}`);
    assert.ok(version.stdout.includes('pi-shuttle 0.1.1'), version.stdout);
    const help = await run(binLink, ['--help'], { timeoutMs: 30_000 });
    assert.equal(help.code, 0, `bin link --help failed (exit ${help.code}): ${help.stderr}`);
    assert.ok(help.stdout.includes('usage: pi-shuttle'), help.stdout);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
