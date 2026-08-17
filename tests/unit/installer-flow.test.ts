/**
 * PS-3 focused tests: end-to-end installer flow via the compiled installer
 * main (real subprocess, isolated HOME, fixture artifacts, fake pi).
 * Selection semantics, preflight refusals, integrity, staging/activation,
 * idempotence, rollback, receipts, and the process boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { REPO, buildTarball, cleanupEnv, fullInstallEnv, gatewayFixtureFiles, makeEnv, piGuardFixtureFiles, runInstaller, GATEWAY_ARTIFACT_NAME, PI_GUARD_ARTIFACT_NAME } from '../helpers/installer-fixtures.js';
import type { InstallerRun } from '../helpers/installer-fixtures.js';
import { readReceipt } from '../../src/installer/receipt.js';
import { rollback, runInstall } from '../../src/installer/install.js';
import { validateBinPath } from '../../src/installer/components.js';
import { resolveLayout } from '../../src/host/environment.js';
import { GATEWAY_PS1_BASELINE_COMMIT } from '../../src/compat/manifest.js';

const SHA_RE = /^[0-9a-f]{64}$/;

async function gatewayArtifact(env: string, overrides: Record<string, string> = {}): Promise<string> {
  return buildTarball(env, gatewayFixtureFiles(overrides), GATEWAY_ARTIFACT_NAME);
}

async function piGuardArtifact(env: string, overrides: Record<string, string> = {}): Promise<string> {
  return buildTarball(env, piGuardFixtureFiles(overrides), PI_GUARD_ARTIFACT_NAME);
}

function installArgs(artifactDir: string, extra: readonly string[] = []): string[] {
  return ['--batch', '--gateway', 'yes', '--pi-guard', 'yes', '--artifact-dir', artifactDir, ...extra];
}

/** Run the compiled installer main with scripted stdin (interactive path). */
function runInstallerInteractive(args: readonly string[], input: readonly string[], env: { readonly home: string; readonly fixtureBin?: string; readonly extraEnv?: NodeJS.ProcessEnv }): Promise<InstallerRun> {
  return new Promise((resolve, reject) => {
    const pathEntries: string[] = [env.fixtureBin, join(env.home, '.local', 'bin'), process.env.PATH].filter((p): p is string => p !== undefined && p.length > 0);
    const child = spawn(process.execPath, ['--require', join(REPO, 'tests', 'helpers', 'platform-linux.cjs'), join(REPO, 'dist', 'installer', 'main.js'), ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env.extraEnv, HOME: env.home, PATH: pathEntries.join(':') },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.stdin.end(input.map((l) => l + '\n').join(''));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('installer: COMPLETE install of both components (batch)', async () => {
  const env = makeEnv();
  try {
    const gateway = await gatewayArtifact(env);
    const piguard = await piGuardArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const run = await runInstaller(installArgs(env), runEnv);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('result: COMPLETE'), run.stdout);

    const layout = resolveLayout(env);
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.result, 'COMPLETE');
    assert.deepEqual(receipt.receipt.omitted, []);
    assert.ok(receipt.receipt.components.gateway !== null);
    assert.ok(receipt.receipt.components.piGuard !== null);
    assert.equal(receipt.receipt.components.gateway.status, 'installed-verified');
    assert.equal(receipt.receipt.components.gateway.smoke, 'passed');
    assert.equal(receipt.receipt.components.gateway.version, '0.1.0');
    assert.equal(receipt.receipt.components.gateway.commit, GATEWAY_PS1_BASELINE_COMMIT);
    assert.match(receipt.receipt.components.gateway.artifactSha256, SHA_RE);
    assert.equal(receipt.receipt.components.piGuard.status, 'installed-verified');
    assert.equal(receipt.receipt.components.piGuard.verifiedBy, 'pi-list');
    assert.equal(receipt.receipt.components.piGuard.piVersion, '0.83.0');
    assert.equal(statSync(layout.installReceiptPath).mode & 0o777, 0o600, 'receipt must be 0600');
    // Local lane without expectations: digests are locally observed, never
    // presented as release-verified (SIR-PS3-006).
    assert.equal(receipt.receipt.components.gateway.digestVerified, false);
    assert.equal(receipt.receipt.components.piGuard.digestVerified, false);

    // Component installs exist under packages/ (contract layout form).
    assert.ok(existsSync(join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0', 'dist', 'cli.js')));
    assert.ok(existsSync(join(layout.packagesDir, 'pi-guard@0.1.2', 'package.json')));
    // Bin link created, pointing at the pi-shuttle package this installer runs from.
    assert.equal(readlinkSync(join(layout.binDir, 'pi-shuttle')), join(REPO, 'dist', 'cli.js'), 'bin link must point at the pi-shuttle CLI');
    // Staging cleaned.
    assert.deepEqual(readdirSync(layout.stagingDir), [], 'staging must be empty after success');
    // The fake pi recorded the install source.
    assert.ok(readFileSync(piState, 'utf8').includes('pi-guard@0.1.2'));
  } finally {
    cleanupEnv(env);
  }
});

test('installer: explicit opt-out yields truthful PARTIAL (gateway only)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    const runEnv = fullInstallEnv(env);
    const run = await runInstaller(['--batch', '--gateway', 'yes', '--pi-guard', 'no', '--artifact-dir', env], runEnv);
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('PARTIAL'), run.stdout);
    const receipt = readReceipt(resolveLayout(env).installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.result, 'PARTIAL');
    assert.deepEqual(receipt.receipt.omitted, ['pi-guard']);
    assert.ok(receipt.receipt.components.gateway !== null);
    assert.equal(receipt.receipt.components.piGuard, null);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: both declined is PARTIAL, not complete, and needs no artifacts', async () => {
  const env = makeEnv();
  try {
    const runEnv = fullInstallEnv(env);
    const run = await runInstaller(['--batch', '--gateway', 'no', '--pi-guard', 'no'], runEnv);
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('PARTIAL INSTALLATION'), run.stdout);
    const receipt = readReceipt(resolveLayout(env).installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.result, 'PARTIAL');
    assert.deepEqual(receipt.receipt.omitted, ['project-gateway-mcp', 'pi-guard']);
    assert.deepEqual(readdirSync(resolveLayout(env).packagesDir), [], 'no components installed');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: batch mode requires explicit selections', async () => {
  const env = makeEnv();
  try {
    const runEnv = fullInstallEnv(env);
    const run = await runInstaller(['--batch', '--gateway', 'yes'], runEnv);
    assert.equal(run.code, 2);
    assert.ok(run.stderr.includes('batch mode requires explicit'), run.stderr);
    const missing = await runInstaller(['--batch'], runEnv);
    assert.equal(missing.code, 2);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: batch --install-dir / --bin-dir reject relative paths at the argument boundary', async () => {
  const env = makeEnv();
  try {
    for (const [flag, bad] of [
      ['--install-dir', 'y'],
      ['--install-dir', 'foo/bar'],
      ['--install-dir', './foo'],
      ['--install-dir', '~/.local/share/pi-shuttle'],
      ['--bin-dir', 'y'],
      ['--bin-dir', './bin'],
    ] as const) {
      const run = await runInstaller(['--batch', '--gateway', 'yes', '--pi-guard', 'yes', flag, bad], { home: env });
      assert.equal(run.code, 2, `${flag} ${bad}: ${run.stdout} ${run.stderr}`);
      assert.match(run.stderr, /must be an absolute path/, `${flag} ${bad}: operator-facing guidance required`);
      assert.ok(run.stderr.includes(bad), `${flag} ${bad}: message must name the rejected value`);
    }
    // No rejected invocation may create installation state or a receipt.
    assert.equal(existsSync(join(env, '.local')), false, 'no layout dirs for rejected invocations');
    assert.equal(existsSync(resolveLayout(env).installReceiptPath), false, 'no receipt for rejected invocations');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: absolute --install-dir / --bin-dir overrides install into the chosen layout with a self-valid receipt', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const share = join(env, 'alt-share');
    const bin = join(env, 'alt-bin');
    const run = await runInstaller(installArgs(env, ['--install-dir', share, '--bin-dir', bin]), runEnv);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    const receipt = readReceipt(resolveLayout(env).installReceiptPath);
    assert.equal(receipt.ok, true, 'absolute overrides must produce a receipt validateReceipt accepts');
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.installDir, share);
    assert.equal(receipt.receipt.binDir, bin);
    assert.ok(existsSync(join(share, 'packages')), 'components installed under the chosen share dir');
    assert.equal(readlinkSync(join(bin, 'pi-shuttle')), join(REPO, 'dist', 'cli.js'), 'bin link lives in the chosen bin dir');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: interactive invalid directory input reprompts; Enter selects the absolute defaults (process boundary)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    // 'y' for Installation directory and 'rel' for Command/bin directory
    // must each be rejected and reprompted; empty then selects the
    // existing absolute defaults. Artifact dir arrives via --artifact-dir
    // (interactive mode has no artifact prompt).
    const run = await runInstallerInteractive(
      ['--artifact-dir', env],
      ['yes', 'yes', 'y', '', 'rel', '', 'no'],
      runEnv,
    );
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('result: COMPLETE'), run.stdout);
    assert.equal(run.stdout.split('Installation directory [').length - 1, 2, 'invalid installation directory must reprompt');
    assert.equal(run.stdout.split('Command/bin directory [').length - 1, 2, 'invalid bin directory must reprompt');
    assert.ok(run.stderr.includes('Installation directory must be an absolute path'), run.stderr);
    assert.ok(run.stderr.includes('Command/bin directory must be an absolute path'), run.stderr);
    // Enter-selected defaults were used and the receipt validates.
    const layout = resolveLayout(env);
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true, 'interactive defaults must produce a self-valid receipt');
    if (receipt.ok) {
      assert.equal(receipt.receipt.installDir, layout.shareDir);
      assert.equal(receipt.receipt.binDir, layout.binDir);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('installer: relative HOME is rejected before Enter/EOF reaches interactive prompts', () => {
  const env = makeEnv();
  try {
    const relativeHomeDir = join(env, 'interactive-relative-home');
    const relativeHome = relative(process.cwd(), relativeHomeDir);
    const run = spawnSync(process.execPath, ['--require', join(REPO, 'tests', 'helpers', 'platform-linux.cjs'), join(REPO, 'dist', 'installer', 'main.js')], {
      input: '',
      encoding: 'utf8',
      timeout: 5_000,
      env: { ...process.env, HOME: relativeHome },
    });
    assert.ifError(run.error);
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stderr, /HOME must be an absolute path/);
    assert.doesNotMatch(run.stdout, /Install Project Gateway MCP\?/, 'no prompt may consume EOF');
    assert.equal(existsSync(relativeHomeDir), false, 'relative HOME layout must not be created');
  } finally {
    cleanupEnv(env);
  }
});

test('install core: relative installDir/binDir is REFUSED before any installation mutation (programmatic boundary)', async () => {
  const env = makeEnv();
  try {
    const host = { home: env, platform: 'linux', arch: 'x64' };
    for (const overrides of [{ installDir: 'y' }, { binDir: 'y' }, { installDir: './foo', binDir: 'foo/bar' }] as const) {
      const outcome = await runInstall(host, { selections: { gateway: false, piGuard: false }, ...overrides });
      assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
      if (outcome.kind === 'REFUSED') assert.match(outcome.reason, /must be an absolute path/, 'refusal must carry guidance');
    }
    // The refusal precedes every mutation: no layout, state, staging,
    // packages, links, or receipts may exist.
    assert.equal(existsSync(join(env, '.local')), false, 'no layout may be created');
    assert.equal(existsSync(resolveLayout(env).installReceiptPath), false, 'no receipt may be written');
  } finally {
    cleanupEnv(env);
  }
});

test('install core: relative HOME with absolute overrides is REFUSED before any mutation', async () => {
  const env = makeEnv();
  try {
    const relativeHomeDir = join(env, 'relative-home');
    const share = join(env, 'absolute-share');
    const bin = join(env, 'absolute-bin');
    const outcome = await runInstall(
      { home: relative(process.cwd(), relativeHomeDir), platform: 'linux', arch: 'x64' },
      { selections: { gateway: false, piGuard: false }, installDir: share, binDir: bin },
    );
    assert.equal(outcome.kind, 'REFUSED', JSON.stringify(outcome));
    if (outcome.kind === 'REFUSED') assert.match(outcome.reason, /HOME must be an absolute path/);
    assert.equal(existsSync(relativeHomeDir), false, 'no HOME-derived state/config layout may be created');
    assert.equal(existsSync(share), false, 'absolute install override must remain untouched');
    assert.equal(existsSync(bin), false, 'absolute bin override must remain untouched');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: artifact digest mismatch fails closed before activation', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env);
    const run = await runInstaller(installArgs(env, ['--expect-gateway-sha256', 'f'.repeat(64)]), runEnv);
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('digest mismatch'), run.stdout);
    const layout = resolveLayout(env);
    assert.deepEqual(readdirSync(layout.packagesDir), [], 'nothing may be activated on digest mismatch');
    assert.equal(existsSync(layout.installReceiptPath), false, 'no receipt on failure');
    assert.deepEqual(readdirSync(layout.stagingDir), [], 'staging cleaned');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: wrong component version fails closed', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env, { version: '0.1.9' });
    const runEnv = fullInstallEnv(env);
    const run = await runInstaller(installArgs(env), runEnv);
    assert.equal(run.code, 2);
    assert.ok(run.stdout.includes('identity mismatch'), run.stdout);
    assert.deepEqual(readdirSync(resolveLayout(env).packagesDir), []);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: corrupted artifact fails closed', async () => {
  const env = makeEnv();
  try {
    writeFileSync(join(env, GATEWAY_ARTIFACT_NAME), 'not a tarball', { mode: 0o600 });
    const runEnv = fullInstallEnv(env);
    const run = await runInstaller(installArgs(env), runEnv);
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.deepEqual(readdirSync(resolveLayout(env).packagesDir), []);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: non-baseline Pi version (candidate) is refused when its integration surface cannot be located (0.84.1)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env, '0.84.1');
    const run = await runInstaller(installArgs(env), runEnv);
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('REFUSED'), run.stdout);
    // 0.84.1 is now a CANDIDATE (>= minimum 0.83.0): the fixture pi has
    // no extension loader, so the required compatibility probe cannot
    // run — fail closed, never a silent acceptance.
    assert.ok(run.stdout.includes('extension loader could not be located'), run.stdout);
    // The flow refuses BEFORE creating layout dirs (pi check precedes writability).
    assert.equal(existsSync(resolveLayout(env).packagesDir), false, 'nothing installed on Pi policy refusal');
    assert.equal(existsSync(resolveLayout(env).installReceiptPath), false);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: Pi candidate probe FAIL fails closed with no Pi mutation; probe PASS completes with the probe note', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    // The fixture pi lives at <env>/fixture-bin/pi, so the resolved
    // loader path is <env>/dist/core/extensions/loader.js. Provide a fake
    // loader module there so the committed probe can run.
    const loaderDir = join(env, 'dist', 'core', 'extensions');
    mkdirSync(loaderDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(env, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(loaderDir, 'loader.js'), `export async function loadExtensions(paths, home) {
  if (process.env.FIXTURE_PROBE_FAIL === '1') return { extensions: [], errors: ['fixture: integration surface broken'] };
  return {
    extensions: [{
      path: paths[0],
      commands: new Map([['guard', { name: 'guard' }]]),
      handlers: new Map([['session_start', []], ['session_shutdown', []], ['before_agent_start', []], ['tool_call', []]]),
      tools: new Map(),
    }],
    errors: [],
  };
}
`, { mode: 0o600 });

    // Probe FAIL → the install FAILS closed before any `pi install`
    // mutation; the activated package dir is rolled back.
    const piState = join(env, 'pi-state.txt');
    const base = fullInstallEnv(env, '0.84.1', piState);
    const failRun = await runInstaller(installArgs(env), {
      ...base,
      extraEnv: { ...base.extraEnv, FIXTURE_PROBE_FAIL: '1' },
    });
    assert.ok(failRun.stdout.includes('FAILED'), failRun.stdout + failRun.stderr);
    assert.ok(failRun.stdout.includes('compatibility probe FAILED'), failRun.stdout);
    assert.equal(existsSync(join(resolveLayout(env).packagesDir, 'pi-guard@0.1.2')), false, 'activated pi-guard dir rolled back');
    assert.equal(existsSync(resolveLayout(env).installReceiptPath), false, 'no receipt on failed install');

    // Probe PASS → install proceeds to COMPLETE with the probe note.
    const passRun = await runInstaller(installArgs(env), {
      ...base,
      extraEnv: { ...base.extraEnv },
    });
    assert.ok(passRun.stdout.includes('COMPLETE'), passRun.stdout + passRun.stderr);
    assert.equal(existsSync(resolveLayout(env).installReceiptPath), true, 'receipt written');
    const receipt = JSON.parse(readFileSync(resolveLayout(env).installReceiptPath, 'utf8'));
    assert.ok(
      (receipt.notes ?? []).some((n: string) => n.includes('compatibility probe PASSED')),
      `receipt notes must record the candidate probe PASS: ${JSON.stringify(receipt.notes)}`,
    );
  } finally {
    cleanupEnv(env);
  }
});

test('installer: missing pi executable refuses pi-guard selection', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    const runEnv = fullInstallEnv(env);
    const emptyBin = join(env, 'empty-bin');
    mkdirSync(emptyBin, { mode: 0o700 });
    // PATH without any pi executable (the real host pi is excluded too).
    const run = await runInstaller(['--batch', '--gateway', 'no', '--pi-guard', 'yes', '--artifact-dir', env], { ...runEnv, path: `${emptyBin}:/usr/bin` });
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('pi was not found on PATH'), run.stdout);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: same-version pi-guard state drift is refused before repair and preserves prior state', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    // First a COMPLETE install.
    const first = await runInstaller(installArgs(env), runEnv);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const layout = resolveLayout(env);
    const packagesBefore = readdirSync(layout.packagesDir).sort();

    // A fresh Pi state contradicts the valid receipt. Same-version reruns
    // are no-op checks, not implicit repair attempts.
    const failingEnv = { ...runEnv, extraEnv: { ...runEnv.extraEnv, FIXTURE_PI_STATE: join(env, 'pi-state-2.txt'), FIXTURE_PI_FAIL_INSTALL: '1' } };
    const second = await runInstaller(installArgs(env), failingEnv);
    assert.equal(second.code, 2, second.stdout + second.stderr);
    assert.ok(second.stdout.includes('no longer matches its receipt'), second.stdout);
    assert.ok(second.stdout.includes('prior state was preserved'), second.stdout);
    // Prior components and receipt survive; staging is untouched.
    assert.deepEqual(readdirSync(layout.packagesDir).sort(), packagesBefore, 'prior component installs must survive refusal');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true, 'prior receipt must be preserved');
    if (receipt.ok) assert.equal(receipt.receipt.result, 'COMPLETE');
    assert.deepEqual(readdirSync(layout.stagingDir), []);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: fresh failure rolls back everything this attempt created', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const failingEnv = { ...runEnv, extraEnv: { ...runEnv.extraEnv, FIXTURE_PI_FAIL_INSTALL: '1' } };
    const run = await runInstaller(installArgs(env), failingEnv);
    assert.equal(run.code, 2);
    const layout = resolveLayout(env);
    // The gateway dir created by this attempt was rolled back.
    assert.deepEqual(readdirSync(layout.packagesDir), [], 'attempt-created component dirs must be removed on rollback');
    assert.equal(existsSync(layout.installReceiptPath), false, 'no receipt for a failed fresh install');
    assert.equal(existsSync(join(layout.binDir, 'pi-shuttle')), false, 'bin link must not remain from a rolled-back attempt');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: same-version rerun verifies ownership and reports ALREADY INSTALLED without churn', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const first = await runInstaller(installArgs(env), runEnv);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const layout = resolveLayout(env);
    const packagesBefore = readdirSync(layout.packagesDir).sort();
    const receiptBefore = readFileSync(layout.installReceiptPath, 'utf8');
    const second = await runInstaller(installArgs(env), runEnv);
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.ok(second.stdout.includes('ALREADY INSTALLED'), second.stdout);
    assert.deepEqual(readdirSync(layout.packagesDir).sort(), packagesBefore, 'rerun must not recreate component dirs');
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), receiptBefore, 'verified no-op must not rewrite the receipt');
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: foreign receipt fails closed and is preserved', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    const runEnv = fullInstallEnv(env);
    const layout = resolveLayout(env);
    mkdirSync(layout.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(layout.installReceiptPath, '{"foreign": true}', { mode: 0o600 });
    const run = await runInstaller(installArgs(env), runEnv);
    assert.equal(run.code, 2);
    assert.ok(run.stdout.includes('REFUSED'), run.stdout);
    assert.equal(readFileSync(layout.installReceiptPath, 'utf8'), '{"foreign": true}', 'foreign receipt must be preserved');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: missing receipt plus existing entry remains fail-closed with actionable metadata recovery guidance', async (t) => {
  for (const entryKind of ['owned-looking-link', 'foreign-file', 'owned-looking-package'] as const) {
    await t.test(entryKind, async () => {
      const env = makeEnv();
      try {
        const layout = resolveLayout(env);
        if (entryKind === 'owned-looking-package') {
          const packageDir = join(layout.packagesDir, 'pi-shuttle@0.1.0');
          mkdirSync(packageDir, { recursive: true, mode: 0o700 });
          writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'pi-shuttle', version: '0.1.0' }));
        } else {
          mkdirSync(layout.binDir, { recursive: true, mode: 0o700 });
          const entry = join(layout.binDir, 'pi-shuttle');
          if (entryKind === 'owned-looking-link') {
            const target = join(env, 'orphan-cli.js');
            writeFileSync(target, 'orphan');
            symlinkSync(target, entry);
          } else {
            writeFileSync(entry, 'foreign command', { mode: 0o700 });
          }
        }
        const entryBefore = entryKind === 'owned-looking-package'
          ? readFileSync(join(layout.packagesDir, 'pi-shuttle@0.1.0', 'package.json'), 'utf8')
          : entryKind === 'foreign-file'
            ? readFileSync(join(layout.binDir, 'pi-shuttle'), 'utf8')
            : readlinkSync(join(layout.binDir, 'pi-shuttle'));
        const run = await runInstaller(['--batch', '--gateway', 'no', '--pi-guard', 'no'], { home: env });
        assert.equal(run.code, 2, run.stdout + run.stderr);
        assert.match(run.stdout, /installation metadata is missing/i);
        assert.match(run.stdout, /automatic ownership cannot be established/i);
        assert.match(run.stdout, /restore the matching install receipt/i);
        assert.doesNotMatch(run.stdout, /\brm\b/, 'recovery must not recommend arbitrary deletion');
        assert.equal(existsSync(layout.installReceiptPath), false);
        const entryAfter = entryKind === 'owned-looking-package'
          ? readFileSync(join(layout.packagesDir, 'pi-shuttle@0.1.0', 'package.json'), 'utf8')
          : entryKind === 'foreign-file'
            ? readFileSync(join(layout.binDir, 'pi-shuttle'), 'utf8')
            : readlinkSync(join(layout.binDir, 'pi-shuttle'));
        assert.equal(entryAfter, entryBefore, 'ambiguous/foreign state must be preserved');
      } finally {
        cleanupEnv(env);
      }
    });
  }
});

