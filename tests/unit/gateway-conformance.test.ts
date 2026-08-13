/**
 * PS-4 — SIR-PS2-009 conformance closure: BLACK-BOX check that a
 * pi-shuttle-produced/persisted runtime configuration is accepted by the
 * exact installed/pinned Gateway runtime boundary (the real Gateway CLI
 * startup loader), and that deliberately drifted/invalid documents are
 * rejected by that boundary. The Gateway remains authoritative; pi-shuttle
 * imports nothing from the Gateway.
 *
 * The fixture is the EXACT local Gateway PS-1 artifact: the pinned
 * development checkout (default
 * `/home/chef/Documents/Project_Gateway_MCP/dist/runtime/mcp/cli.js`,
 * package version 0.1.0, baseline commit 7f3b4af...). The CLI is invoked
 * IN PLACE (its ESM imports resolve within the pinned checkout — it is
 * never copied), and nothing in the Gateway repository is modified:
 * bootstrap runs against a throwaway HOME and locator; the startup probe
 * is a bounded spawn with stdin EOF. When the fixture is absent (other
 * machines), the suite skips with a truthful note — the pinned checkout is
 * a local-only release dependency.
 *
 * Acceptance probe: the Gateway startup CLI loads the config, composes the
 * trusted registry (store verification), and then serves the stdio MCP
 * server. Acceptance = the process is still alive after a bounded window
 * (rejection exits 1 with a diagnostic within milliseconds) and then
 * shuts down cleanly on stdin EOF (exit 0).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { resolveLayout } from '../../src/host/environment.js';
import { addProject } from '../../src/lifecycle/projects.js';
import { cleanupEnv, makeEnv, makeProjectRoot, writeReceiptFixture } from '../helpers/lifecycle-fixtures.js';
import { resolveExecutable, runProcess } from '../../src/process/runner.js';

/** The exact pinned Gateway CLI fixture (PS-1 baseline; read-only, invoked in place). */
const GATEWAY_CLI = process.env.PI_SHUTTLE_TEST_GATEWAY_CLI ?? '/home/chef/Documents/Project_Gateway_MCP/dist/runtime/mcp/cli.js';
/** The pinned Gateway checkout root (package root for the receipt record). */
const GATEWAY_ROOT = join(dirname(GATEWAY_CLI), '..', '..', '..');

/**
 * Wait for the startup probe verdict: accepted (alive) or rejected (exited).
 * SIR-PS4-005: after stdin EOF the shutdown wait is BOUNDED — if the
 * Gateway does not close within the deadline, the test child is killed
 * safely and the probe reports a conformance timeout (never hangs the
 * suite). The alive-window proof is unchanged.
 */
function probeStartup(configPath: string, aliveWindowMs = 4000, shutdownDeadlineMs = 4000): Promise<{ readonly accepted: boolean; readonly code: number | null; readonly timedOut: boolean; readonly stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [GATEWAY_CLI, '--config', configPath], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    let aliveTimer: NodeJS.Timeout | undefined;
    let shutdownTimer: NodeJS.Timeout | undefined;
    const finish = (accepted: boolean, code: number | null, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      if (aliveTimer !== undefined) clearTimeout(aliveTimer);
      if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
      resolve({ accepted, code, timedOut, stderr });
    };
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('close', (code) => {
      if (shutdownTimer === undefined) {
        // The child exited within the alive window: the loader rejected
        // the document (rejection exits 1 with a diagnostic quickly).
        finish(false, code, false);
        return;
      }
      // Clean EOF-driven shutdown within the bounded deadline: accepted.
      finish(true, code, false);
    });
    aliveTimer = setTimeout(() => {
      // Still alive after the window: the loader accepted the document and
      // the server is serving. EOF shuts the SDK down cleanly.
      child.stdin.end();
      shutdownTimer = setTimeout(() => {
        // Bounded shutdown wait (SIR-PS4-005): the Gateway did not close
        // after EOF within the deadline — kill the test child safely and
        // fail with a clear conformance-timeout result.
        child.kill('SIGKILL');
        finish(true, null, true);
      }, shutdownDeadlineMs);
    }, aliveWindowMs);
  });
}

/** A real git repository root (real git lane; the add flow requires the repo probe). */
async function makeGitRepoRoot(env: string): Promise<string> {
  const root = makeProjectRoot(env, 'repo');
  const gitPath = resolveExecutable('git');
  if (gitPath === null) throw new Error('no git on PATH for the conformance fixture');
  const run = await runProcess(gitPath, ['init', '-q', root]);
  if (run.exitCode !== 0) throw new Error(`git init failed: ${run.stderr}`);
  return root;
}

function gatewayFixtureAvailable(): boolean {
  return existsSync(GATEWAY_CLI) && existsSync(join(GATEWAY_ROOT, 'package.json'));
}

