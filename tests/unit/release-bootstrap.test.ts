/**
 * PS-8A focused tests: release installer bootstrap
 * (src/installer/release/bootstrap.ts) — handoff, envelope validation,
 * package cross-check, per-selection acquisition, no activation before
 * verification, argument forwarding, and staging cleanup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { HostEnvironment } from '../../src/host/environment.js';
import type { InstallOptions, InstallOutcome } from '../../src/installer/install.js';
import {
  COMPATIBILITY_MANIFEST,
  CONFIG_FORMAT_VERSION,
  CONFIGURATION_VERSION,
  GATEWAY_DEPENDENCIES,
  GATEWAY_PACKAGE_VERSION,
  GATEWAY_PS1_BASELINE_COMMIT,
  GIT_LANE_VERSION,
  GIT_RUNTIME_MINIMUM,
  NODE_LANE_VERSION,
  NODE_RUNTIME_MINIMUM,
  PI_COMPATIBILITY_BASELINE,
  PI_GUARD_COMMIT,
  PI_GUARD_TAG,
  PI_GUARD_VERSION,
  PI_RUNTIME_MINIMUM,
  PI_SHUTTLE_VERSION,
} from '../../src/compat/manifest.js';
import { handoffFromEnv, runReleaseBootstrap } from '../../src/installer/release/bootstrap.js';
import type { ReleaseBootstrapHandoff } from '../../src/installer/release/bootstrap.js';
import type { ReleaseFetcher } from '../../src/installer/release/acquire.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function envFor(home: string): HostEnvironment {
  // C3A: the release envelope is validated FOR the host lane; pin the
  // fixture host to the v0.1.0 supported linux lane so the historical
  // harness envelope validates deterministically on any development host.
  return { home, platform: 'linux', arch: 'x64', pathEnv: process.env };
}

interface Harness {
  readonly dir: string;
  readonly home: string;
  readonly envelopePath: string;
  readonly tgzPath: string;
  readonly gatewayBytes: Buffer;
  readonly piGuardBytes: Buffer;
  readonly envelope: Record<string, unknown>;
  readonly fetcher: ReleaseFetcher;
  recordedOptions: Array<InstallOptions>;
  runnerCalls: number;
  runner: (env: HostEnvironment, options: InstallOptions) => Promise<InstallOutcome>;
}

function makeHarness(overrides: { gatewayBytes?: Buffer; piGuardBytes?: Buffer; envelopeTweak?: (env: Record<string, unknown>) => void } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-bootstrap.XXXXXX'));
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  const gatewayBytes = overrides.gatewayBytes ?? Buffer.from('gateway-artifact-bytes');
  const piGuardBytes = overrides.piGuardBytes ?? Buffer.from('piguard-artifact-bytes');
  const envelope: Record<string, unknown> = {
    schemaVersion: 1,
    releaseVersion: PI_SHUTTLE_VERSION,
    piShuttle: { version: PI_SHUTTLE_VERSION, fileName: 'pi-shuttle-0.1.0.tgz', sha256: '' },
    gateway: { packageVersion: GATEWAY_PACKAGE_VERSION, sourceCommit: GATEWAY_PS1_BASELINE_COMMIT, fileName: 'project-gateway-artifact-core-0.1.0.tgz', sha256: sha256(gatewayBytes) },
    piGuard: { version: PI_GUARD_VERSION, sourceCommit: PI_GUARD_COMMIT, sourceTag: PI_GUARD_TAG, fileName: 'pi-guard-0.1.2.tgz', sha256: sha256(piGuardBytes) },
    policy: {
      gatewayDependencies: { ...GATEWAY_DEPENDENCIES },
      configurationVersion: CONFIGURATION_VERSION,
      configFormatVersion: CONFIG_FORMAT_VERSION,
      nodeLaneVersion: NODE_LANE_VERSION,
      gitLaneVersion: GIT_LANE_VERSION,
      nodeRuntimeMinimum: NODE_RUNTIME_MINIMUM,
      gitRuntimeMinimum: GIT_RUNTIME_MINIMUM,
      piCompatibilityBaseline: PI_COMPATIBILITY_BASELINE,
      piRuntimeMinimum: PI_RUNTIME_MINIMUM,
      supportedLanes: [...COMPATIBILITY_MANIFEST.supportedLanes],
    },
  };
  const tgzBytes = Buffer.from('pi-shuttle-package-bytes');
  (envelope.piShuttle as Record<string, unknown>).sha256 = sha256(tgzBytes);
  if (overrides.envelopeTweak !== undefined) overrides.envelopeTweak(envelope);

  const envelopePath = join(dir, 'envelope.json');
  const tgzPath = join(dir, 'pi-shuttle.tgz');
  writeFileSync(envelopePath, JSON.stringify(envelope));
  writeFileSync(tgzPath, tgzBytes);

  const files = new Map<string, Buffer>([
    [(envelope.gateway as Record<string, unknown>).fileName as string, gatewayBytes],
    [(envelope.piGuard as Record<string, unknown>).fileName as string, piGuardBytes],
  ]);
  const fetcher: ReleaseFetcher = async (url) => {
    const name = url.split('/').pop() ?? '';
    const bytes = files.get(name);
    if (bytes === undefined) return { status: 404, body: Readable.from([Buffer.from('missing')]) };
    return { status: 200, body: Readable.from([bytes]), contentLength: bytes.length };
  };

  const harness: Harness = {
    dir,
    home,
    envelopePath,
    tgzPath,
    gatewayBytes,
    piGuardBytes,
    envelope,
    fetcher,
    recordedOptions: [],
    runnerCalls: 0,
    runner: async (_env, options) => {
      harness.runnerCalls += 1;
      harness.recordedOptions.push(options);
      return { kind: 'COMPLETE' };
    },
  };
  return harness;
}

test('bootstrap: handoffFromEnv requires the envelope and package variables', () => {
  const missing = handoffFromEnv({});
  assert.ok('error' in missing);
  const envelopeOnly = handoffFromEnv({ PI_SHUTTLE_RELEASE_ENVELOPE: '/x' });
  assert.ok('error' in envelopeOnly);
  const full = handoffFromEnv({ PI_SHUTTLE_RELEASE_ENVELOPE: '/a', PI_SHUTTLE_PI_SHUTTLE_TGZ: '/b', PI_SHUTTLE_BASE_URL: 'https://example.test' });
  assert.ok(!('error' in full));
  if (!('error' in full)) {
    assert.equal(full.envelopePath, '/a');
    assert.equal(full.piShuttleTgzPath, '/b');
    assert.equal(full.baseUrlOverride, 'https://example.test');
  }
});

test('bootstrap: --help prints usage without any acquisition or install', async () => {
  const h = makeHarness();
  try {
    const handoff: ReleaseBootstrapHandoff = { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath };
    const result = await runReleaseBootstrap(envFor(h.home), handoff, ['--help'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'help');
    assert.equal(h.runnerCalls, 0);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: malformed envelope is refused before any acquisition or install', async () => {
  const h = makeHarness();
  try {
    writeFileSync(h.envelopePath, '{nope');
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'yes', '--pi-guard', 'yes'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ENVELOPE-MALFORMED');
    assert.equal(h.runnerCalls, 0);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: envelope version mismatch is refused', async () => {
  const h = makeHarness({ envelopeTweak: (env) => { env.releaseVersion = '9.9.9'; } });
  try {
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'yes', '--pi-guard', 'yes'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ENVELOPE-VERSION');
    assert.equal(h.runnerCalls, 0);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: pi-shuttle package digest must match the envelope', async () => {
  const h = makeHarness();
  try {
    writeFileSync(h.tgzPath, Buffer.from('tampered-package-bytes'));
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'yes', '--pi-guard', 'yes'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ENVELOPE-MISMATCH');
    assert.equal(h.runnerCalls, 0);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: a non-HTTPS base URL override is refused', async () => {
  const h = makeHarness();
  try {
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath, baseUrlOverride: 'http://127.0.0.1:8080' }, ['--batch', '--gateway', 'yes', '--pi-guard', 'no'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ACQUIRE-PROTOCOL');
    assert.equal(h.runnerCalls, 0);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: acquisition failure refuses with no activation and cleans staging', async () => {
  const h = makeHarness();
  try {
    const failing: ReleaseFetcher = async () => ({ status: 500, body: Readable.from([Buffer.from('boom')]) });
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'yes', '--pi-guard', 'yes'], { fetcher: failing, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ACQUIRE-STATUS');
    assert.equal(h.runnerCalls, 0, 'the install core must never run after an acquisition failure');
    const artifacts = join(h.dir, 'artifacts');
    assert.equal(existsSync(artifacts), false, 'staging must be cleaned up');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: component digest mismatch refuses (tampered artifact bytes)', async () => {
  const h = makeHarness();
  try {
    // The envelope's recorded gateway digest disagrees with the served bytes.
    (h.envelope.gateway as Record<string, unknown>).sha256 = 'f'.repeat(64);
    writeFileSync(h.envelopePath, JSON.stringify(h.envelope));
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'yes', '--pi-guard', 'yes'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ACQUIRE-DIGEST-MISMATCH');
    assert.equal(h.runnerCalls, 0);
    const artifacts = join(h.dir, 'artifacts');
    assert.equal(existsSync(artifacts), false, 'staging must be cleaned up');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: batch gateway-only forwards selections, digest expectations, and staging', async () => {
  const h = makeHarness();
  try {
    // Snapshot the staged artifact directory at runner time (staging is
    // removed after the run returns).
    const record: { staged: string[] | null; stagedDir: string | null } = { staged: null, stagedDir: null };
    const runner = async (env: HostEnvironment, options: InstallOptions): Promise<InstallOutcome> => {
      h.runnerCalls += 1;
      h.recordedOptions.push(options);
      record.stagedDir = options.artifactDir ?? null;
      record.staged = record.stagedDir === null ? null : readdirSync(record.stagedDir);
      return { kind: 'COMPLETE' };
    };
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'yes', '--pi-guard', 'no'], { fetcher: h.fetcher, uid: 12345, installRunner: runner });
    assert.equal(result.kind, 'outcome');
    assert.equal(h.runnerCalls, 1);
    assert.equal(h.recordedOptions.length, 1);
    const options = h.recordedOptions[0]!;
    assert.deepEqual(options.selections, { gateway: true, piGuard: false });
    assert.equal(options.expectGatewaySha256, sha256(h.gatewayBytes));
    assert.equal(options.expectPiGuardSha256, undefined, 'unselected components must not get digest expectations');
    assert.equal(typeof options.artifactDir, 'string');
    // The staged artifact was digest-verified before the runner saw it.
    const snapshot = record.staged;
    assert.ok(snapshot, 'staging snapshot taken');
    assert.ok(snapshot.includes('project-gateway-artifact-core-0.1.0.tgz'), 'gateway artifact staged');
    assert.ok(!snapshot.includes('pi-guard-0.1.2.tgz'), 'only selected components are acquired');
    // Staging is removed after the run completes.
    assert.equal(existsSync(record.stagedDir!), false);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: both components selected acquires both with both digest expectations', async () => {
  const h = makeHarness();
  try {
    const record: { staged: string[] | null } = { staged: null };
    const runner = async (env: HostEnvironment, options: InstallOptions): Promise<InstallOutcome> => {
      h.runnerCalls += 1;
      h.recordedOptions.push(options);
      record.staged = options.artifactDir === undefined ? null : readdirSync(options.artifactDir);
      return { kind: 'COMPLETE' };
    };
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'yes', '--pi-guard', 'yes'], { fetcher: h.fetcher, uid: 12345, installRunner: runner });
    assert.equal(result.kind, 'outcome');
    const options = h.recordedOptions[0]!;
    assert.equal(options.expectGatewaySha256, sha256(h.gatewayBytes));
    assert.equal(options.expectPiGuardSha256, sha256(h.piGuardBytes));
    const snapshot = record.staged;
    assert.ok(snapshot, 'staging snapshot taken');
    assert.ok(snapshot.includes('project-gateway-artifact-core-0.1.0.tgz'));
    assert.ok(snapshot.includes('pi-guard-0.1.2.tgz'));
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: interactive prompts resolve selections before acquisition', async () => {
  const h = makeHarness();
  try {
    const promptUI = async () => ({ selections: { gateway: true, piGuard: false }, installDir: join(h.home, 'share'), binDir: join(h.home, 'bin'), configureProject: false });
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, [], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner, promptUI });
    assert.equal(result.kind, 'outcome');
    const options = h.recordedOptions[0]!;
    assert.deepEqual(options.selections, { gateway: true, piGuard: false });
    assert.equal(options.installDir, join(h.home, 'share'));
    assert.equal(options.binDir, join(h.home, 'bin'));
    assert.equal(options.expectGatewaySha256, sha256(h.gatewayBytes));
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: no components selected runs the core without artifacts', async () => {
  const h = makeHarness();
  try {
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'outcome');
    const options = h.recordedOptions[0]!;
    assert.equal(options.artifactDir, undefined);
    assert.equal(options.expectGatewaySha256, undefined);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: installer argument forwarding (install-dir, bin-dir, unknown flags refused)', async () => {
  const h = makeHarness();
  try {
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'no', '--pi-guard', 'no', '--install-dir', '/tmp/share', '--bin-dir', '/tmp/bin'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'outcome');
    const options = h.recordedOptions[0]!;
    assert.equal(options.installDir, '/tmp/share');
    assert.equal(options.binDir, '/tmp/bin');

    const bad = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--frobnicate'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(bad.kind, 'refused');
    if (bad.kind === 'refused') assert.equal(bad.code, 'ERR-REL-ARGS');
    assert.equal(h.runnerCalls, 1, 'the failed invocation must not reach the runner');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: missing handoff files are refused', async () => {
  const h = makeHarness();
  try {
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: join(h.dir, 'nope.json'), piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ENVELOPE-UNAVAILABLE');
    assert.equal(h.runnerCalls, 0);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: local-artifact-lane options are refused, never silently ignored (F-05)', async () => {
  const h = makeHarness();
  try {
    for (const args of [
      ['--batch', '--gateway', 'no', '--pi-guard', 'no', '--artifact-dir', '/tmp/artifacts'],
      ['--batch', '--gateway', 'no', '--pi-guard', 'no', '--expect-gateway-sha256', 'a'.repeat(64)],
      ['--batch', '--gateway', 'no', '--pi-guard', 'no', '--expect-pi-guard-sha256', 'a'.repeat(64)],
    ]) {
      const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, args, { fetcher: h.fetcher, uid: 12345, installRunner: h.runner });
      assert.equal(result.kind, 'refused');
      if (result.kind === 'refused') assert.equal(result.code, 'ERR-REL-ARGS');
    }
    assert.equal(h.runnerCalls, 0, 'local-lane flags must never reach the runner');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: interactive prompts with a non-TTY stdin refuse instead of EOF-defaulting (F-01)', async () => {
  const h = makeHarness();
  try {
    // No selections, no injected promptUI, stdin not a terminal: the real
    // prompt path would hit EOF and silently default — must refuse.
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, [], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner, stdinIsTTY: false });
    assert.equal(result.kind, 'refused');
    if (result.kind === 'refused') {
      assert.equal(result.code, 'ERR-REL-INTERACTIVE-TTY');
      assert.match(result.message, /explicit selections/);
    }
    assert.equal(h.runnerCalls, 0, 'no activation may happen without selections');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: explicit batch selections under non-TTY input proceed without prompts (F-01)', async () => {
  const h = makeHarness();
  try {
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], { fetcher: h.fetcher, uid: 12345, installRunner: h.runner, stdinIsTTY: false });
    assert.equal(result.kind, 'outcome');
    assert.equal(h.runnerCalls, 1, 'explicit selections must proceed without a terminal');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('bootstrap: an injected prompt session still resolves selections (interactive path preserved)', async () => {
  const h = makeHarness();
  try {
    // The injected promptUI simulates a terminal session; the F-01 guard
    // must not block the injectable seam used by tests and by the shell
    // when a controlling terminal exists.
    const result = await runReleaseBootstrap(envFor(h.home), { envelopePath: h.envelopePath, piShuttleTgzPath: h.tgzPath }, [], {
      fetcher: h.fetcher,
      uid: 12345,
      installRunner: h.runner,
      stdinIsTTY: false,
      promptUI: async () => ({ selections: { gateway: false, piGuard: false }, configureProject: false }),
    });
    assert.equal(result.kind, 'outcome');
    assert.equal(h.runnerCalls, 1);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
