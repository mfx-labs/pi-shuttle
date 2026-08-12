/**
 * PS-3 adversarial archive tests (SIR-PS3-001/003/013): the structural
 * pre-extraction scanner must reject every unsafe/special member before
 * extraction and must never hang on a FIFO/special entry. Fixtures are
 * built with Node core (raw tar blocks + zlib) inside the isolated test
 * root — no adversarial fixture ever writes outside its test root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { scanArtifactMembers, validateMemberName, readJsonFileIfRegular } from '../../src/installer/archive.js';
import { buildTarBuffer, writeArtifact, makeEnv, cleanupEnv, fullInstallEnv, runInstaller, GATEWAY_ARTIFACT_NAME } from '../helpers/installer-fixtures.js';

test('archive: valid npm-pack-shaped archive (package/ prefix, regular files) is accepted', async () => {
  const env = makeEnv();
  try {
    const path = writeArtifact(env, 'valid.tgz', [
      { name: 'package/package.json', type: 'file', data: '{"name":"x","version":"1.0.0"}' },
      { name: 'package/dist/cli.js', type: 'file', data: '#!/usr/bin/env node\n' },
    ]);
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, true, scan.ok ? '' : scan.message);
    if (scan.ok) assert.equal(scan.memberCount, 2);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: `..` member names are rejected before extraction', async () => {
  const env = makeEnv();
  try {
    const path = writeArtifact(env, 'dotdot.tgz', [
      { name: '../escape.txt', type: 'file', data: 'pwn' },
      { name: 'package/package.json', type: 'file', data: '{}' },
    ]);
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, false);
    if (!scan.ok) {
      assert.ok(scan.message.includes('parent traversal'), scan.message);
      assert.equal(scan.code, 'ERR-PS3-ARTIFACT-SCAN');
    }
  } finally {
    cleanupEnv(env);
  }
});

test('archive: absolute member names are rejected', async () => {
  const env = makeEnv();
  try {
    const path = writeArtifact(env, 'abs.tgz', [{ name: '/tmp/escape-abs.txt', type: 'file', data: 'pwn' }]);
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, false);
    if (!scan.ok) assert.ok(scan.message.includes('absolute'), scan.message);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: symlink members are rejected (incl. symlink-then-file shape)', async () => {
  const env = makeEnv();
  try {
    const symlinkOnly = writeArtifact(env, 'symlink.tgz', [
      { name: 'package/link', type: 'symlink', linkname: '../..' },
      { name: 'package/link/escaped.txt', type: 'file', data: 'pwn' },
    ]);
    const scan = await scanArtifactMembers(symlinkOnly);
    assert.equal(scan.ok, false);
    if (!scan.ok) assert.ok(scan.message.includes('symbolic link'), scan.message);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: hardlink members are rejected', async () => {
  const env = makeEnv();
  try {
    const path = writeArtifact(env, 'hardlink.tgz', [
      { name: 'package/victim.txt', type: 'file', data: 'v' },
      { name: 'package/hard', type: 'hardlink', linkname: '/etc/passwd' },
    ]);
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, false);
    if (!scan.ok) assert.ok(scan.message.includes('hard link'), scan.message);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: FIFO members are rejected — FIFO at package/package.json cannot hang the installer', async () => {
  const env = makeEnv();
  try {
    const path = writeArtifact(env, 'fifo.tgz', [{ name: 'package/package.json', type: 'fifo' }]);
    // The scan must complete promptly (a hang would be a regression of the
    // SIR-PS3-001 FIFO hang).
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, false);
    if (!scan.ok) assert.ok(scan.message.includes('FIFO'), scan.message);
    // Defense in depth: the guarded reader must refuse a FIFO without
    // blocking, even if one ever reached the filesystem (fixture-extracted).
    const fifoDir = join(env, 'fifo-extract');
    const raw = buildTarBuffer([{ name: 'package/package.json', type: 'fifo' }]);
    const mk = spawnSync('mkdir', ['-p', fifoDir]);
    assert.equal(mk.status, 0);
    const tar = spawnSync('tar', ['-xzf', '-', '-C', fifoDir], { input: gzipSync(raw) });
    assert.equal(tar.status, 0, 'fixture FIFO extraction should succeed (tar accepts FIFOs; the policy is pi-shuttle-owned)');
    const fifoPath = join(fifoDir, 'package', 'package.json');
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { readJsonFileIfRegular } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'dist', 'installer', 'archive.js')).href)};
      const r = readJsonFileIfRegular(process.argv[1]);
      console.log(r === null ? 'REFUSED-NO-HANG' : 'OPENED');
    `, fifoPath], { timeout: 5000, encoding: 'utf8' });
    assert.equal(probe.status, 0, `guarded read must complete: ${probe.stderr}`);
    assert.ok(probe.stdout.includes('REFUSED-NO-HANG'), `FIFO must never be opened: ${probe.stdout}`);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: pax path override with traversal is rejected', async () => {
  const env = makeEnv();
  try {
    const path = writeArtifact(env, 'pax.tgz', [
      { name: 'package/x', type: 'paxpath', data: 'package/../escape' },
      { name: 'package/y', type: 'file', data: 'z' },
    ]);
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, false);
    if (!scan.ok) assert.ok(scan.message.includes('parent traversal'), scan.message);
    // A pax path override that stays inside is applied to the next member.
    const safe = writeArtifact(env, 'pax-safe.tgz', [
      { name: 'package/x', type: 'paxpath', data: 'package/deep/file.txt' },
      { name: 'package/y', type: 'file', data: 'z' },
    ]);
    const scanSafe = await scanArtifactMembers(safe);
    assert.equal(scanSafe.ok, true, scanSafe.ok ? '' : scanSafe.message);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: GNU longname resolution is applied and traversing longnames are rejected', async () => {
  const env = makeEnv();
  try {
    const safe = writeArtifact(env, 'long-safe.tgz', [
      { name: 'x'.repeat(120), type: 'longname' },
      { name: 'short', type: 'file', data: 'pwn' },
    ]);
    const scan = await scanArtifactMembers(safe);
    assert.equal(scan.ok, true, scan.ok ? '' : scan.message);
    const evil = writeArtifact(env, 'long-evil.tgz', [
      { name: '../escape-long.txt', type: 'longname' },
      { name: 'short', type: 'file', data: 'pwn' },
    ]);
    const scan2 = await scanArtifactMembers(evil);
    assert.equal(scan2.ok, false);
    if (!scan2.ok) assert.ok(scan2.message.includes('parent traversal'), scan2.message);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: truncated archive (no end-of-archive marker) is rejected', async () => {
  const env = makeEnv();
  try {
    const full = buildTarBuffer([{ name: 'package/package.json', type: 'file', data: '{}' }]);
    const truncated = full.subarray(0, full.length - 1024); // drop the EOF blocks
    const path = join(env, 'truncated.tgz');
    writeFileSync(path, gzipSync(truncated), { mode: 0o600 });
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, false);
    if (!scan.ok) assert.ok(scan.message.includes('truncated'), scan.message);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: not-a-gzip file is rejected', async () => {
  const env = makeEnv();
  try {
    const path = join(env, 'garbage.tgz');
    writeFileSync(path, 'not a tarball at all', { mode: 0o600 });
    const scan = await scanArtifactMembers(path);
    assert.equal(scan.ok, false);
  } finally {
    cleanupEnv(env);
  }
});

test('archive: member-name policy rejects traversal, absolute, dot and empty components', () => {
  const bad = ['../x', 'a/../../b', '/abs', 'a//b', 'a/./b', '.', '..', 'a/../'];
  for (const name of bad) {
    assert.equal(validateMemberName(name).ok, false, name);
  }
  for (const name of ['package/package.json', 'package/', 'a/b/c.txt']) {
    assert.equal(validateMemberName(name).ok, true, name);
  }
});

test('archive: real pilot Gateway artifact satisfies the closed policy (read-only evidence)', async () => {
  // SIR-PS3-004 read-only external check: the real pilot artifact in the
  // clean reference repo is scanned with the production policy. Skipped
  // when the reference tree is absent from this environment.
  const pilot = '/home/chef/Documents/Project_Gateway_MCP_v0.1.0_clean/project-gateway-artifact-core-0.1.0.tgz';
  if (!existsSync(pilot)) return;
  const scan = await scanArtifactMembers(pilot);
  assert.equal(scan.ok, true, scan.ok ? '' : `pilot artifact must satisfy the closed policy: ${scan.message}`);
  if (scan.ok) assert.ok(scan.memberCount > 100, 'pilot artifact has hundreds of members');
});

test('archive: hostile archive is rejected by the full installer flow promptly (no hang)', async () => {
  const env = makeEnv();
  try {
    writeArtifact(env, GATEWAY_ARTIFACT_NAME, [
      { name: 'package/package.json', type: 'file', data: JSON.stringify({ name: '@project-gateway/artifact-core', version: '0.1.0', bin: { 'project-gateway-mcp': './dist/cli.js' } }) },
      { name: 'package/dist/cli.js', type: 'file', data: '#!/usr/bin/env node\n' },
      { name: 'package/package.json', type: 'fifo' },
    ]);
    const runEnv = fullInstallEnv(env);
    const run = await runInstaller(['--batch', '--gateway', 'yes', '--pi-guard', 'no', '--artifact-dir', env], runEnv);
    assert.equal(run.code, 2, run.stdout + run.stderr);
    assert.ok(run.stdout.includes('unsupported member type'), run.stdout);
  } finally {
    cleanupEnv(env);
  }
});
