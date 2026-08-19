#!/usr/bin/env node
/**
 * Manifest-native release-candidate builder (deterministic local release
 * preparation). Produces the pi-shuttle release asset set under the
 * output directory from the EXACT release-candidate pi-shuttle tree.
 *
 * Asset set produced:
 *   install.sh                            manifest-native release bootstrap
 *   pi-shuttle-<version>.tgz              pi-shuttle package (dist only)
 *   SHA256SUMS                            sha256 of every asset
 *
 * Gateway release authority is EXTERNAL to this builder: the signed
 * Gateway metadata chain (keyring -> stable channel -> release manifest)
 * and the Gateway artifact live at the compiled trusted release origin
 * and are consumed/verified by the manifest-native installer at install
 * time. This builder therefore produces NO Gateway artifacts, NO release
 * envelope, and NO pi-guard artifact (pi-guard is independently managed).
 * It embeds no Gateway version/commit/releaseId/digest/filename and no
 * caller-selected release authority.
 *
 * The builder NEVER: pushes, tags, calls GitHub Release APIs, uploads,
 * publishes npm packages, or modifies component repositories.
 *
 * Usage:
 *   node scripts/build-release.mjs [--out <dir>] [--release-version <v>]
 *
 * Requires: `npm run build` already done in this repository (the
 * builder validates its output against the built release modules).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanArtifactMembers } from '../dist/installer/archive.js';
import { PI_SHUTTLE_PACKAGE_NAME } from '../dist/installer/components.js';
import {
  GATEWAY_META_KEYRING_ASSET,
  GATEWAY_META_STABLE_CHANNEL_ASSET,
  releaseManifestAssetName,
} from '../dist/manifest-native/release-assets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DEFAULT = join(ROOT, 'dist-release', 'manifest-native-candidate');

/**
 * Previous-generation installer-only modules (historical test-support
 * harness + the old install core/selection/latest channel). Zero production
 * importers; excluded from the shipped package so the public artifact
 * presents no alternate previous-generation installer surface. Shared
 * modules still required by production (receipt.js, components.js,
 * release/envelope.js, compat/manifest.js) are deliberately retained.
 */
export const HISTORICAL_PACKAGE_EXCLUDES = Object.freeze([
  'dist/installer/legacy-entry.js',
  'dist/installer/legacy-entry.d.ts',
  'dist/installer/install.js',
  'dist/installer/install.d.ts',
  'dist/installer/selection.js',
  'dist/installer/selection.d.ts',
  'dist/installer/release/latest.js',
  'dist/installer/release/latest.d.ts',
]);

/** The release bootstrap installer file name (top-level; used by the inventory). */
export const INSTALL_SH = 'install.sh';

const EXCLUDE_RE = /(^|\/)(\.git|node_modules|dist|dist-test|dist-release)(\/|$)|\.DS_Store$/;

