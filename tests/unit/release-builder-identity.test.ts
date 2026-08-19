/**
 * Manifest-native distribution tests: release-builder identity verification
 * and manifest-native release inventory.
 *
 * The builder produces ONLY the pi-shuttle distribution (pi-shuttle package
 * + manifest-native install.sh + SHA256SUMS). Gateway release authority is
 * external signed metadata consumed by the manifest-native installer; the
 * builder carries no Gateway artifact, no release envelope, and no pi-guard
 * artifact. These tests verify the builder's identity/checksum functions
 * and that neither the builder nor the corrected template reintroduces the
 * previous-generation envelope/selection grammar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The builder is a plain .mjs script at the repo root (dist-test mirrors
// only compiled TS); its direct-execution guard keeps importing it
// side-effect free.
const BUILDER = pathToFileURL(join(import.meta.dirname, '..', '..', '..', 'scripts', 'build-release.mjs')).href;
const {
  checksumLines,
  flatReleasePublicationAssets,
  readTgzPackageIdentity,
  releaseInventoryAssets,
  verifyPackageIdentity,
} = await import(BUILDER);

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
  const dir = mkdtempSync(join(tmpdir(), 'dist-builder.XXXXXX'));
  try {
    const tgz = makeTgz(dir, 'pi-shuttle', '0.1.1');
    const identity = readTgzPackageIdentity(tgz);
    assert.equal(identity.name, 'pi-shuttle');
    assert.equal(identity.version, '0.1.1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('builder (F-02): verifyPackageIdentity accepts the exact pi-shuttle identity', () => {
  verifyPackageIdentity({ name: 'pi-shuttle', version: '0.1.1' }, 'pi-shuttle', '0.1.1', 'pi-shuttle');
});

test('builder (F-02): wrong name or version fails closed', () => {
  assert.throws(() => verifyPackageIdentity({ name: 'other-package', version: '0.1.1' }, 'pi-shuttle', '0.1.1', 'pi-shuttle'), /identity mismatch/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-shuttle', version: '0.2.0' }, 'pi-shuttle', '0.1.1', 'pi-shuttle'), /identity mismatch/);
});

test('builder (F-02): malformed or missing identity fails closed', () => {
  assert.throws(() => verifyPackageIdentity(null, 'pi-shuttle', '0.1.1', 'pi-shuttle'), /missing or malformed/);
  assert.throws(() => verifyPackageIdentity({}, 'pi-shuttle', '0.1.1', 'pi-shuttle'), /missing or malformed/);
  assert.throws(() => verifyPackageIdentity({ name: 'pi-shuttle' }, 'pi-shuttle', '0.1.1', 'pi-shuttle'), /missing or malformed/);
});

test('builder (F-02): a tgz without package.json is refused at read time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-builder.XXXXXX'));
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
  const dir = mkdtempSync(join(tmpdir(), 'dist-builder.XXXXXX'));
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

test('builder (E2A): manifest-native inventory contains only the pi-shuttle distribution assets', () => {
  const assets = releaseInventoryAssets('pi-shuttle-0.1.1.tgz');
  assert.deepEqual(assets, ['install.sh', 'pi-shuttle-0.1.1.tgz']);
  // No previous-generation distribution assets.
  for (const forbidden of ['-linux-x86_64.json', '-macos.json', 'project-gateway', 'pi-guard-']) {
    assert.equal(assets.some((asset: string) => asset.includes(forbidden)), false, `inventory must not contain ${forbidden}`);
  }
});

test('builder (PUBLICATION-LAYOUT): the flat seven-asset publication inventory is exactly representable', () => {
  const assets = flatReleasePublicationAssets({
    piShuttleTgz: 'pi-shuttle-0.1.3.tgz',
    gatewayArtifactFileName: 'project-gateway-macos-core-0.1.0.tgz',
    releaseId: 'gateway-macos-release-002',
    releaseManifestSha256: '6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd6630',
  });
  assert.deepEqual(assets, [
    'install.sh',
    'pi-shuttle-0.1.3.tgz',
    'project-gateway-macos-core-0.1.0.tgz',
    'gateway-meta-keyring.json',
    'gateway-meta-stable-channel.json',
    'gateway-meta-release-gateway-macos-release-002-6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd6630.json',
  ]);
  for (const asset of assets) {
    assert.equal(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset), true, asset);
    assert.equal(asset.includes('/'), false, asset);
    assert.equal(asset.includes('\\'), false, asset);
  }
});

test('builder (PUBLICATION-LAYOUT): the flat publication inventory fails closed on non-canonical selection', () => {
  for (const releaseId of ['Uppercase', 'has/slash', '..traversal']) {
    assert.throws(
      () => flatReleasePublicationAssets({ piShuttleTgz: 'pi-shuttle-0.1.3.tgz', gatewayArtifactFileName: 'project-gateway-macos-core-0.1.0.tgz', releaseId, releaseManifestSha256: '6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd6630' }),
      /cannot derive a canonical flat release-manifest asset name/,
      releaseId,
    );
  }
  for (const digest of ['ABCD', '6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd663', 'has/slash']) {
    assert.throws(
      () => flatReleasePublicationAssets({ piShuttleTgz: 'pi-shuttle-0.1.3.tgz', gatewayArtifactFileName: 'project-gateway-macos-core-0.1.0.tgz', releaseId: 'gateway-macos-release-002', releaseManifestSha256: digest }),
      /cannot derive a canonical flat release-manifest asset name/,
      digest,
    );
  }
  assert.throws(
    () => flatReleasePublicationAssets({ piShuttleTgz: 'pi-shuttle-0.1.3.tgz', gatewayArtifactFileName: '../escape.tgz', releaseId: 'gateway-macos-release-002', releaseManifestSha256: '6c09b30097d192abdb3575c5d9b882f45816b7c21d3966facf3d4a22ccfd6630' }),
    /not a single flat GitHub asset filename/,
    'the gateway artifact file name must itself be one flat filename',
  );
});

test('builder (E2A): SHA256SUMS rows cover the complete manifest-native inventory', () => {  const dir = mkdtempSync(join(tmpdir(), 'dist-sums.XXXXXX'));
  try {
    const assets = releaseInventoryAssets('pi-shuttle-0.1.1.tgz');
    for (const [index, asset] of assets.entries()) writeFileSync(join(dir, asset), `asset-${index}`);
    const sums = checksumLines(dir, assets);
    assert.equal(sums.length, assets.length);
    assert.deepEqual(sums.map((line: string) => line.slice(66)).sort(), [...assets].sort());
    assert.equal(sums.every((line: string) => /^[0-9a-f]{64}  [^/]+$/.test(line)), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist: the release builder and template carry no previous-generation Gateway/pi-guard authority', () => {
  const builder = readFileSync(join(import.meta.dirname, '..', '..', '..', 'scripts', 'build-release.mjs'), 'utf8');
  const template = readFileSync(join(import.meta.dirname, '..', '..', '..', 'scripts', 'install-release.template.sh'), 'utf8');
  for (const forbidden of ['createReleaseEnvelope', 'selectGatewayReleaseDescriptor', 'verifyGatewayPackageIdentity', 'validateEnvelope', 'pi-guard-', 'project-gateway-', 'PI_SHUTTLE_RELEASE_ENVELOPE']) {
    assert.equal(builder.includes(forbidden), false, `builder must not reference ${forbidden}`);
  }
  for (const forbidden of ['--gateway', '--pi-guard', '--batch', 'PI_SHUTTLE_RELEASE_ENVELOPE', 'bootstrap.js']) {
    assert.equal(template.includes(forbidden), false, `template must not reference ${forbidden}`);
  }
  // The builder routes the generated installer to the manifest-native entry.
  assert.ok(builder.includes('dist/installer/main.js'), 'the builder must verify the manifest-native production entry');
  // The builder excludes historical installer-only modules from the package.
  assert.ok(builder.includes('dist/installer/legacy-entry.js'), 'the builder must enforce the historical-code exclusion');
});

test('dist: the package ships no historical installer-only module (distribution hygiene)', async () => {
  const builder = readFileSync(join(import.meta.dirname, '..', '..', '..', 'scripts', 'build-release.mjs'), 'utf8');
  const installSh = readFileSync(join(import.meta.dirname, '..', '..', '..', 'install.sh'), 'utf8');
  const HISTORICAL_PACKAGE_EXCLUDES = (await import(BUILDER)).HISTORICAL_PACKAGE_EXCLUDES;
  assert.ok(Array.isArray(HISTORICAL_PACKAGE_EXCLUDES) && HISTORICAL_PACKAGE_EXCLUDES.length >= 4, 'the builder must enumerate the historical installer-only exclusions');
  // The builder removes them from the clean-room dist before packing.
  assert.ok(builder.includes('HISTORICAL_PACKAGE_EXCLUDES'), 'the builder must reference the exclusion list');
  // The master-snapshot install.sh removes the same compiled paths before npm pack.
  for (const rel of HISTORICAL_PACKAGE_EXCLUDES) {
    assert.equal(installSh.includes(rel.replace(/^dist\//, '')), true, `install.sh must exclude ${rel}`);
    assert.equal(builder.includes(rel), true, `builder must exclude ${rel}`);
  }
  // The production installer entry and the shared runtime modules are NOT
  // in the exclusion list (they must continue to ship).
  for (const kept of ['dist/installer/main.js', 'dist/installer/release/bootstrap.js', 'dist/installer/release/envelope.js', 'dist/manifest-native/install.js']) {
    assert.equal(HISTORICAL_PACKAGE_EXCLUDES.includes(kept), false, `shared module must not be excluded: ${kept}`);
  }
});
