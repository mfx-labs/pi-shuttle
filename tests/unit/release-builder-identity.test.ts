/**
 * PS-8A focused tests: release builder build-time package identity
 * verification (F-02) — the builder must independently verify each
 * candidate artifact's declared package.json identity against the
 * approved pins BEFORE any digest is accepted into the release
 * envelope. These tests exercise the exported helpers directly (the
 * full builder run is performed as the final release execution).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The builder is a plain .mjs script at the repo root (dist-test mirrors
// only compiled TS); its direct-execution guard keeps importing it
// side-effect free.
const BUILDER = pathToFileURL(join(import.meta.dirname, '..', '..', '..', 'scripts', 'build-release.mjs')).href;
const { readTgzPackageIdentity, verifyPackageIdentity } = await import(BUILDER);

function makeTgz(dir: string, name: string, version: string): string {
  const root = join(dir, 'root');
  mkdirSync(join(root, 'package'), { recursive: true });
  writeFileSync(join(root, 'package', 'package.json'), JSON.stringify({ name, version }));
  const tgz = join(dir, 'artifact.tgz');
  const result = spawnSync('tar', ['-czf', tgz, '-C', root, 'package'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `tar fixture failed: ${result.stderr}`);
  return tgz;
}

test('builder (F-02): readTgzPackageIdentity reads the identity from the packed artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-builder.XXXXXX'));
  try {
    const tgz = makeTgz(dir, 'pi-shuttle', '0.1.0');
    const identity = readTgzPackageIdentity(tgz);
    assert.equal(identity.name, 'pi-shuttle');
    assert.equal(identity.version, '0.1.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builder (F-02): verifyPackageIdentity accepts the exact identity', () => {
  verifyPackageIdentity({ name: 'pi-shuttle', version: '0.1.0' }, 'pi-shuttle', '0.1.0', 'pi-shuttle');
  verifyPackageIdentity({ name: '@project-gateway/artifact-core', version: '0.1.0' }, '@project-gateway/artifact-core', '0.1.0', 'gateway');
  verifyPackageIdentity({ name: 'pi-guard', version: '0.1.2' }, 'pi-guard', '0.1.2', 'pi-guard');
});

test('builder (F-02): wrong name or version fails closed', () => {
  assert.throws(() => verifyPackageIdentity({ name: 'other-package', version: '0.1.0' }, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /identity mismatch/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-shuttle', version: '0.2.0' }, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /identity mismatch/);
  assert.throws(() => verifyPackageIdentity({ name: '@project-gateway/artifact-core', version: '0.2.0' }, '@project-gateway/artifact-core', '0.1.0', 'gateway'), /identity mismatch/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-guard', version: '0.1.1' }, 'pi-guard', '0.1.2', 'pi-guard'), /identity mismatch/);
});

test('builder (F-02): malformed or missing identity fails closed', () => {
  assert.throws(() => verifyPackageIdentity(null, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /missing or malformed/);
  assert.throws(() => verifyPackageIdentity({}, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /missing or malformed/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-shuttle' }, 'pi-shuttle', '0.1.0', 'pi-shuttle'), /missing or malformed/);
});

test('builder (F-02): a tgz without package.json is refused at read time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-builder.XXXXXX'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'package', 'dist'), { recursive: true });
    writeFileSync(join(root, 'package', 'dist', 'cli.js'), '// nothing');
    const tgz = join(dir, 'artifact.tgz');
    const result = spawnSync('tar', ['-czf', tgz, '-C', root, 'package'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.throws(() => readTgzPackageIdentity(tgz), /package\.json missing or unreadable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builder (F-02): a tgz with malformed package.json is refused at read time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-builder.XXXXXX'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'package'), { recursive: true });
    writeFileSync(join(root, 'package', 'package.json'), '{ not json !');
    const tgz = join(dir, 'artifact.tgz');
    const result = spawnSync('tar', ['-czf', tgz, '-C', root, 'package'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.throws(() => readTgzPackageIdentity(tgz), /malformed JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
