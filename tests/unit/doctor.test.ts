/**
 * PS-4 focused tests: the full doctor probe suite — closed status
 * vocabulary, every probe verdict on synthetic local states, exit-code
 * classification 0/1/2, honest tunnel/ChatGPT deferral notes, and
 * read-only discipline (no bootstrap invocation, no lock deletion).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDoctorReport, runDoctor, STATUS_VOCABULARY } from '../../src/command/doctor.js';
import type { DoctorCheck } from '../../src/command/doctor.js';
import { resolveLayout } from '../../src/host/environment.js';
import { cleanupEnv, installFixtureGateway, makeEnv, makeHealthyEnv, makeProjectRoot, writeReceiptFixture, writeFakeGit, writeRuntimeDocument } from '../helpers/lifecycle-fixtures.js';
import { writeFakePi } from '../helpers/installer-fixtures.js';

function healthyContext(options: { readonly withRuntimeConfig?: boolean; readonly withPiGuard?: boolean } = {}) {
  const healthy = makeHealthyEnv(options);
  return {
    env: healthy.env,
    root: healthy.root,
    layout: healthy.layout,
    ctx: { env: { home: healthy.env, platform: 'linux', arch: 'x64' }, layout: healthy.layout, nodeExecutable: process.execPath, pathEnv: healthy.pathEnv },
  };
}

function verdicts(report: { readonly checks: readonly DoctorCheck[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const check of report.checks) out[check.id] = check.verdict;
  return out;
}

test('doctor: the status vocabulary is exactly the closed contract set', () => {
  assert.deepEqual([...STATUS_VOCABULARY], ['supported', 'unsupported', 'installed but unverified', 'missing', 'partial installation']);
});

test('doctor: every status vocabulary value renders exactly on synthetic states', () => {
  const checks: DoctorCheck[] = STATUS_VOCABULARY.map((verdict, i) => ({ id: `check-${i}`, label: `synthetic-${i}`, verdict, detail: 'synthetic state' }));
  const rendered = formatDoctorReport({ checks, notes: [] });
  for (const verdict of STATUS_VOCABULARY) {
    assert.ok(rendered.includes(`: ${verdict} —`), `rendered output must contain the exact vocabulary value: ${verdict}`);
  }
  assert.ok(rendered.startsWith('pi-shuttle doctor\n'));
});

test('doctor: complete healthy local setup exits 0 (all implemented checks pass)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 0, formatDoctorReport(result.report));
    const v = verdicts(result.report);
    for (const id of ['platform', 'node', 'git', 'pi', 'receipt', 'gateway', 'pi-guard', 'runtime-config', 'project-0', 'git-isolation-0', 'locks']) {
      assert.equal(v[id], 'supported', `check ${id} must be supported: ${formatDoctorReport(result.report)}`);
    }
    assert.ok(result.report.notes.some((n) => n.includes('PS-7')), 'tunnel/ChatGPT deferral must be noted');
    assert.ok(result.report.notes.some((n) => n.includes('read-only')), 'trusted-store limitation must be noted truthfully');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: missing installation receipt is a finding (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    rmSync(join(env, '.local', 'state', 'pi-shuttle', 'install.json'));
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['receipt'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: partial installation is reported with the omitted components (exit 1)', async () => {
  const { env, ctx } = healthyContext({ withPiGuard: false });
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['receipt'], 'partial installation');
    assert.equal(verdicts(result.report)['pi-guard'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: invalid installation receipt fails closed (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    writeFileSync(join(env, '.local', 'state', 'pi-shuttle', 'install.json'), '{"foreign": true}', { mode: 0o600 });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.ok(result.message.includes('receipt'), result.message);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway missing (receipt entry gone, package absent) is a finding (exit 1)', async () => {
  const { env, ctx, layout } = healthyContext();
  try {
    const gatewayDir = join(layout.packagesDir, 'project-gateway-artifact-core@0.1.0');
    rmSync(gatewayDir, { recursive: true, force: true });
    writeReceiptFixture(env, { gateway: null, piGuard: null, result: 'PARTIAL', omitted: ['project-gateway-mcp'] });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway package present without a receipt record is installed but unverified (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    writeReceiptFixture(env, { gateway: null, piGuard: null, result: 'PARTIAL', omitted: ['project-gateway-mcp'] });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'installed but unverified');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway installed-unverified is reported truthfully (exit 1)', async () => {
  const { env, root, ctx } = healthyContext({ withRuntimeConfig: false });
  try {
    const layout = resolveLayout(env);
    const gateway = installFixtureGateway(env);
    writeReceiptFixture(env, { gateway: { status: 'installed-unverified', installPath: gateway.installPath, binPath: gateway.binPath } });
    void root;
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'installed but unverified');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: gateway package removed from disk after install is missing (exit 1)', async () => {
  const { env, root, ctx } = healthyContext({ withRuntimeConfig: false });
  try {
    const layout = resolveLayout(env);
    const gateway = installFixtureGateway(env);
    writeReceiptFixture(env);
    rmSync(gateway.installPath, { recursive: true, force: true });
    void root;
    void layout;
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['gateway'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: pi baseline is supported; pi non-baseline is unsupported (exit 2, never claimed)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const supported = await runDoctor(ctx);
    assert.equal(supported.ok, true);
    if (supported.ok) assert.equal(verdicts(supported.report)['pi'], 'supported');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: pi below the minimum is unsupported (exit 2); a candidate is healthy only with a PASSING probe', async () => {
  const { env, ctx } = healthyContext();
  try {
    const binDir = join(env, 'fixture-bin');
    writeFakePi(binDir);
    // Below minimum (0.82.9): unsupported (exit 2).
    const below = await runDoctor({ ...ctx, pathEnv: { ...ctx.pathEnv, FIXTURE_PI_VERSION: '0.82.9' } });
    assert.equal(below.ok, true);
    if (!below.ok) return;
    assert.equal(below.exitCode, 2);
    assert.equal(verdicts(below.report)['pi'], 'unsupported');
    // Candidate (0.84.1) without a probe seam: the real probe cannot run
    // (fixture pi has no extension loader) → unverifiable finding (exit 1),
    // never silently green.
    const unprobed = await runDoctor({ ...ctx, pathEnv: { ...ctx.pathEnv, FIXTURE_PI_VERSION: '0.84.1' } });
    assert.equal(unprobed.ok, true);
    if (!unprobed.ok) return;
    assert.equal(verdicts(unprobed.report)['pi'], 'installed but unverified');
    assert.equal(unprobed.exitCode, 1);
    // Candidate with a PASSING probe → supported (doctor healthy).
    const passed = await runDoctor({
      ...ctx,
      pathEnv: { ...ctx.pathEnv, FIXTURE_PI_VERSION: '0.84.1' },
      piGuardProbe: async () => ({ ok: true, detail: 'fixture probe PASS', infrastructure: false }),
    });
    assert.equal(passed.ok, true);
    if (!passed.ok) return;
    assert.equal(passed.exitCode, 0, formatDoctorReport(passed.report));
    assert.equal(verdicts(passed.report)['pi'], 'supported');
    // Candidate with a FAILING probe → unsupported (doctor unhealthy).
    const failed = await runDoctor({
      ...ctx,
      pathEnv: { ...ctx.pathEnv, FIXTURE_PI_VERSION: '0.84.1' },
      piGuardProbe: async () => ({ ok: false, detail: 'fixture probe FAIL', infrastructure: false }),
    });
    assert.equal(failed.ok, true);
    if (!failed.ok) return;
    assert.equal(failed.exitCode, 2);
    assert.equal(verdicts(failed.report)['pi'], 'unsupported');
    assert.ok(failed.report.checks.find((c) => c.id === 'pi')!.detail.includes('probe FAIL'), 'detail names the probe failure');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git missing is a finding; wrong evidence lane is unsupported (exit 2)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const noGitPathEnv = { ...ctx.pathEnv, PATH: join(env, 'no-git') };
    mkdirSync(join(env, 'no-git'), { mode: 0o700 });
    const missing = await runDoctor({ ...ctx, pathEnv: noGitPathEnv });
    assert.equal(missing.ok, true);
    if (missing.ok) {
      assert.equal(verdicts(missing.report)['git'], 'missing');
      assert.equal(missing.exitCode, 1);
    }
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git wrong version below the minimum is unsupported (exit 2); newer versions are healthy', async () => {
  const { env, ctx } = healthyContext();
  try {
    const binDir = join(env, 'fixture-bin');
    // Below the minimum 2.30.0 → unsupported (exit 2).
    writeFakeGit(binDir, '2.29.9');
    const below = await runDoctor({ ...ctx, pathEnv: ctx.pathEnv });
    assert.equal(below.ok, true);
    if (!below.ok) return;
    assert.equal(below.exitCode, 2);
    assert.equal(verdicts(below.report)['git'], 'unsupported');
    // Newer version (2.50.1): a difference from the CI baseline alone is
    // never a failure — supported (doctor healthy).
    writeFakeGit(binDir, '2.50.1');
    const newer = await runDoctor({ ...ctx, pathEnv: ctx.pathEnv });
    assert.equal(newer.ok, true);
    if (!newer.ok) return;
    assert.equal(newer.exitCode, 0, formatDoctorReport(newer.report));
    assert.equal(verdicts(newer.report)['git'], 'supported');
    const detail = newer.report.checks.find((c) => c.id === 'git')!.detail;
    assert.ok(detail.includes('2.50.1'), 'detail reports the actual version');
    assert.ok(detail.includes('minimum 2.30.0'), 'detail reports the minimum');
    assert.ok(detail.includes('2.45.4'), 'detail reports the validated CI baseline');
    // Exact minimum 2.30.0 is accepted.
    writeFakeGit(binDir, '2.30.0');
    const exactMin = await runDoctor({ ...ctx, pathEnv: ctx.pathEnv });
    assert.equal(exactMin.ok, true);
    if (!exactMin.ok) return;
    assert.equal(exactMin.exitCode, 0, formatDoctorReport(exactMin.report));
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git present with unparseable version is installed but unverified (exit 1)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const binDir = join(env, 'fixture-bin');
    writeFileSync(join(binDir, 'git'), `#!/usr/bin/env node
process.stdout.write('weird git output\n');
process.exit(0);
`, { mode: 0o700 });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(verdicts(result.report)['git'], 'installed but unverified');
    assert.equal(result.exitCode, 1);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: runtime config missing is a finding; malformed fails closed (exit 1)', async () => {
  const { env, ctx, layout } = healthyContext({ withRuntimeConfig: false });
  try {
    const missing = await runDoctor(ctx);
    assert.equal(missing.ok, true);
    if (missing.ok) {
      assert.equal(verdicts(missing.report)['runtime-config'], 'missing');
      assert.equal(missing.exitCode, 1);
    }
    writeRuntimeDocument(env, { surfaces: [{ foreign: true }] });
    const malformed = await runDoctor(ctx);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.exitCode, 1);
    assert.ok(malformed.message.includes('runtime configuration'), malformed.message);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: project root missing is a finding (exit 1)', async () => {
  const { env, root, ctx } = healthyContext();
  try {
    rmSync(root, { recursive: true, force: true });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['project-0'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: stale coordination lock artifacts are detected with recovery guidance (exit 1, never auto-deleted)', async () => {
  const { env, ctx, layout } = healthyContext();
  try {
    writeFileSync(`${layout.runtimeConfigPath}.lock`, '9999\n', { mode: 0o600 });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    const lockCheck = result.report.checks.find((c) => c.id === 'locks')!;
    assert.equal(lockCheck.verdict, 'installed but unverified');
    assert.ok(lockCheck.detail.includes('never auto-stolen'), lockCheck.detail);
    assert.ok(lockCheck.detail.includes('remove'), lockCheck.detail);
    // Doctor must NOT delete the lock.
    assert.equal(existsSync(`${layout.runtimeConfigPath}.lock`), true);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: darwin arm64 and darwin Intel platforms are supported (PS-6/PS-6I promoted lanes); windows fails closed exit 2', async () => {
  const { env, ctx } = healthyContext();
  try {
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' } });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['platform'], 'supported', 'macOS arm64 is a first-class claimed lane');
    const intel = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'x64' } });
    assert.equal(intel.ok, true);
    if (!intel.ok) return;
    assert.equal(verdicts(intel.report)['platform'], 'supported', 'macOS Intel is a first-class claimed lane (PS-6I)');
    assert.ok(intel.report.checks.find((c) => c.id === 'platform')!.detail.includes('darwin-x86_64-posix-utf8-node22'), 'Intel lane is reported by its trusted lane constant');
    const windows = await runDoctor({ ...ctx, env: { home: env, platform: 'win32', arch: 'x64' } });
    assert.equal(windows.ok, true);
    if (!windows.ok) return;
    assert.equal(windows.exitCode, 2);
    assert.equal(verdicts(windows.report)['platform'], 'unsupported');
  } finally {
    cleanupEnv(env);
  }
});

// ─── PS-6 darwin Node architecture probe ──────────────────────────────────

/** Fake node executable with a deterministic `--version` / `-p process.arch` surface. */
function writeFakeNode(binDir: string, arch: string | null): string {
  const node = join(binDir, 'node');
  const lines = [
    '#!/usr/bin/env bash',
    'if [ "$1" = "--version" ]; then echo "v22.23.2"; exit 0; fi',
    arch === null
      ? 'if [ "$1" = "-p" ] && [ "$2" = "process.arch" ]; then exit 1; fi'
      : `if [ "$1" = "-p" ] && [ "$2" = "process.arch" ]; then echo "${arch}"; exit 0; fi`,
    'exit 1',
    '',
  ];
  writeFileSync(node, lines.join('\n'), { mode: 0o700 });
  return node;
}