test('installer: unsupported platform fails closed at the pure orchestration layer', async () => {
  const outcome = await runInstall({ home: '/tmp/unused', platform: 'win32', arch: 'x64' }, { selections: { gateway: true, piGuard: true } });
  assert.equal(outcome.kind, 'UNSUPPORTED');
});

test('installer: both descriptor-bound Darwin targets enter the technical path and retain later preflight gates', async () => {
  for (const arch of ['x64', 'arm64']) {
    const outcome = await runInstall(
      { home: '/tmp/unused', platform: 'darwin', arch },
      { selections: { gateway: true, piGuard: true }, uid: 0 },
    );
    assert.equal(outcome.kind, 'REFUSED', `darwin/${arch} must pass platform eligibility and reach the root guard`);
    if (outcome.kind === 'REFUSED') assert.ok(outcome.reason.includes('root privileges'), outcome.reason);
  }
});

test('installer: interactive prompts route project configuration to deferred guidance', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const child = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const pathEntries = [runEnv.fixtureBin, process.env.PATH].filter((p): p is string => p !== undefined);
      const proc = spawn(process.execPath, ['--require', join(import.meta.dirname, '..', '..', '..', 'tests', 'helpers', 'platform-linux.cjs'), join(import.meta.dirname, '..', '..', '..', 'dist', 'installer', 'main.js'), '--artifact-dir', env], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...runEnv.extraEnv, HOME: env, PATH: pathEntries.join(':') },
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
      proc.on('error', reject);
      // answers: gateway yes, pi-guard yes, install-dir default, bin-dir default, configure project YES
      proc.stdin.write('y\ny\n\n\ny\n');
      proc.stdin.end();
      proc.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(child.code, 0, child.stdout + child.stderr);
    assert.ok(child.stdout.includes('COMPLETE'), child.stdout);
    assert.ok(child.stdout.includes('pi-shuttle project add <path>'), 'prompt 5 must route to truthful deferred guidance');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: interactive both-decline yields PARTIAL', async () => {
  const env = makeEnv();
  try {
    const runEnv = fullInstallEnv(env);
    const child = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const pathEntries = [runEnv.fixtureBin, process.env.PATH].filter((p): p is string => p !== undefined);
      const proc = spawn(process.execPath, ['--require', join(import.meta.dirname, '..', '..', '..', 'tests', 'helpers', 'platform-linux.cjs'), join(import.meta.dirname, '..', '..', '..', 'dist', 'installer', 'main.js')], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...runEnv.extraEnv, HOME: env, PATH: pathEntries.join(':') },
      });
      let stdout = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
      proc.on('error', reject);
      proc.stdin.write('n\nn\n\n\n\n');
      proc.stdin.end();
      proc.on('close', (code) => resolve({ code, stdout }));
    });
    assert.equal(child.code, 1, child.stdout);
    assert.ok(child.stdout.includes('PARTIAL INSTALLATION'), child.stdout);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: unwritable install dir fails closed', async () => {
  const env = makeEnv();
  try {
    const blocker = join(env, 'blocker');
    writeFileSync(blocker, 'file', { mode: 0o600 });
    const run = await runInstaller(['--batch', '--gateway', 'no', '--pi-guard', 'no', '--install-dir', join(blocker, 'share')], fullInstallEnv(env));
    assert.equal(run.code, 2);
    assert.ok(run.stdout.includes('REFUSED'), run.stdout);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: install.sh entrypoint help works', async () => {
  const env = makeEnv();
  try {
    const result = spawnSync('bash', [join(REPO, 'install.sh'), '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('usage: pi-shuttle-installer'));
  } finally {
    cleanupEnv(env);
  }
});

// ─── PS-3 correction evidence (SIR-PS3-002/004/005/006/007/008/009/010/011) ──

test('installer: real canonical hyphen artifact names are discovered without renaming (SIR-PS3-004)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const run = await runInstaller(installArgs(env), runEnv);
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('COMPLETE'), run.stdout);
    // The wrong @-form names are NOT supported: an artifact dir containing
    // only them fails closed with ERR-PS3-ARTIFACT-UNAVAILABLE.
    const wrongEnv = makeEnv();
    try {
      await buildTarball(wrongEnv, gatewayFixtureFiles(), 'project-gateway-artifact-core@0.1.0.tgz');
      const run2 = await runInstaller(['--batch', '--gateway', 'yes', '--pi-guard', 'no', '--artifact-dir', wrongEnv], fullInstallEnv(wrongEnv));
      assert.equal(run2.code, 2, run2.stdout + run2.stderr);
      assert.ok(run2.stdout.includes('could not be read'), run2.stdout);
    } finally {
      cleanupEnv(wrongEnv);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('installer: one explicit selection flag without the other is a deterministic invocation failure (SIR-PS3-005)', async () => {
  const env = makeEnv();
  try {
    const runEnv = fullInstallEnv(env);
    for (const args of [
      ['--gateway', 'yes'],
      ['--pi-guard', 'no'],
      ['--gateway', 'no'],
      ['--batch', '--gateway', 'yes'],
    ]) {
      const run = await runInstaller(args, runEnv);
      assert.equal(run.code, 2, JSON.stringify(args) + run.stdout + run.stderr);
      assert.ok(run.stderr.includes('--gateway') && run.stderr.includes('--pi-guard'), run.stderr);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('installer: root/sudo is refused before any mutation (SIR-PS3-007)', async () => {
  const env = makeEnv();
  try {
    const outcome = await runInstall({ home: env, platform: 'linux', arch: 'x64' }, { selections: { gateway: true, piGuard: true }, uid: 0 });
    assert.equal(outcome.kind, 'REFUSED');
    if (outcome.kind === 'REFUSED') assert.ok(outcome.reason.includes('root privileges'), outcome.reason);
    const layout = resolveLayout(env);
    assert.equal(existsSync(layout.shareDir), false, 'no layout mutation before root refusal');
    assert.equal(existsSync(layout.stateDir), false, 'no state mutation before root refusal');
    assert.equal(existsSync(layout.installReceiptPath), false, 'no receipt before root refusal');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: expected digest is persisted as digestVerified, observed-only is not (SIR-PS3-006)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const gatewayPath = join(env, GATEWAY_ARTIFACT_NAME);
    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update(readFileSync(gatewayPath)).digest('hex');
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const verified = await runInstaller(installArgs(env, ['--expect-gateway-sha256', digest]), runEnv);
    assert.equal(verified.code, 0, verified.stdout + verified.stderr);
    const layout = resolveLayout(env);
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.components.gateway?.digestVerified, true, 'expected-digest match must be persisted');
    assert.equal(receipt.receipt.components.gateway?.artifactSha256, digest);
    assert.equal(receipt.receipt.components.piGuard?.digestVerified, false, 'observed-only digest must remain false');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: pi list exact-source verification rejects substring false positives (SIR-PS3-008)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    // Only unrelated lookalikes present in pi list — never the exact source.
    const runEnv = fullInstallEnv(env, '0.83.0', join(env, 'pi-state.txt'));
    const run = await runInstaller(installArgs(env), {
      ...runEnv,
      extraEnv: { ...runEnv.extraEnv, FIXTURE_PI_LIST_EXTRA: 'pi-guard-extra\n/other/path/pi-guard@9.9.9', FIXTURE_PI_INSTALL_NO_RECORD: '1' },
    });
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('PARTIAL'), run.stdout);
    assert.ok(run.stdout.includes('pi-guard installed but not verified'), run.stdout);
    const receipt = readReceipt(resolveLayout(env).installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.components.piGuard?.status, 'installed-unverified');
    assert.equal(receipt.receipt.components.piGuard?.verifiedBy, 'unverified');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: post-pi-install failure reports PARTIAL ROLLBACK with the Pi residual (SIR-PS3-002)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const stateDir = join(env, '.local', 'state', 'pi-shuttle');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    // The fake pi makes the state dir read-only AFTER a successful install
    // record — the receipt step then fails, after the external Pi mutation.
    const run = await runInstaller(installArgs(env), { ...runEnv, extraEnv: { ...runEnv.extraEnv, FIXTURE_PI_CHMOD_DIR_ON_INSTALL: stateDir } });
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('partial rollback'), run.stdout);
    assert.ok(run.stdout.includes('pi-guard remains installed in the Pi package store'), run.stdout);
    assert.equal(readFileSync(piState, 'utf8').split('\n').filter(Boolean).length, 1, 'the exact Pi side effect remains');
    const layout = resolveLayout(env);
    assert.deepEqual(readdirSync(layout.packagesDir), [], 'attempt-created component dirs are rolled back');
    assert.equal(existsSync(layout.installReceiptPath), false, 'no receipt for the failed attempt');
    assert.equal(existsSync(join(layout.binDir, 'pi-shuttle')), false, 'attempt-created bin link is rolled back');
  } finally {
    chmodSync(join(env, '.local', 'state', 'pi-shuttle'), 0o700); // restore for cleanup
    cleanupEnv(env);
  }
});

test('installer: pre-existing pi-guard is preserved and never claimed as attempt-created residual (SIR-PS3-002)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const layout = resolveLayout(env);
    const targetDir = join(layout.packagesDir, 'pi-guard@0.1.2');
    writeFileSync(piState, `${targetDir}\n`, { mode: 0o600 });
    const stateDir = join(env, '.local', 'state', 'pi-shuttle');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    // Later failure injected via the read-only pre-list chmod; pi install
    // is SKIPPED for the pre-existing source, so no attempt-created
    // residual may be claimed.
    const run = await runInstaller(installArgs(env), { ...runEnv, extraEnv: { ...runEnv.extraEnv, FIXTURE_PI_CHMOD_DIR_ON_LIST: stateDir } });
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('rolled back') && !run.stdout.includes('partial rollback'), run.stdout);
    assert.ok(!run.stdout.includes('pi-guard remains installed'), run.stdout);
    assert.equal(readFileSync(piState, 'utf8').trim(), targetDir, 'pre-existing pi-guard entry preserved');
  } finally {
    chmodSync(join(env, '.local', 'state', 'pi-shuttle'), 0o700); // restore for cleanup
    cleanupEnv(env);
  }
});

