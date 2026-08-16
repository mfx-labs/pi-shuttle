/**
 * C3B1 — lane-aware handshake + real-stack wiring: focused regressions.
 *
 * The standalone probe and the real-stack script cannot import TypeScript;
 * they carry the smallest parameterization of the authoritative A/B
 * descriptor values. These tests prove that parameterization EQUALS the
 * descriptors (never an independent identity table), that unknown explicit
 * lanes fail closed, that the Intel lane expects ONLY the macOS fork server
 * identity, that the nine-tool surface stays exact, and that a synthetic
 * MCP exchange through the real probe wiring behaves lane-correctly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HISTORICAL_GATEWAY_DESCRIPTOR, MACOS_INTEL_GATEWAY_DESCRIPTOR } from '../../src/compat/manifest.js';
import { fileURLToPath } from 'node:url';

const REPO = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..');
const PROBE = join(REPO, 'scripts', 'mcp-handshake-probe.mjs');
const REAL_STACK = join(REPO, 'scripts', 'ci-lane-b-real-stack.sh');

const LINUX_LANE = 'linux-x86_64-posix-utf8-node22';
const ARM64_LANE = 'darwin-arm64-posix-utf8-node22';
const INTEL_LANE = 'darwin-x86_64-posix-utf8-node22';

const NINE_TOOLS = ['validate-artifact', 'inspect-stored-record', 'inspect-registry', 'inspect-audit-history', 'verify-record', 'enumerate-class', 'draft-artifact', 'persist-artifact', 'inspect-changes'];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function probeText(): string {
  return read(PROBE);
}

function realStackText(): string {
  return read(REAL_STACK);
}

/** A fake stdio MCP server speaking exactly the lines the probe sends. */
function writeFakeServer(dir: string): void {
  const server = join(dir, 'fake-server.mjs');
  writeFileSync(server, `
import { createInterface } from 'node:readline';
const NINE = ${JSON.stringify(NINE_TOOLS)};
const name = process.env.FAKE_SERVER_NAME ?? '@project-gateway/artifact-core';
const count = Number(process.env.FAKE_TOOL_COUNT ?? '9');
const extra = process.env.FAKE_EXTRA_TOOL ?? '';
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? '2026-07-28', capabilities: {}, serverInfo: { name, version: '0.1.0' } } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    const tools = NINE.slice(0, count).map((t) => ({ name: t }));
    if (extra !== '') tools.push({ name: extra });
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools } }) + '\\n');
  }
});
rl.on('close', () => process.exit(0));
`, { mode: 0o700 });
  const shim = join(dir, 'pshuttle');
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${server}"\n`, { mode: 0o700 });
  chmodSync(shim, 0o700);
  mkdirSync(join(dir, 'home'), { recursive: true, mode: 0o700 });
}

function runProbe(dir: string, extraEnv: Record<string, string> = {}): { readonly code: number | null; readonly stdout: string; readonly stderr: string } {
  const run = spawnSync(process.execPath, [PROBE], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: join(dir, 'home'),
      PATH: process.env.PATH ?? '',
      PSHUTTLE: join(dir, 'pshuttle'),
      ...extraEnv,
    },
    timeout: 30_000,
  });
  return { code: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'c3b1-'));
  writeFakeServer(dir);
  return dir;
}

test('C3B1 probe: the lane→package parameterization equals the authoritative A descriptors', () => {
  const text = probeText();
  assert.ok(text.includes(`'${LINUX_LANE}': '${HISTORICAL_GATEWAY_DESCRIPTOR.packageName}'`), 'linux lane must bind the historical package');
  assert.ok(text.includes(`'${ARM64_LANE}': '${HISTORICAL_GATEWAY_DESCRIPTOR.packageName}'`), 'arm64 lane must bind the historical package (never the fork)');
  assert.ok(text.includes(`'${INTEL_LANE}': '${MACOS_INTEL_GATEWAY_DESCRIPTOR.packageName}'`), 'Intel lane must bind the fork package');
  assert.ok(text.includes('0.1.0'), 'the expected server version is the descriptor version');
  assert.ok(text.includes('unknown gateway lane') && text.includes('no historical fallback'), 'unknown-lane fail-closed message present');
});