test('doctor: darwin-arm64 lane — native arm64 Node is supported', async () => {
  const { env, ctx } = healthyContext();
  try {
    const node = writeFakeNode(env, 'arm64');
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' }, nodeExecutable: node });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['node'], 'supported');
    assert.ok(darwin.report.checks.find((c) => c.id === 'node')!.detail.includes('arm64'), 'the arch fact must be part of the supported claim');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: darwin-arm64 lane — Rosetta/x64 Node is unsupported (fail closed)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const node = writeFakeNode(env, 'x64');
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' }, nodeExecutable: node });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['node'], 'unsupported');
    assert.equal(darwin.exitCode, 2, 'an unsupported node arch on the darwin-arm64 lane fails closed');
    assert.ok(darwin.report.checks.find((c) => c.id === 'node')!.detail.includes('Rosetta'), 'the detail must name the Rosetta/x64 reason');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: darwin-arm64 lane — unobservable architecture probe is installed-but-unverified (truthful)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const node = writeFakeNode(env, null);
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' }, nodeExecutable: node });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['node'], 'installed but unverified');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: Linux behavior is unaffected by the darwin arch probe (no arch probe on linux)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const node = writeFakeNode(env, 'x64'); // would fail the darwin lane
    const linux = await runDoctor({ ...ctx, env: { home: env, platform: 'linux', arch: 'x64' }, nodeExecutable: node });
    assert.equal(linux.ok, true);
    if (!linux.ok) return;
    assert.equal(verdicts(linux.report)['node'], 'supported', 'the linux lane never requires the architecture probe');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: Windows-like platform is unsupported (exit 2)', async () => {
  const { env, ctx } = healthyContext();
  try {
    const win = await runDoctor({ ...ctx, env: { home: env, platform: 'win32', arch: 'x64' } });
    assert.equal(win.ok, true);
    if (!win.ok) return;
    assert.equal(win.exitCode, 2);
    assert.equal(verdicts(win.report)['platform'], 'unsupported');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: tunnel/ChatGPT readiness is reported as not locally observable, never fabricated', async () => {
  const { env, ctx } = healthyContext();
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const rendered = formatDoctorReport(result.report);
    assert.ok(rendered.includes('not locally observable'), rendered);
    assert.ok(!rendered.includes('tunnel ready'), 'readiness must never be fabricated');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: git isolation dirs missing is a finding (exit 1)', async () => {
  const { env, ctx, layout } = healthyContext();
  try {
    rmSync(join(layout.gitHomeDir, '0123456789abcdef0123456789abcdef'), { recursive: true, force: true });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    assert.equal(verdicts(result.report)['git-isolation-0'], 'missing');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: symlinked project root resolves canonically in the project check', async () => {
  const healthy = makeHealthyEnv();
  try {
    // Replace the project root with a symlink to a real root; the doctor
    // canonicalizes through the host seam and must report supported.
    rmSync(healthy.root, { recursive: true, force: true });
    const real = makeProjectRoot(healthy.env, 'real-root');
    symlinkSync(real, healthy.root);
    const layout = resolveLayout(healthy.env);
    const result = await runDoctor({ env: { home: healthy.env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv: healthy.pathEnv });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(verdicts(result.report)['project-0'], 'supported');
      assert.equal(result.exitCode, 0);
    }
  } finally {
    cleanupEnv(healthy.env);
  }
});
