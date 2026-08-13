/**
 * PS-6 darwin quarantine handling tests (platform-support-contract §3.7;
 * SIR-PS6-005 correction).
 *
 * Required invariants:
 *   - darwin artifact WITH `com.apple.quarantine` → attribute stripped
 *     (argv-safe xattr, list-then-strip);
 *   - darwin artifact WITHOUT the attribute → truthful `no-quarantine`
 *     no-op;
 *   - digest mismatch → the quarantine stage is never reached (no
 *     mutation);
 *   - Linux → xattr is never resolved or invoked;
 *   - xattr failure (missing utility, list failure, strip failure) →
 *     fail closed with the installer error model.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripQuarantineAttribute, quarantinePresent, QUARANTINE_ATTRIBUTE } from '../../src/installer/quarantine.js';
import { installGatewayComponent } from '../../src/installer/components.js';
import { buildTarball, cleanupEnv, gatewayFixtureFiles, GATEWAY_ARTIFACT_NAME } from '../helpers/installer-fixtures.js';
import { resolveExecutable } from '../../src/process/runner.js';

/** Fake `xattr` executable with deterministic controls (fixture-only). */
function writeFakeXattr(env: string, binDir: string): string {
  const script = join(binDir, 'xattr');
  writeFileSync(script, `#!/usr/bin/env bash
state="\${FIXTURE_XATTR_STATE:-}"
if [ "\${1:-}" = "-d" ]; then
  if [ -n "$state" ]; then echo "strip \${*:2}" >> "$state"; fi
  if [ "\${FIXTURE_XATTR_FAIL_STRIP:-0}" = "1" ]; then echo "fixture: strip failed" >&2; exit 1; fi
  exit 0
fi
if [ -n "$state" ]; then echo "list \${1:-}" >> "$state"; fi
if [ "\${FIXTURE_XATTR_FAIL_LIST:-0}" = "1" ]; then echo "fixture: list failed" >&2; exit 1; fi
if [ "\${FIXTURE_XATTR_QUARANTINE:-0}" = "1" ]; then echo "com.apple.quarantine"; fi
exit 0
`, { mode: 0o700 });
  return script;
}

function pathEnvFor(env: string, binDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, PATH: `${binDir}:${process.env.PATH ?? ''}` };
}

function artifactWithState(env: string, binDir: string, stateFile: string): { artifactDir: string; pathEnv: NodeJS.ProcessEnv } {
  return { artifactDir: env, pathEnv: pathEnvFor(env, binDir, { FIXTURE_XATTR_STATE: stateFile }) };
}

test('quarantine: quarantinePresent matches only the exact attribute name', () => {
  assert.equal(quarantinePresent(''), false);
  assert.equal(quarantinePresent('com.apple.metadata:com_apple_backup_excludeItem\n'), false);
  assert.equal(quarantinePresent('com.apple.quarantine\n'), true);
  assert.equal(quarantinePresent(`other\n${QUARANTINE_ATTRIBUTE}\n`), true);
  assert.equal(quarantinePresent('com.apple.quarantine-extra'), false, 'prefix lookalikes must not match');
});

