/**
 * PS-3 focused tests: the process runner boundary — argv-safe execution,
 * bounded output, deterministic exit handling, timeouts, executable
 * resolution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveExecutable, runProcess } from '../../src/installer/process.js';

function makeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps3-proc-'));
  return dir;
}

test('process: argv-safe success with bounded stdout', async () => {
  const result = await runProcess(process.execPath, ['-e', 'console.log("hello world")'], { timeoutMs: 10_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.stdout.trim(), 'hello world');
  assert.equal(result.stderr, '');
});

test('process: arguments with spaces/quotes pass through verbatim (no shell)', async () => {
  // With `node -e`, process.argv[1] is the first operand after the script.
  const result = await runProcess(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a b', 'x"y', '$HOME', '$(touch /tmp/ps3-pwn)'], { timeoutMs: 10_000 });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), ['a b', 'x"y', '$HOME', '$(touch /tmp/ps3-pwn)'], 'argv must be passed verbatim');
});

test('process: nonzero exit is deterministic; stderr captured', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stderr.write("boom\\n"); process.exit(7)'], { timeoutMs: 10_000 });
  assert.equal(result.exitCode, 7);
  assert.ok(result.stderr.includes('boom'));
});

test('process: missing executable yields a typed process error, not a hang', async () => {
  const result = await runProcess(join(makeEnv(), 'no-such-executable'), ['x'], { timeoutMs: 5_000 });
  assert.equal(result.exitCode, null);
  assert.ok(result.stderr.includes('process error'));
});

test('process: timeout kills and is reported', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 });
  assert.equal(result.timedOut, true);
});

test('process: output is bounded with a truncation marker', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(200000))'], { timeoutMs: 10_000, maxOutputBytes: 1024 });
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.length <= 1024 + '…(truncated)'.length);
  assert.ok(result.stdout.endsWith('…(truncated)'));
});

test('process: resolveExecutable finds executables through PATH only', () => {
  const env = makeEnv();
  try {
    const binDir = join(env, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    const tool = join(binDir, 'ps3-tool');
    writeFileSync(tool, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const customEnv = { ...process.env, PATH: `${binDir}:/usr/bin` };
    assert.equal(resolveExecutable('ps3-tool', customEnv), tool);
    assert.equal(resolveExecutable('ps3-tool', { ...customEnv, PATH: '/usr/bin' }), null, 'PATH is the only resolution source');
    assert.equal(resolveExecutable('has/slash', customEnv), null, 'names with slashes are not resolved via PATH');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});