test('installer: foreign EMPTY activation target is refused, never replaced (SIR-PS3-010)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    const layout = resolveLayout(env);
    const emptyTarget = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0');
    mkdirSync(emptyTarget, { recursive: true, mode: 0o700 });
    const run = await runInstaller(['--batch', '--gateway', 'yes', '--pi-guard', 'no', '--artifact-dir', env], fullInstallEnv(env));
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('installation metadata is missing'), run.stdout);
    assert.equal(statSync(emptyTarget).isDirectory(), true, 'foreign empty dir must be preserved');
    assert.deepEqual(readdirSync(emptyTarget), [], 'foreign empty dir must stay empty');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: foreign FILE activation target is refused, never replaced (SIR-PS3-010)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    const layout = resolveLayout(env);
    const fileTarget = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0');
    mkdirSync(layout.packagesDir, { recursive: true, mode: 0o700 });
    writeFileSync(fileTarget, 'foreign file', { mode: 0o600 });
    const run = await runInstaller(['--batch', '--gateway', 'yes', '--pi-guard', 'no', '--artifact-dir', env], fullInstallEnv(env));
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.equal(readFileSync(fileTarget, 'utf8'), 'foreign file', 'foreign file must be preserved');
  } finally {
    cleanupEnv(env);
  }
});

