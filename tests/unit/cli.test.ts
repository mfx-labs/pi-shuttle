/**
 * PS-2 focused tests: closed CLI grammar, dispatch, exit classification,
 * and real-CLI subprocess smoke tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseCommand } from '../../src/command/parse.js';
import { run } from '../../src/app.js';
import { GATEWAY_PS1_BASELINE_COMMIT, PI_GUARD_VERSION } from '../../src/compat/manifest.js';

const LINUX_ENV = { home: '/home/operator', platform: 'linux', arch: 'x64' };

test('cli grammar: every approved command parses', () => {
  const cases: Array<[readonly string[], string]> = [
    [['--help'], 'help'],
    [['--version'], 'version'],
    [['doctor'], 'doctor'],
    [['start'], 'start'],
    [['project', 'add', '/some/root'], 'project-add'],
    [['project', 'list'], 'project-list'],
    [['project', 'remove', '/some/root'], 'project-remove'],
    [['project', 'remove', 'pgw:w:0123456789abcdef0123456789abcdef'], 'project-remove'],
  ];
  for (const [argv, kind] of cases) {
    const parsed = parseCommand(argv);
    assert.equal(parsed.ok, true, `${JSON.stringify(argv)} must parse`);
    if (parsed.ok) assert.equal(parsed.command.kind, kind, JSON.stringify(argv));
  }
});

test('cli grammar: malformed invocations fail closed', () => {
  const cases: readonly (readonly string[])[] = [
    [],
    ['--help', 'x'],
    ['--version', 'x'],
    ['doctor', 'x'],
    ['start', 'x'],
    ['project'],
    ['project', 'list', 'x'],
    ['project', 'add'],
    ['project', 'add', ''],
    ['project', 'add', 'a', 'b'],
    ['project', 'add', '-x'],
    ['project', 'add', '--help'],
    ['project', 'remove'],
    ['project', 'remove', ''],
    ['project', 'remove', 'a', 'b'],
    ['project', 'remove', '-x'],
    ['project', 'wat'],
    ['nope'],
    ['project', 'add', 'a', 'b', 'c'],
  ];
  for (const argv of cases) {
    const parsed = parseCommand(argv);
    assert.equal(parsed.ok, false, `${JSON.stringify(argv)} must fail closed`);
  }
});

test('cli dispatch: help and version are deterministic and state-free', () => {
  const help = run(['--help'], { env: LINUX_ENV });
  assert.equal(help.exitCode, 0);
  assert.ok(help.stdout.includes('usage: pi-shuttle <command> [operands]'));
  assert.ok(help.stdout.includes('project add <path>'));
  assert.equal(help.stderr, '');
  assert.deepEqual(run(['--help'], { env: LINUX_ENV }), help, 'help must be byte-deterministic');

  const version = run(['--version'], { env: LINUX_ENV });
  assert.equal(version.exitCode, 0);
  assert.ok(version.stdout.includes('pi-shuttle 0.1.0'));
  assert.ok(version.stdout.includes(GATEWAY_PS1_BASELINE_COMMIT));
  assert.ok(version.stdout.includes(`pi-guard ${PI_GUARD_VERSION}`));
  assert.deepEqual(run(['--version'], { env: LINUX_ENV }), version, 'version must be byte-deterministic');
});

test('cli dispatch: malformed invocation exits 2 with usage on stderr', () => {
  for (const argv of [['unknown-cmd'], ['project', 'add'], ['doctor', 'x'], []]) {
    const outcome = run(argv, { env: LINUX_ENV });
    assert.equal(outcome.exitCode, 2, JSON.stringify(argv));
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes('pi-shuttle:'), JSON.stringify(argv));
  }
});

test('cli dispatch: PS-4-owned operational handlers fail closed with exit 1', () => {
  const cases: Array<[readonly string[], string]> = [
    [['project', 'add', '/tmp/proj'], 'project add'],
    [['project', 'list'], 'project list'],
    [['project', 'remove', '/tmp/proj'], 'project remove'],
    [['start'], 'start'],
  ];
  for (const [argv, name] of cases) {
    const outcome = run(argv, { env: LINUX_ENV });
    assert.equal(outcome.exitCode, 1, JSON.stringify(argv));
    assert.equal(outcome.stdout, '');
    assert.ok(outcome.stderr.includes(name), `stderr must name the deferred command: ${outcome.stderr}`);
    assert.ok(outcome.stderr.includes('PS-4'), `stderr must state PS-4 ownership: ${outcome.stderr}`);
  }
});

test('cli dispatch: doctor skeleton runs on the injected environment (missing config = finding, exit 1)', () => {
  const outcome = run(['doctor'], { env: LINUX_ENV });
  // SIR-PS2-003: missing runtime configuration is a finding-class verdict → exit 1.
  assert.equal(outcome.exitCode, 1);
  assert.ok(outcome.stdout.includes('platform: supported'));
  assert.ok(outcome.stdout.includes('runtime configuration: missing'));
});

test('cli dispatch: help/version work without any host environment (SIR-PS2-010)', () => {
  const help = run(['--help'], {});
  assert.equal(help.exitCode, 0);
  assert.ok(help.stdout.includes('usage: pi-shuttle'));
  assert.equal(help.stderr, '');
  const version = run(['--version'], {});
  assert.equal(version.exitCode, 0);
  assert.ok(version.stdout.includes('pi-shuttle 0.1.0'));
  // Env-requiring commands fail closed without an environment.
  const doctor = run(['doctor'], {});
  assert.equal(doctor.exitCode, 2);
  assert.ok(doctor.stderr.includes('HOME is not set'));
});

test('cli dispatch: help text documents the full exit-2 semantics (SIR-PS2-004)', () => {
  const help = run(['--help'], {});
  assert.ok(help.stdout.includes('2 malformed invocation or unsupported platform/architecture (`doctor`)'), help.stdout);
});

// ─── real-CLI subprocess smoke tests (compiled dist/cli.js) ──────────────

const REPO = join(import.meta.dirname, '..', '..', '..');
const CLI_PATH = join(REPO, 'dist', 'cli.js');

function runCli(args: readonly string[], home: string, envOverride?: NodeJS.ProcessEnv): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = envOverride !== undefined ? envOverride : { ...process.env, HOME: home };
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('cli subprocess: real CLI help/version/unknown/deferred/doctor', async () => {
  const home = join(REPO, 'dist-test', 'smoke-home');
  const help = await runCli(['--help'], home);
  assert.equal(help.code, 0);
  assert.ok(help.stdout.includes('usage: pi-shuttle'));
  assert.equal(help.stderr, '');

  const version = await runCli(['--version'], home);
  assert.equal(version.code, 0);
  assert.ok(version.stdout.includes('pi-shuttle 0.1.0'));

  const unknown = await runCli(['frobnicate'], home);
  assert.equal(unknown.code, 2);
  assert.ok(unknown.stderr.includes('unknown command'));

  const malformed = await runCli(['project', 'add'], home);
  assert.equal(malformed.code, 2);

  const deferred = await runCli(['project', 'list'], home);
  assert.equal(deferred.code, 1);
  assert.ok(deferred.stderr.includes('PS-4'));

  const doctor = await runCli(['doctor'], home);
  // SIR-PS2-003: missing runtime configuration is a finding → exit 1.
  assert.equal(doctor.code, 1);
  assert.ok(doctor.stdout.includes('platform: supported'));
  assert.ok(doctor.stdout.includes('runtime configuration: missing'));
});

test('cli subprocess: help/version succeed with HOME absent (SIR-PS2-010)', async () => {
  const noHome = { ...process.env };
  delete noHome.HOME;
  const help = await runCli(['--help'], '/unused', noHome);
  assert.equal(help.code, 0, help.stderr);
  assert.ok(help.stdout.includes('usage: pi-shuttle'));
  const version = await runCli(['--version'], '/unused', noHome);
  assert.equal(version.code, 0, version.stderr);
  assert.ok(version.stdout.includes('pi-shuttle 0.1.0'));
  // Env-requiring commands still fail closed without HOME.
  const doctor = await runCli(['doctor'], '/unused', noHome);
  assert.equal(doctor.code, 2);
  assert.ok(doctor.stderr.includes('HOME is not set'));
});