test('C3B1 probe: historical handshake identity remains accepted on Linux (default lane)', () => {
  const dir = scratch();
  try {
    // Absent GATEWAY_LANE + the historical package as a consistency
    // assertion: the intentional compatibility default is selected.
    const run = runProbe(dir, { EXPECTED_GATEWAY_PACKAGE: '@project-gateway/artifact-core', FAKE_SERVER_NAME: '@project-gateway/artifact-core' });
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('MCP handshake OK'), run.stdout);
    assert.ok(run.stdout.includes('9/9 tools'), run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: absent lane + macOS expected package fails closed (expectation never selects identity)', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, { EXPECTED_GATEWAY_PACKAGE: '@project-gateway/macos-core', FAKE_SERVER_NAME: '@project-gateway/macos-core' });
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stderr.includes('conflicts with the lane-selected identity'), run.stderr);
    assert.ok(run.stderr.includes('absent — historical compatibility default'), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: Intel lane accepts @project-gateway/macos-core with the exact nine tools', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, { GATEWAY_LANE: INTEL_LANE, FAKE_SERVER_NAME: '@project-gateway/macos-core' });
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('9/9 tools'), run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: Intel lane + explicit Intel consistency assertion is accepted (expectation asserts, never selects)', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, {
      GATEWAY_LANE: INTEL_LANE,
      EXPECTED_GATEWAY_PACKAGE: '@project-gateway/macos-core',
      FAKE_SERVER_NAME: '@project-gateway/macos-core',
    });
    assert.equal(run.code, 0, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('MCP handshake OK'), run.stdout);
    assert.ok(run.stdout.includes('9/9 tools'), run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: Intel lane REJECTS the historical server identity', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, { GATEWAY_LANE: INTEL_LANE, FAKE_SERVER_NAME: '@project-gateway/artifact-core' });
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.ok(run.stderr.includes('HANDSHAKE FAIL'), run.stderr);
    assert.ok(run.stderr.includes('@project-gateway/macos-core@0.1.0'), 'the failure must name the lane-selected expected identity');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: the nine-tool surface stays exact (8 tools fail)', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, { GATEWAY_LANE: INTEL_LANE, FAKE_SERVER_NAME: '@project-gateway/macos-core', FAKE_TOOL_COUNT: '8' });
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.ok(run.stderr.includes('tool surface mismatch'), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: one ADDITIONAL unexpected tool is refused (exactly nine)', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, { GATEWAY_LANE: INTEL_LANE, FAKE_SERVER_NAME: '@project-gateway/macos-core', FAKE_EXTRA_TOOL: 'admin-tool' });
    assert.equal(run.code, 1, run.stdout + run.stderr);
    assert.ok(run.stderr.includes('tool surface mismatch'), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: unknown explicit lane fails closed (exit 2) without spawning a server', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, { GATEWAY_LANE: 'win32-x64' });
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stderr.includes('unknown gateway lane'), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 probe: an explicit package conflicting with the lane fails closed (exit 2)', () => {
  const dir = scratch();
  try {
    const run = runProbe(dir, { GATEWAY_LANE: INTEL_LANE, EXPECTED_GATEWAY_PACKAGE: '@project-gateway/artifact-core' });
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stderr.includes('conflicts'), run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C3B1 real-stack: package/artifact/bin selection is lane-aware and equals the descriptors', () => {
  const text = realStackText();
  // Historical branch (default + linux + arm64): never the fork.
  const historicalCase = text.match(/''\|linux-x86_64-posix-utf8-node22\|darwin-arm64-posix-utf8-node22\)\n\s*GATEWAY_PACKAGE="[^"]*"\n\s*GATEWAY_BIN="[^"]*"\n\s*GATEWAY_ARTIFACT="[^"]*"/);
  assert.ok(historicalCase !== null, 'the default/linux/arm64 case must bind the historical identity');
  assert.ok(historicalCase![0].includes('@project-gateway/artifact-core'));
  assert.ok(historicalCase![0].includes('project-gateway-mcp'));
  assert.ok(historicalCase![0].includes('project-gateway-artifact-core-0.1.0.tgz'));
  assert.ok(!historicalCase![0].includes('macos'), 'arm64/default must never bind the fork identity');
  // Intel branch.
  assert.ok(text.includes('GATEWAY_PACKAGE="@project-gateway/macos-core"'), 'Intel package identity present');
  assert.ok(text.includes('GATEWAY_BIN="project-gateway-macos-mcp"'), 'Intel bin identity present');
  assert.ok(text.includes('GATEWAY_ARTIFACT="project-gateway-macos-core-0.1.0.tgz"'), 'Intel artifact name present');
  // Unknown lane fails closed; the probe receives the lane-selected
  // identity EXPLICITLY (GATEWAY_LANE is the probe's sole selector).
  assert.ok(text.includes('unknown gateway lane: $GATEWAY_LANE (no historical fallback)'), 'unknown-lane fail-closed message present');
  assert.ok(text.includes('GATEWAY_LANE="$GATEWAY_LANE" EXPECTED_GATEWAY_PACKAGE="$GATEWAY_PACKAGE"'), 'the handshake probe receives the explicitly selected lane, never ambient state');
  // Explicit lanes take the artifact name from the B fixture manifest.
  assert.ok(text.includes('GATEWAY_ARTIFACT="$(node -e "console.log(require(\'$MANIFEST\').gateway.artifact)")"'), 'explicit-lane artifact name derives from the fixture manifest');
});

test('C3B1 real-stack: unknown explicit lane fails closed (exit 2) before any action', () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FIXTURE_DIR: '/nonexistent/fixtures',
    WORK_ROOT: '/nonexistent/work',
    PSHUTTLE_REPO: REPO,
    PI_LANE_BIN: '/nonexistent/pi',
    PI_LOADER: '/nonexistent/loader.js',
    GIT_2454: '/nonexistent/git',
    NODE_BIN: process.execPath,
    GATEWAY_COMMIT: '55f764290a4567a20557f1db19d2a6fb97572a97',
    PI_GUARD_COMMIT: '7a7580cc4cbd7926797564c72269394fc29a860a',
    GATEWAY_LANE: 'win32-x64',
  };
  const run = spawnSync('bash', [REAL_STACK], { encoding: 'utf8', env });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.ok(`${run.stderr}`.includes('unknown gateway lane'), run.stderr ?? '');
});

test('C3B1 real-stack: darwin-arm64 remains historical (never the macOS fork)', () => {
  const text = realStackText();
  // arm64 appears ONLY in the historical case line; the Intel branch must
  // never mention arm64.
  const intelBranch = text.match(/darwin-x86_64-posix-utf8-node22\)\n\s*GATEWAY_PACKAGE="[^"]*"/);
  assert.ok(intelBranch !== null, 'Intel branch present');
  assert.ok(!intelBranch![0].includes('arm64'), 'the Intel branch must not bind arm64');
});