test('installer: concurrent different-selection installers serialize via the install lock (SIR-PS3-009)', async () => {
  const env = makeEnv();
  try {
    await gatewayArtifact(env);
    await piGuardArtifact(env);
    const piState = join(env, 'pi-state.txt');
    const runEnv = fullInstallEnv(env, '0.83.0', piState);
    const argsA = ['--batch', '--gateway', 'yes', '--pi-guard', 'yes', '--artifact-dir', env];
    const argsB = ['--batch', '--gateway', 'yes', '--pi-guard', 'no', '--artifact-dir', env];
    const a = runInstaller(argsA, runEnv);
    await new Promise((r) => setTimeout(r, 500)); // A holds the install lock mid-attempt
    const b = await runInstaller(argsB, runEnv);
    const aResult = await a;
    assert.equal(aResult.code, 0, aResult.stdout + aResult.stderr);
    // Two acceptable outcomes (SIR-PS3-009): B fails BUSY while A holds the
    // lock, or B runs sequentially against A's final state. UNACCEPTABLE:
    // a success whose receipt disagrees with the actual component state.
    if (b.code === 2) {
      assert.ok(b.stdout.includes('in progress'), b.stdout);
    } else {
      assert.ok(b.code === 0 || b.code === 1, b.stdout + b.stderr);
    }
    // Final state is coherent: receipt matches the actual components.
    const layout = resolveLayout(env);
    const receipt = readReceipt(layout.installReceiptPath);
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    const pkgs = readdirSync(layout.packagesDir).sort();
    const gatewayPresent = pkgs.includes('project-gateway-artifact-core@0.1.0');
    const piGuardPresent = pkgs.includes('pi-guard@0.1.2');
    assert.equal(receipt.receipt.components.gateway !== null, gatewayPresent, 'receipt gateway entry must match actual state');
    assert.equal(receipt.receipt.components.piGuard !== null, piGuardPresent, 'receipt pi-guard entry must match actual state');
    if (gatewayPresent && piGuardPresent) {
      assert.equal(receipt.receipt.result, 'COMPLETE', 'full actual stack must be reported COMPLETE');
      assert.equal(receipt.receipt.omitted.length, 0);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('installer: rollback removes only an attempt-created bin link; a foreign replacement is preserved (SIR-PS3-011)', async () => {
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    mkdirSync(layout.binDir, { recursive: true, mode: 0o700 });
    const target = join(env, 'cli.js');
    writeFileSync(target, 'x', { mode: 0o600 });
    const binLink = join(layout.binDir, 'pi-shuttle');
    symlinkSync(target, binLink);
    const attempt = {
      layout,
      receiptPath: layout.installReceiptPath,
      stagingDir: join(env, 'no-such-staging'),
      binLinkTarget: target,
      binLinkCreated: true,
      piGuardPiState: 'none' as const,
      rollbackCandidates: [],
    };
    // Replace the link with a foreign target BEFORE rollback runs.
    const foreignTarget = join(env, 'foreign.js');
    writeFileSync(foreignTarget, 'y', { mode: 0o600 });
    rmSync(binLink);
    symlinkSync(foreignTarget, binLink);
    const report = rollback(attempt);
    assert.equal(report.state, 'partial');
    assert.ok(report.message.includes('replaced by another entry'), report.message);
    assert.equal(readlinkSync(binLink), foreignTarget, 'foreign bin link must be preserved');
    // Normal case: an unchanged attempt-owned link is removed.
    const attempt2 = {
      layout,
      receiptPath: layout.installReceiptPath,
      stagingDir: join(env, 'no-such-staging'),
      binLinkTarget: target,
      binLinkCreated: true,
      piGuardPiState: 'none' as const,
      rollbackCandidates: [],
    };
    rmSync(binLink);
    symlinkSync(target, binLink);
    const report2 = rollback(attempt2);
    assert.equal(report2.state, 'rolled-back', report2.message);
    assert.equal(existsSync(binLink), false);
  } finally {
    cleanupEnv(env);
  }
});

test('installer: gateway bin path traversal from artifact metadata is refused (SIR-PS3-003)', async () => {
  const env = makeEnv();
  try {
    const root = join(env, 'pkgroot');
    for (const bad of ['../../evil.js', '/etc/passwd', 'a/../../evil.js', 'a//b']) {
      const check = validateBinPath(bad, root);
      assert.equal(check.ok, false, bad);
    }
    assert.equal(validateBinPath('./dist/cli.js', root).ok, true);
    // End-to-end: an artifact declaring a traversing bin fails closed.
    const artifact = await buildTarball(env, gatewayFixtureFiles({ bin: { 'project-gateway-mcp': '../../../../tmp/evil.js' } }), GATEWAY_ARTIFACT_NAME);
    assert.ok(existsSync(artifact));
    const run = await runInstaller(['--batch', '--gateway', 'yes', '--pi-guard', 'no', '--artifact-dir', env], fullInstallEnv(env));
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('bin path must not traverse') || run.stdout.includes('escapes the package root'), run.stdout);
    assert.deepEqual(readdirSync(resolveLayout(env).packagesDir), [], 'nothing may be activated');
  } finally {
    cleanupEnv(env);
  }
});