function fail(message) {
  console.error(`build-release: ${message}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const { allowNonZero = false, ...spawnOptions } = opts;
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...spawnOptions });
  if (result.error) fail(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0 && !allowNonZero) {
    const detail = (result.stderr || result.stdout || '').trim().slice(0, 800);
    fail(`${cmd} ${args.join(' ')} exited ${result.status}: ${detail}`);
  }
  return result.stdout.trim();
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

/**
 * The complete release inventory (every published asset, excluding
 * SHA256SUMS itself). Manifest-native distribution: the pi-shuttle package
 * and its bootstrap installer only. `piShuttleTgz` is the version-specific
 * package file name (the builder passes the current release's name).
 */
export function releaseInventoryAssets(piShuttleTgz) {
  return [INSTALL_SH, piShuttleTgz];
}

/**
 * The complete flat v<version> release PUBLICATION inventory — every asset
 * a pi-shuttle GitHub Release must carry (SHA256SUMS lists all of them).
 * GitHub Release assets cannot represent slash-bearing names, so every
 * Gateway signed-metadata document is ONE flat filename directly under the
 * release tag; the release-manifest asset name is derived deterministically
 * from the already-validated signed selection and every asset is validated
 * to be a single flat GitHub filename (fails closed). This builder
 * physically produces only the pi-shuttle distribution (install.sh,
 * pi-shuttle-<version>.tgz, SHA256SUMS); the Gateway artifact and the
 * signed metadata arrive from the Gateway release pipeline and are checked
 * here against the flat publication contract.
 */
export function flatReleasePublicationAssets({ piShuttleTgz, gatewayArtifactFileName, releaseId, releaseManifestSha256 }) {
  const manifestAsset = releaseManifestAssetName(releaseId, releaseManifestSha256);
  if (manifestAsset === null) {
    throw new Error(`flatReleasePublicationAssets: signed selection cannot derive a canonical flat release-manifest asset name (releaseId=${JSON.stringify(releaseId)})`);
  }
  const assets = [INSTALL_SH, piShuttleTgz, gatewayArtifactFileName, GATEWAY_META_KEYRING_ASSET, GATEWAY_META_STABLE_CHANNEL_ASSET, manifestAsset];
  for (const asset of assets) {
    if (typeof asset !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset) || asset.includes('/') || asset.includes('\\')) {
      throw new Error(`flatReleasePublicationAssets: ${JSON.stringify(asset)} is not a single flat GitHub asset filename (fail closed)`);
    }
  }
  return assets;
}

/** SHA256SUMS rows for every published asset, sorted by the complete row. */
export function checksumLines(out, assets) {
  return assets.map((asset) => `${sha256File(join(out, asset))}  ${asset}`).sort();
}

/**
 * Read the package identity (package.json) of a packed tgz artifact. The
 * artifact bytes are the source of truth — the release must never claim an
 * identity the artifact does not have. Throws on any failure.
 */
export function readTgzPackageIdentity(tgzPath) {
  const result = run('tar', ['-xzf', tgzPath, '-O', 'package/package.json'], { allowNonZero: true });
  if (result.length === 0) throw new Error(`${tgzPath}: package.json missing or unreadable in the packed artifact`);
  try {
    return JSON.parse(result);
  } catch (err) {
    throw new Error(`${tgzPath}: package.json in the packed artifact is malformed JSON (${err.message})`);
  }
}

/** Build-time identity gate: the packed pi-shuttle package must declare the exact identity. */
export function verifyPackageIdentity(identity, expectedName, expectedVersion, label) {
  if (identity === null || typeof identity !== 'object' || typeof identity.name !== 'string' || typeof identity.version !== 'string') {
    throw new Error(`${label}: package identity missing or malformed in the packed artifact`);
  }
  if (identity.name !== expectedName || identity.version !== expectedVersion) {
    throw new Error(`${label}: package identity mismatch — expected ${expectedName}@${expectedVersion}, artifact declares ${identity.name}@${identity.version} (fail closed)`);
  }
}

function parseArgs(argv) {
  const options = { out: OUT_DEFAULT, releaseVersion: null };
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--out' || flag === '--release-version') {
      if (value === undefined) fail(`${flag} requires a value`);
      if (flag === '--out') options.out = value;
      else options.releaseVersion = value;
      i += 2;
    } else {
      fail(`unknown argument: ${flag}\nusage: node scripts/build-release.mjs [--out <dir>] [--release-version <v>]`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await import(pathToFileURL(join(ROOT, 'dist', 'compat', 'manifest.js')).href);
  const RELEASE_VERSION = options.releaseVersion ?? manifest.PI_SHUTTLE_VERSION;
  const PI_SHUTTLE_TGZ = `pi-shuttle-${RELEASE_VERSION}.tgz`;
  const SHA256SUMS = 'SHA256SUMS';
  const out = resolve(options.out);

  if (!existsSync(join(ROOT, 'dist', 'installer', 'main.js'))) {
    fail('dist is missing or stale — run `npm run build` first');
  }
  console.log(`build-release: pi-shuttle release candidate v${RELEASE_VERSION}`);

  if (existsSync(out) && readdirSync(out).length > 0) {
    fail(`output directory must be absent or empty so SHA256SUMS covers the complete inventory: ${out}`);
  }
  mkdirSync(out, { recursive: true });
  const work = join(tmpdir(), `pi-shuttle-release-build.${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  try {
    // ── pi-shuttle package (clean-room from the exact candidate tree) ──
    console.log('build-release: building pi-shuttle package (clean-room)...');
    const shuttle = join(work, 'pi-shuttle');
    cpSync(ROOT, shuttle, {
      recursive: true,
      filter: (src) => !EXCLUDE_RE.test(relative(ROOT, src) || ''),
    });
    run('npm', ['ci', '--ignore-scripts'], { cwd: shuttle });
    run('npm', ['run', 'build'], { cwd: shuttle });
    // Distribution hygiene: remove the historical installer-only modules
    // from the clean-room dist before packing so the public artifact ships
    // no alternate previous-generation installer surface.
    for (const rel of HISTORICAL_PACKAGE_EXCLUDES) {
      rmSync(join(shuttle, rel), { force: true });
    }
    run('npm', ['pack', '--pack-destination', out], { cwd: shuttle });
    if (!existsSync(join(out, PI_SHUTTLE_TGZ))) fail(`expected pi-shuttle package not produced: ${PI_SHUTTLE_TGZ}`);
    // The packed artifact itself must declare the exact identity.
    try {
      verifyPackageIdentity(readTgzPackageIdentity(join(out, PI_SHUTTLE_TGZ)), PI_SHUTTLE_PACKAGE_NAME, RELEASE_VERSION, 'pi-shuttle');
    } catch (err) {
      fail(err.message);
    }
    console.log(`build-release: pi-shuttle package ${PI_SHUTTLE_TGZ} (identity verified: ${PI_SHUTTLE_PACKAGE_NAME}@${RELEASE_VERSION})`);

    // ── installer entry present and no historical installer surface ──
    const shuttleVerify = join(work, 'shuttle-verify');
    mkdirSync(shuttleVerify, { recursive: true });
    run('tar', ['-xzf', join(out, PI_SHUTTLE_TGZ), '-C', shuttleVerify]);
    const pkg = join(shuttleVerify, 'package');
    for (const entry of ['dist/cli.js', 'dist/installer/main.js', 'dist/installer/release/bootstrap.js']) {
      if (!existsSync(join(pkg, entry))) fail(`pi-shuttle release package is missing ${entry}`);
    }
    // Distribution hygiene: the previous-generation installer-only
    // harness/core must not be shipped as an alternate install surface.
    for (const entry of ['dist/installer/legacy-entry.js', 'dist/installer/install.js', 'dist/installer/selection.js', 'dist/installer/release/latest.js']) {
      if (existsSync(join(pkg, entry))) fail(`release package must not ship historical installer-only module: ${entry}`);
    }

    // ── install.sh: manifest-native release bootstrap embedding the
    //    pi-shuttle package digest ──
    const piShuttleSha = sha256File(join(out, PI_SHUTTLE_TGZ));
    const template = readFileSync(join(ROOT, 'scripts', 'install-release.template.sh'), 'utf8');
    const installSh = template
      .replaceAll('__RELEASE_VERSION__', RELEASE_VERSION)
      .replaceAll('__PI_SHUTTLE_TGZ_SHA256__', piShuttleSha);
    if (installSh.includes('__RELEASE_VERSION__') || installSh.includes('__PI_SHUTTLE_TGZ_SHA256__')) {
      fail('generated install.sh contains an unresolved template placeholder');
    }
    const installShPath = join(out, INSTALL_SH);
    writeFileSync(installShPath, installSh);
    chmodSync(installShPath, 0o755);
    run('bash', ['-n', installShPath]);

    const assets = releaseInventoryAssets(PI_SHUTTLE_TGZ);
    const sums = checksumLines(out, assets);
    writeFileSync(join(out, SHA256SUMS), sums.join('\n') + '\n');

    // ── final verification ──
    console.log('build-release: verifying generated assets...');
    for (const asset of assets) {
      const actual = sha256File(join(out, asset));
      const expected = sums.find((line) => line.endsWith(`  ${asset}`))?.split('  ')[0];
      if (actual !== expected) fail(`post-generation verification failed for ${asset}`);
    }
    const expectedOutputFiles = [...assets, SHA256SUMS].sort();
    const actualOutputFiles = readdirSync(out).sort();
    if (actualOutputFiles.join('\0') !== expectedOutputFiles.join('\0')) {
      fail(`release output inventory mismatch: expected ${expectedOutputFiles.join(', ')}, got ${actualOutputFiles.join(', ')}`);
    }
    const scan = await scanArtifactMembers(join(out, PI_SHUTTLE_TGZ));
    if (!scan.ok) fail(`pi-shuttle package fails the installer archive policy: ${scan.message}`);
    console.log(`build-release: ${PI_SHUTTLE_TGZ} passes the installer archive scan (${scan.memberCount} members)`);

    console.log('\nbuild-release: release-candidate inventory:');
    console.log('  asset                                          size         sha256');
    for (const asset of [...assets, SHA256SUMS]) {
      const size = statSync(join(out, asset)).size;
      console.log(`  ${asset.padEnd(44)} ${String(size).padStart(10)}  ${sha256File(join(out, asset))}`);
    }
    console.log('\nbuild-release: OK — release candidate complete and verified (no push/tag/upload performed)');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Direct-execution guard: run the builder only when executed, never when
// imported by tests. realpath keeps the comparison symlink-safe, matching
// the installer entries.
if (process.argv[1] !== undefined) {
  let entryPath = null;
  try {
    entryPath = realpathSync(process.argv[1]);
  } catch {
    entryPath = null;
  }
  if (entryPath !== null && import.meta.url === pathToFileURL(entryPath).href) {
    await main();
  }
}