test('SIR-PS2-009: pi-shuttle runtime config is accepted by the exact Gateway startup boundary', async (t) => {
  if (!gatewayFixtureAvailable()) {
    t.skip(`pinned Gateway CLI fixture not present at ${GATEWAY_CLI}; set PI_SHUTTLE_TEST_GATEWAY_CLI to run the black-box conformance check`);
    return;
  }
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    // The receipt pins the REAL Gateway executable (invoked in place).
    writeReceiptFixture(env, {
      gateway: { status: 'installed-verified', installPath: GATEWAY_ROOT, binPath: GATEWAY_CLI },
      piGuard: null,
      result: 'COMPLETE',
      omitted: [],
    });
    const root = await makeGitRepoRoot(env);

    // Full production composition path: pi-shuttle project add against the
    // REAL Gateway bootstrap verb (real store initialization in the
    // throwaway HOME; the real git 2.45.4 evidence lane is on PATH).
    const pathEnv = { ...process.env, HOME: env };
    const outcome = await addProject({ env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv }, root);
    assert.equal(outcome.exitCode, 0, outcome.stderr);

    // BLACK-BOX acceptance probe against the exact pinned runtime boundary.
    const probe = await probeStartup(layout.runtimeConfigPath);
    assert.equal(probe.timedOut, false, `conformance timeout: the Gateway did not shut down after stdin EOF within the bounded deadline: ${probe.stderr}`);
    assert.equal(probe.accepted, true, `the persisted pi-shuttle runtime config must be accepted by the Gateway startup loader (probe exit ${probe.code}): ${probe.stderr}`);
    assert.equal(probe.code, 0, `clean EOF shutdown expected: ${probe.stderr}`);
  } finally {
    cleanupEnv(env);
  }
});

test('SIR-PS2-009: deliberately drifted/invalid runtime configs are rejected by the Gateway boundary', async (t) => {
  if (!gatewayFixtureAvailable()) {
    t.skip(`pinned Gateway CLI fixture not present at ${GATEWAY_CLI}; set PI_SHUTTLE_TEST_GATEWAY_CLI to run the black-box conformance check`);
    return;
  }
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    writeReceiptFixture(env, {
      gateway: { status: 'installed-verified', installPath: GATEWAY_ROOT, binPath: GATEWAY_CLI },
      piGuard: null,
      result: 'COMPLETE',
      omitted: [],
    });
    const root = await makeGitRepoRoot(env);
    const pathEnv = { ...process.env, HOME: env };
    const outcome = await addProject({ env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv }, root);
    assert.equal(outcome.exitCode, 0, outcome.stderr);

    const base = JSON.parse(readFileSync(layout.runtimeConfigPath, 'utf8')) as { surfaces: Array<Record<string, unknown>> };

    const foreign = JSON.parse(JSON.stringify(base)) as typeof base;
    (foreign.surfaces[0] as Record<string, unknown>)['authority'] = 'x';
    const foreignPath = join(env, 'drifted-foreign.json');
    writeFileSync(foreignPath, JSON.stringify(foreign), { mode: 0o600 });
    const foreignProbe = await probeStartup(foreignPath);
    assert.equal(foreignProbe.accepted, false, 'a foreign field must be rejected by the Gateway loader');
    assert.equal(foreignProbe.code, 1, foreignProbe.stderr);

    const noIdentity = JSON.parse(JSON.stringify(base)) as typeof base;
    delete (noIdentity.surfaces[0] as Record<string, unknown>)['configurationIdentity'];
    const noIdentityPath = join(env, 'drifted-no-identity.json');
    writeFileSync(noIdentityPath, JSON.stringify(noIdentity), { mode: 0o600 });
    const identityProbe = await probeStartup(noIdentityPath);
    assert.equal(identityProbe.accepted, false, 'missing configurationIdentity must be rejected by the runtime profile');
    assert.equal(identityProbe.code, 1, identityProbe.stderr);
  } finally {
    cleanupEnv(env);
  }
});

test('SIR-PS2-009: pi-shuttle serialization is deterministic and closed (Gateway-acceptance shape)', async (t) => {
  if (!gatewayFixtureAvailable()) {
    t.skip(`pinned Gateway CLI fixture not present at ${GATEWAY_CLI}; set PI_SHUTTLE_TEST_GATEWAY_CLI to run the black-box conformance check`);
    return;
  }
  const env = makeEnv();
  try {
    const layout = resolveLayout(env);
    writeReceiptFixture(env, {
      gateway: { status: 'installed-verified', installPath: GATEWAY_ROOT, binPath: GATEWAY_CLI },
      piGuard: null,
      result: 'COMPLETE',
      omitted: [],
    });
    const root = await makeGitRepoRoot(env);
    const pathEnv = { ...process.env, HOME: env };
    const outcome = await addProject({ env: { home: env, platform: 'linux', arch: 'x64' }, layout, nodeExecutable: process.execPath, pathEnv }, root);
    assert.equal(outcome.exitCode, 0, outcome.stderr);
    const text = readFileSync(layout.runtimeConfigPath, 'utf8');
    assert.match(text, /\n$/, 'serialized document ends with a newline');
    const parsed = JSON.parse(text) as { surfaces: Array<Record<string, unknown>> };
    assert.equal(parsed.surfaces.length, 1);
    const surface = parsed.surfaces[0]!;
    assert.equal(typeof surface['configurationIdentity'], 'string');
    assert.match(surface['configurationIdentity'] as string, /^sha-256:[0-9a-f]{64}$/);
    // Closed surface shape: no authority/provenance vocabulary ever persists.
    const keys = Object.keys(surface).sort();
    assert.deepEqual(keys, ['configurationIdentity', 'configurationVersion', 'forbiddenRoots', 'gitHome', 'gitPath', 'gitTmpdir', 'limitProfile', 'locator', 'serviceUid', 'surfaceId', 'workspaces']);
  } finally {
    cleanupEnv(env);
  }
});
