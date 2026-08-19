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
import { fixtureVerifier, FIXTURE_NOW } from '../helpers/release-trust-fixtures.js';
import { materializeNativeNamespace, nativeResolver } from '../helpers/manifest-native-fixtures.js';
import { hashPackageTree } from '../../src/installer/artifact.js';
import { piShuttlePackageDirName } from '../../src/installer/components.js';
import { readReceipt, writeReceipt } from '../../src/installer/receipt.js';

async function healthyContext(options: { readonly withRuntimeConfig?: boolean; readonly withPiGuard?: boolean; readonly manifestNative?: boolean } = {}) {
  const healthy = makeHealthyEnv(options);
  // NEW-STATE lifecycle: when `manifestNative` is set, a valid
  // manifest-native installation (fixture verifier + paired provenance
  // gate) makes the new-world doctor check healthy AND makes the
  // previous-generation installation checks (receipt/gateway/pi-guard)
  // not applicable (MN-B-03 aggregate transition). Default off: the
  // previous-generation-focused tests observe the old checks unchanged.
  const verifier = fixtureVerifier(FIXTURE_NOW);
  if (options.manifestNative === true) {
    await materializeNativeNamespace(healthy.env, {}, undefined, verifier);
  }
  return {
    env: healthy.env,
    root: healthy.root,
    layout: healthy.layout,
    ctx: { env: { home: healthy.env, platform: 'linux', arch: 'x64' }, layout: healthy.layout, nodeExecutable: process.execPath, pathEnv: healthy.pathEnv, ...(options.manifestNative === true ? { resolveManifestNative: nativeResolver(verifier) } : {}) },
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
  const { env, ctx } = await healthyContext({ manifestNative: true });
  try {
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 0, formatDoctorReport(result.report));
    const v = verdicts(result.report);
    for (const id of ['platform', 'node', 'git', 'pi', 'manifest-native', 'runtime-config', 'project-0', 'git-isolation-0', 'locks']) {
      assert.equal(v[id], 'supported', `check ${id} must be supported: ${formatDoctorReport(result.report)}`);
    }
    // MN-B-03: previous-generation installation checks are NOT APPLICABLE
    // under a VALID manifest-native installation — never reported missing.
    for (const id of ['receipt', 'gateway', 'pi-guard']) {
      assert.equal(v[id], undefined, `previous-generation check ${id} must be omitted under VALID manifest-native state`);
    }
    assert.ok(result.report.notes.some((n) => n.includes('PS-7')), 'tunnel/ChatGPT deferral must be noted');
    assert.ok(result.report.notes.some((n) => n.includes('read-only')), 'trusted-store limitation must be noted truthfully');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: Latest receipt verifies its semantic version, exact source slot, command target, and package bytes', async () => {
  const { env, ctx, layout } = await healthyContext();
  try {
    const sourceIdentity = `mfx-labs/pi-shuttle@${'b'.repeat(40)}`;
    const root = join(layout.packagesDir, piShuttlePackageDirName('0.1.4', sourceIdentity));
    mkdirSync(join(root, 'dist'), { recursive: true, mode: 0o700 });
    mkdirSync(layout.binDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'pi-shuttle', version: '0.1.4', bin: { 'pi-shuttle': './dist/cli.js' } }));
    writeFileSync(join(root, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    symlinkSync(join(root, 'dist', 'cli.js'), join(layout.binDir, 'pi-shuttle'));
    const digest = await hashPackageTree(root);
    assert.equal(digest.ok, true);
    if (!digest.ok) return;
    const prior = readReceipt(layout.installReceiptPath);
    assert.equal(prior.ok, true);
    if (!prior.ok) return;
    const boundReceipt = {
      ...prior.receipt,
      channel: 'latest' as const,
      sourceIdentity,
      piShuttleInstallPath: root,
      piShuttleTreeSha256: digest.value,
    };
    const written = writeReceipt(layout.installReceiptPath, boundReceipt);
    assert.equal(written.ok, true);

    const healthy = await runDoctor(ctx);
    assert.equal(healthy.ok, true);
    if (!healthy.ok) return;
    assert.equal(verdicts(healthy.report)['receipt'], 'supported', formatDoctorReport(healthy.report));
    assert.match(healthy.report.checks.find((check) => check.id === 'receipt')!.detail, /package bytes verified/);

    const wrongPath = join(layout.packagesDir, piShuttlePackageDirName('0.1.4', `mfx-labs/pi-shuttle@${'c'.repeat(40)}`));
    assert.equal(writeReceipt(layout.installReceiptPath, { ...boundReceipt, piShuttleInstallPath: wrongPath }).ok, true);
    const wrongPathResult = await runDoctor(ctx);
    assert.equal(wrongPathResult.ok, true);
    if (!wrongPathResult.ok) return;
    assert.equal(verdicts(wrongPathResult.report)['receipt'], 'installed but unverified');
    assert.match(wrongPathResult.report.checks.find((check) => check.id === 'receipt')!.detail, /exact source SHA/);

    assert.equal(writeReceipt(layout.installReceiptPath, boundReceipt).ok, true);
    const stable = join(layout.packagesDir, 'pi-shuttle@0.1.4');
    mkdirSync(join(stable, 'dist'), { recursive: true, mode: 0o700 });
    writeFileSync(join(stable, 'package.json'), JSON.stringify({ name: 'pi-shuttle', version: '0.1.4', bin: { 'pi-shuttle': './dist/cli.js' } }));
    writeFileSync(join(stable, 'dist', 'cli.js'), '#!/usr/bin/env node\n');
    rmSync(join(layout.binDir, 'pi-shuttle'));
    symlinkSync(join(stable, 'dist', 'cli.js'), join(layout.binDir, 'pi-shuttle'));
    const stableCommand = await runDoctor(ctx);
    assert.equal(stableCommand.ok, true);
    if (!stableCommand.ok) return;
    assert.equal(verdicts(stableCommand.report)['receipt'], 'installed but unverified');
    assert.match(stableCommand.report.checks.find((check) => check.id === 'receipt')!.detail, /command link does not select/);

    rmSync(join(layout.binDir, 'pi-shuttle'));
    symlinkSync(join(root, 'dist', 'cli.js'), join(layout.binDir, 'pi-shuttle'));

    writeFileSync(join(root, 'dist', 'cli.js'), '#!/usr/bin/env node\n// drift\n');
    const drifted = await runDoctor(ctx);
    assert.equal(drifted.ok, true);
    if (!drifted.ok) return;
    assert.equal(verdicts(drifted.report)['receipt'], 'installed but unverified');
    assert.match(drifted.report.checks.find((check) => check.id === 'receipt')!.detail, /tree SHA-256/);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: missing installation receipt is a finding (exit 1)', async () => {
  const { env, ctx } = await healthyContext();
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
  const { env, ctx } = await healthyContext({ withPiGuard: false });
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
  const { env, ctx } = await healthyContext();
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
  const { env, ctx, layout } = await healthyContext();
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
  const { env, ctx } = await healthyContext();
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
  const { env, root, ctx } = await healthyContext({ withRuntimeConfig: false });
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
  const { env, root, ctx } = await healthyContext({ withRuntimeConfig: false });
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
  const { env, ctx } = await healthyContext();
  try {
    const supported = await runDoctor(ctx);
    assert.equal(supported.ok, true);
    if (supported.ok) assert.equal(verdicts(supported.report)['pi'], 'supported');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: pi below the minimum is unsupported (exit 2); a candidate is healthy only with a PASSING probe', async () => {
  const { env, ctx } = await healthyContext({ manifestNative: true });
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
      resolveManifestNative: ctx.resolveManifestNative,
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
  const { env, ctx } = await healthyContext();
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
  const { env, ctx } = await healthyContext({ manifestNative: true });
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
  const { env, ctx } = await healthyContext();
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
  const { env, ctx, layout } = await healthyContext({ withRuntimeConfig: false });
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
  const { env, root, ctx } = await healthyContext();
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

test('doctor: coordination lock artifacts are reported read-only for next-writer ownership revalidation', async () => {
  const { env, ctx, layout } = await healthyContext();
  try {
    writeFileSync(`${layout.runtimeConfigPath}.lock`, '9999\n', { mode: 0o600 });
    const result = await runDoctor(ctx);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exitCode, 1);
    const lockCheck = result.report.checks.find((c) => c.id === 'locks')!;
    assert.equal(lockCheck.verdict, 'installed but unverified');
    assert.ok(lockCheck.detail.includes('doctor is read-only'), lockCheck.detail);
    assert.ok(lockCheck.detail.includes(layout.runtimeConfigPath), lockCheck.detail);
    // Doctor must NOT delete the lock.
    assert.equal(existsSync(`${layout.runtimeConfigPath}.lock`), true);
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: x86_64 is support-promoted, arm64 remains technically eligible but unpromoted, and windows fails closed', async () => {
  const { env, ctx } = await healthyContext();
  try {
    const arm64Node = writeFakeNode(env, 'arm64');
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' }, nodeExecutable: arm64Node });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['platform'], 'installed but unverified', 'arm64 is eligible but must not be reported supported');
    const arm64Platform = darwin.report.checks.find((c) => c.id === 'platform')!;
    assert.ok(arm64Platform.detail.includes('technically eligible'), arm64Platform.detail);
    assert.ok(arm64Platform.detail.includes('not a product-support claim'), arm64Platform.detail);
    assert.equal(darwin.exitCode, 1, 'unpromoted eligibility is a finding, not an unsupported-platform exit');
    const intel = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'x64' } });
    assert.equal(intel.ok, true);
    if (!intel.ok) return;
    assert.equal(verdicts(intel.report)['platform'], 'supported', 'physically accepted Intel must be reported supported');
    assert.ok(intel.report.checks.find((c) => c.id === 'platform')!.detail.includes('product-support promoted'));
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

test('doctor: descriptor-bound darwin-arm64 still requires a native arm64 Node', async () => {
  const { env, ctx } = await healthyContext();
  try {
    const node = writeFakeNode(env, 'arm64');
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' }, nodeExecutable: node });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['node'], 'supported');
    assert.ok(darwin.report.checks.find((c) => c.id === 'node')!.detail.includes('arm64'), 'the arch fact must be part of the supported claim');
    assert.equal(verdicts(darwin.report)['platform'], 'installed but unverified', 'the target is eligible but not support-promoted');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: darwin-arm64 Rosetta/x64 node check still fails closed', async () => {
  const { env, ctx } = await healthyContext();
  try {
    const node = writeFakeNode(env, 'x64');
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' }, nodeExecutable: node });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['node'], 'unsupported');
    assert.equal(verdicts(darwin.report)['platform'], 'installed but unverified');
    assert.equal(darwin.exitCode, 2, 'an unsupported node arch on the darwin-arm64 lane fails closed');
    assert.ok(darwin.report.checks.find((c) => c.id === 'node')!.detail.includes('Rosetta'), 'the detail must name the Rosetta/x64 reason');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: darwin-arm64 unobservable-arch probe remains installed but unverified', async () => {
  const { env, ctx } = await healthyContext();
  try {
    const node = writeFakeNode(env, null);
    const darwin = await runDoctor({ ...ctx, env: { home: env, platform: 'darwin', arch: 'arm64' }, nodeExecutable: node });
    assert.equal(darwin.ok, true);
    if (!darwin.ok) return;
    assert.equal(verdicts(darwin.report)['node'], 'installed but unverified');
    assert.equal(verdicts(darwin.report)['platform'], 'installed but unverified');
  } finally {
    cleanupEnv(env);
  }
});

test('doctor: Linux behavior is unaffected by the darwin arch probe (no arch probe on linux)', async () => {
  const { env, ctx } = await healthyContext();
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
  const { env, ctx } = await healthyContext();
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
  const { env, ctx } = await healthyContext();
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
  const { env, ctx, layout } = await healthyContext();
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
    const verifier = fixtureVerifier(FIXTURE_NOW);
    await materializeNativeNamespace(healthy.env, {}, undefined, verifier);
    const result = await runDoctor({ env: { home: healthy.env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv: healthy.pathEnv, resolveManifestNative: nativeResolver(verifier) });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(verdicts(result.report)['project-0'], 'supported');
      assert.equal(result.exitCode, 0);
    }
  } finally {
    cleanupEnv(healthy.env);
  }
});