test('quarantine: darwin artifact with the attribute is stripped (argv-safe, list-then-strip)', async () => {
  const env = makeTmp();
  try {
    const binDir = join(env, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    writeFakeXattr(env, binDir);
    const stateFile = join(env, 'xattr.log');
    const artifact = join(env, 'artifact.tgz');
    writeFileSync(artifact, 'x');
    const result = await stripQuarantineAttribute(artifact, 'darwin', pathEnvFor(env, binDir, { FIXTURE_XATTR_STATE: stateFile, FIXTURE_XATTR_QUARANTINE: '1' }));
    assert.deepEqual(result, { ok: true, state: 'stripped' });
    const log = readFileSync(stateFile, 'utf8').trim().split('\n');
    assert.deepEqual(log, [`list ${artifact}`, `strip ${QUARANTINE_ATTRIBUTE} ${artifact}`], 'list must precede strip; argv-safe (no shell)');
  } finally {
    cleanupEnv(env);
  }
});

test('quarantine: darwin artifact without the attribute is a truthful no-quarantine no-op', async () => {
  const env = makeTmp();
  try {
    const binDir = join(env, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    writeFakeXattr(env, binDir);
    const stateFile = join(env, 'xattr.log');
    const artifact = join(env, 'artifact.tgz');
    writeFileSync(artifact, 'x');
    const result = await stripQuarantineAttribute(artifact, 'darwin', pathEnvFor(env, binDir, { FIXTURE_XATTR_STATE: stateFile }));
    assert.deepEqual(result, { ok: true, state: 'no-quarantine' });
    const log = readFileSync(stateFile, 'utf8').trim().split('\n');
    assert.deepEqual(log, [`list ${artifact}`], 'absence of the attribute must never trigger a strip');
  } finally {
    cleanupEnv(env);
  }
});

test('quarantine: linux never resolves or invokes xattr', async () => {
  const env = makeTmp();
  try {
    const artifact = join(env, 'artifact.tgz');
    writeFileSync(artifact, 'x');
    // PATH deliberately WITHOUT any xattr: the platform short-circuit must
    // return no-quarantine before executable discovery.
    const result = await stripQuarantineAttribute(artifact, 'linux', { PATH: join(env, 'empty-bin') });
    assert.deepEqual(result, { ok: true, state: 'no-quarantine' });
    assert.equal(existsSync(join(env, 'xattr.log')), false);
  } finally {
    cleanupEnv(env);
  }
});

test('quarantine: darwin without the xattr utility fails closed', async () => {
  const env = makeTmp();
  try {
    const artifact = join(env, 'artifact.tgz');
    writeFileSync(artifact, 'x');
    const result = await stripQuarantineAttribute(artifact, 'darwin', { PATH: join(env, 'empty-bin') });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-PS3-QUARANTINE');
    assert.ok(result.message.includes('xattr'));
  } finally {
    cleanupEnv(env);
  }
});

test('quarantine: xattr list failure fails closed', async () => {
  const env = makeTmp();
  try {
    const binDir = join(env, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    writeFakeXattr(env, binDir);
    const artifact = join(env, 'artifact.tgz');
    writeFileSync(artifact, 'x');
    const result = await stripQuarantineAttribute(artifact, 'darwin', pathEnvFor(env, binDir, { FIXTURE_XATTR_FAIL_LIST: '1' }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-PS3-QUARANTINE');
  } finally {
    cleanupEnv(env);
  }
});

test('quarantine: xattr strip failure fails closed', async () => {
  const env = makeTmp();
  try {
    const binDir = join(env, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    writeFakeXattr(env, binDir);
    const artifact = join(env, 'artifact.tgz');
    writeFileSync(artifact, 'x');
    const result = await stripQuarantineAttribute(artifact, 'darwin', pathEnvFor(env, binDir, { FIXTURE_XATTR_QUARANTINE: '1', FIXTURE_XATTR_FAIL_STRIP: '1' }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-PS3-QUARANTINE');
  } finally {
    cleanupEnv(env);
  }
});

test('quarantine: component digest mismatch never reaches the quarantine stage (no mutation)', async () => {
  const env = makeTmp();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const binDir = join(env, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    writeFakeXattr(env, binDir);
    const stateFile = join(env, 'xattr.log');
    const packagesDir = join(env, 'packages');
    const stagingDir = join(env, 'staging');
    const result = await installGatewayComponent({
      context: {
        artifactDir: env,
        packagesDir,
        stagingDir,
        nodeExecutable: process.execPath,
        expectedSha256: '00'.repeat(64), // wrong expectation → hard digest failure
        platform: 'darwin',
        pathEnv: pathEnvFor(env, binDir, { FIXTURE_XATTR_STATE: stateFile, FIXTURE_XATTR_QUARANTINE: '1' }),
      },
      expectedVersion: '0.1.0',
      expectedCommit: '7f3b4afdb43704e7dac82da7b086d8367347c641',
      tarExecutable: resolveExecutable('tar')!,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-PS3-ARTIFACT-DIGEST-MISMATCH', 'digest verification must fail before any quarantine handling');
    assert.equal(existsSync(stateFile), false, 'xattr must never be invoked when digest verification fails');
  } finally {
    cleanupEnv(env);
  }
});

test('quarantine: darwin component install strips the attribute after digest verification and succeeds', async () => {
  const env = makeTmp();
  try {
    await buildTarball(env, gatewayFixtureFiles(), GATEWAY_ARTIFACT_NAME);
    const binDir = join(env, 'bin');
    mkdirSync(binDir, { mode: 0o700 });
    writeFakeXattr(env, binDir);
    const stateFile = join(env, 'xattr.log');
    const packagesDir = join(env, 'packages');
    const stagingDir = join(env, 'staging');
    mkdirSync(packagesDir, { recursive: true, mode: 0o700 });
    const result = await installGatewayComponent({
      context: {
        artifactDir: env,
        packagesDir,
        stagingDir,
        nodeExecutable: process.execPath,
        platform: 'darwin',
        pathEnv: pathEnvFor(env, binDir, { FIXTURE_XATTR_STATE: stateFile, FIXTURE_XATTR_QUARANTINE: '1' }),
      },
      expectedVersion: '0.1.0',
      expectedCommit: '7f3b4afdb43704e7dac82da7b086d8367347c641',
      tarExecutable: resolveExecutable('tar')!,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const log = readFileSync(stateFile, 'utf8').trim().split('\n');
    assert.equal(log.length, 2, 'one list observation + one strip');
    assert.ok(log[0]!.startsWith('list '), log.join('; '));
    assert.ok(log[1]!.startsWith('strip '), log.join('; '));
  } finally {
    cleanupEnv(env);
  }
});

/** Fresh isolated temp root. */
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps6-quarantine-'));
  return dir;
}
