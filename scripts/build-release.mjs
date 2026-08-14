#!/usr/bin/env node
/**
 * PS-8A release-candidate builder (deterministic local release
 * preparation). Produces the complete v0.1.0 release asset set under
 * dist-release/v0.1.0/ from EXACT clean component source checkouts and
 * the exact release-candidate pi-shuttle tree.
 *
 * The builder NEVER: pushes, tags, calls GitHub Release APIs, uploads,
 * publishes npm packages, or modifies component repositories.
 *
 * Usage:
 *   node scripts/build-release.mjs \
 *     --gateway-checkout <path> --pi-guard-checkout <path> \
 *     [--out dist-release/v0.1.0]
 *
 * Requires: `npm run build` already done in this repository (the
 * builder validates its output against the built release modules).
 *
 * Asset set produced:
 *   install.sh                                  version-specific bootstrap
 *   pi-shuttle-0.1.0.json                       release envelope (closed schema)
 *   pi-shuttle-0.1.0.tgz                        pi-shuttle package (dist only)
 *   project-gateway-artifact-core-0.1.0.tgz     Gateway artifact incl. pinned
 *                                               runtime dependencies
 *                                               (materialized; PS5-LINUX-003)
 *   pi-guard-0.1.2.tgz                          pi-guard artifact (no deps)
 *   SHA256SUMS                                  sha256 of every asset
 *
 * Self-reference note (§7): no cycle exists. The envelope carries the
 * digests of the pi-shuttle package and the component artifacts; the
 * envelope's own digest is embedded in install.sh; nothing embeds
 * install.sh's digest (SHA256SUMS covers it, generated last). The
 * runtime compatibility manifest (src/compat/manifest.ts) is frozen
 * source and is never rewritten by the builder.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { validateEnvelope } from '../dist/installer/release/envelope.js';
import { scanArtifactMembers } from '../dist/installer/archive.js';
import { GATEWAY_PACKAGE_NAME, PI_GUARD_PACKAGE_NAME, PI_SHUTTLE_PACKAGE_NAME } from '../dist/installer/components.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DEFAULT = join(ROOT, 'dist-release', 'v0.1.0');

const RELEASE_VERSION = '0.1.0';
const ENVELOPE_FILE = `pi-shuttle-${RELEASE_VERSION}.json`;
const PI_SHUTTLE_TGZ = `pi-shuttle-${RELEASE_VERSION}.tgz`;
const GATEWAY_TGZ = 'project-gateway-artifact-core-0.1.0.tgz';
const PI_GUARD_TGZ = 'pi-guard-0.1.2.tgz';
const INSTALL_SH = 'install.sh';
const SHA256SUMS = 'SHA256SUMS';

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
 * F-02: read the package identity (package.json) of a packed tgz
 * artifact. The artifact bytes are the source of truth — the envelope
 * must never claim an identity the artifact does not have. Throws on
 * any failure (callers convert to a build failure).
 */
export function readTgzPackageIdentity(tgzPath) {
  const result = spawnSync('tar', ['-xzf', tgzPath, '-O', 'package/package.json'], { encoding: 'utf8' });
  if (result.error) throw new Error(`${tgzPath}: tar failed to start: ${result.error.message}`);
  if (result.status !== 0 || result.stdout.trim().length === 0) {
    throw new Error(`${tgzPath}: package.json missing or unreadable in the packed artifact (tar exit ${result.status ?? 'unknown'})`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`${tgzPath}: package.json in the packed artifact is malformed JSON (${err.message})`);
  }
}

/**
 * F-02: build-time identity gate — the release envelope may only bind
 * artifacts whose package name/version EXACTLY match the approved pins.
 * Throws on any mismatch; install-time verification (unchanged) remains
 * defense in depth.
 */
export function verifyPackageIdentity(identity, expectedName, expectedVersion, label) {
  if (identity === null || typeof identity !== 'object' || typeof identity.name !== 'string' || typeof identity.version !== 'string') {
    throw new Error(`${label}: package identity missing or malformed in the packed artifact`);
  }
  if (identity.name !== expectedName || identity.version !== expectedVersion) {
    throw new Error(`${label}: package identity mismatch — expected ${expectedName}@${expectedVersion}, artifact declares ${identity.name}@${identity.version} (fail closed)`);
  }
}

/** Fail-closed wrapper used by the build itself. */
function verifyArtifactIdentity(tgzPath, expectedName, expectedVersion, label) {
  try {
    verifyPackageIdentity(readTgzPackageIdentity(tgzPath), expectedName, expectedVersion, label);
  } catch (err) {
    fail(err.message);
  }
}

function verifyCheckout(label, path, expectedCommit, expectedTag = null) {
  if (!existsSync(join(path, '.git'))) fail(`${label} checkout is not a git repository: ${path}`);
  const head = run('git', ['-C', path, 'rev-parse', 'HEAD']);
  if (head !== expectedCommit) fail(`${label} HEAD mismatch: expected ${expectedCommit}, got ${head} (fail closed)`);
  if (expectedTag !== null) {
    const tag = run('git', ['-C', path, 'describe', '--tags', '--exact-match', expectedCommit], { allowNonZero: true });
    if (tag !== expectedTag) fail(`${label} tag mismatch: expected ${expectedTag} at ${expectedCommit}, got '${tag || 'none'}'`);
  }
  const dirty = run('git', ['-C', path, 'status', '--porcelain']).split('\n').filter((l) => l.length > 0 && !l.startsWith('??'));
  if (dirty.length > 0) fail(`${label} checkout has tracked modifications; a clean closure is required`);
  console.log(`build-release: ${label} baseline verified (${head}${expectedTag ? ', ' + expectedTag : ''})`);
}

// ─── deterministic tar writer (ustar; used for the materialized Gateway artifact) ───

function ustarHeader(name, typeflag, size, mode) {
  const prefix = '';
  let storedName = name;
  let storedPrefix = '';
  if (Buffer.byteLength(name, 'utf8') > 100) {
    // Split at the last '/' within the 155-byte prefix budget.
    const parts = name.split('/');
    let candidatePrefix = '';
    let candidateName = name;
    for (let i = parts.length - 1; i > 0; i -= 1) {
      candidatePrefix = parts.slice(0, i).join('/');
      candidateName = parts.slice(i).join('/');
      if (Buffer.byteLength(candidatePrefix, 'utf8') <= 155 && Buffer.byteLength(candidateName, 'utf8') <= 100) break;
    }
    if (Buffer.byteLength(candidatePrefix, 'utf8') > 155 || Buffer.byteLength(candidateName, 'utf8') > 100) {
      throw new Error(`member path cannot be represented in ustar: ${name}`);
    }
    storedPrefix = candidatePrefix;
    storedName = candidateName;
  }
  const header = Buffer.alloc(512);
  header.write(storedName, 0, 100, 'utf8');
  header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii'); // uid
  header.write('0000000\0', 116, 8, 'ascii'); // gid
  header.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii'); // mtime (SOURCE_DATE_EPOCH = 0)
  header.write('        ', 148, 8, 'ascii'); // checksum placeholder (spaces)
  header.write(typeflag, 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(storedPrefix, 345, 155, 'utf8');
  // checksum: sum of bytes with the checksum field as spaces
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

/** Collect entries (lstat; symlinks/special files fail loudly), sorted by name. */
function collectEntries(rootDir) {
  const entries = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`symlink found in materialized tree (not allowed by the installer scanner): ${abs}`);
      if (!st.isFile() && !st.isDirectory()) throw new Error(`special file found in materialized tree: ${abs}`);
      entries.push({ abs, rel: relative(rootDir, abs), dir: st.isDirectory(), mode: st.isDirectory() ? (st.mode & 0o777) || 0o755 : (st.mode & 0o777) || 0o644 });
      if (st.isDirectory()) walk(abs);
    }
  };
  walk(rootDir);
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return entries;
}

/** Deterministic tar.gz: ustar entries, sorted, mtime 0, gzip level 9. */
function writeTarGz(rootDir, topPrefix, outPath) {
  const entries = collectEntries(rootDir);
  const chunks = [];
  const pushHeader = (name, typeflag, size, mode) => {
    const header = ustarHeader(name, typeflag, size, mode);
    chunks.push(header);
    if (typeflag === '0') {
      // Tar payloads MUST be padded to a 512-byte boundary; without the
      // padding the next header would be consumed as payload by readers.
      const payload = readFileSync(join(rootDir, name.startsWith(`${topPrefix}/`) ? name.slice(topPrefix.length + 1) : name));
      chunks.push(payload);
      const pad = (512 - (payload.length % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
  };
  // Top-level prefix directory entry first.
  pushHeader(`${topPrefix}/`, '5', 0, 0o755);
  for (const entry of entries) {
    const memberName = `${topPrefix}/${entry.rel}`;
    if (entry.dir) pushHeader(`${memberName}/`, '5', 0, entry.mode);
    else pushHeader(memberName, '0', statSync(entry.abs).size, entry.mode);
  }
  chunks.push(Buffer.alloc(1024)); // end-of-archive
  const tar = Buffer.concat(chunks);
  writeFileSync(outPath, gzipSync(tar, { level: 9 }));
}

// ─── main ───

function parseArgs(argv) {
  const options = { gatewayCheckout: null, piGuardCheckout: null, out: OUT_DEFAULT };
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--gateway-checkout' || flag === '--pi-guard-checkout' || flag === '--out') {
      if (value === undefined) fail(`${flag} requires a value`);
      if (flag === '--gateway-checkout') options.gatewayCheckout = value;
      if (flag === '--pi-guard-checkout') options.piGuardCheckout = value;
      if (flag === '--out') options.out = value;
      i += 2;
    } else {
      fail(`unknown argument: ${flag}\nusage: node scripts/build-release.mjs --gateway-checkout <path> --pi-guard-checkout <path> [--out <dir>]`);
    }
  }
  if (options.gatewayCheckout === null || options.piGuardCheckout === null) {
    fail('--gateway-checkout and --pi-guard-checkout are required');
  }
  return options;
}

// Pins: imported from the built manifest (the release must be built from
// the exact pins the product itself declares — no separate pin source).
const manifest = await import(pathToFileURL(join(ROOT, 'dist', 'compat', 'manifest.js')).href);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const gatewayCheckout = resolve(options.gatewayCheckout);
  const piGuardCheckout = resolve(options.piGuardCheckout);
  const out = resolve(options.out);

  if (!existsSync(join(ROOT, 'dist', 'installer', 'release', 'bootstrap.js'))) {
    fail('dist is missing or stale — run `npm run build` first');
  }
  console.log(`build-release: pi-shuttle release candidate v${manifest.PI_SHUTTLE_VERSION}`);

  verifyCheckout('gateway', gatewayCheckout, manifest.GATEWAY_PS1_BASELINE_COMMIT);
  verifyCheckout('pi-guard', piGuardCheckout, manifest.PI_GUARD_COMMIT, manifest.PI_GUARD_TAG);

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
    run('npm', ['pack', '--pack-destination', out], { cwd: shuttle });
    if (!existsSync(join(out, PI_SHUTTLE_TGZ))) fail(`expected pi-shuttle package not produced: ${PI_SHUTTLE_TGZ}`);
    // F-02: the packed artifact itself must declare the exact identity.
    verifyArtifactIdentity(join(out, PI_SHUTTLE_TGZ), PI_SHUTTLE_PACKAGE_NAME, manifest.PI_SHUTTLE_VERSION, 'pi-shuttle');
    console.log(`build-release: pi-shuttle package ${PI_SHUTTLE_TGZ} (identity verified: ${PI_SHUTTLE_PACKAGE_NAME}@${manifest.PI_SHUTTLE_VERSION})`);

    // ── Gateway artifact with materialized pinned runtime dependencies ──
    console.log('build-release: building Gateway artifact with materialized pinned dependencies...');
    const gw = join(work, 'gateway');
    run('git', ['clone', '-q', '--no-local', gatewayCheckout, gw]);
    run('npm', ['ci', '--ignore-scripts'], { cwd: gw });
    run('npm', ['run', 'build'], { cwd: gw });
    run('npm', ['pack', '--silent', '--pack-destination', work], { cwd: gw });
    // Reinstall production-only (exact lockfile) for dependency materialization.
    run('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: gw });
    const gwPkg = join(work, 'gw-pkg');
    mkdirSync(gwPkg, { recursive: true });
    run('tar', ['-xzf', join(work, GATEWAY_TGZ), '-C', gwPkg]);
    const gwPackageDir = join(gwPkg, 'package');
    rmSync(join(gwPackageDir, 'node_modules'), { recursive: true, force: true });
    cpSync(join(gw, 'node_modules'), join(gwPackageDir, 'node_modules'), { recursive: true });
    // Strip npm metadata and .bin symlink trees: the installer's closed
    // archive policy accepts only regular files and directories.
    for (const dir of ['node_modules/.bin']) {
      rmSync(join(gwPackageDir, dir), { recursive: true, force: true });
    }
    const strip = (dir) => {
      for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const st = lstatSync(abs);
        if (st.isDirectory()) {
          if (entry === '.bin') rmSync(abs, { recursive: true, force: true });
          else if (entry === 'node_modules') strip(abs);
          else strip(abs);
        } else if (entry === '.package-lock.json') {
          rmSync(abs, { force: true });
        }
      }
    };
    strip(join(gwPackageDir, 'node_modules'));
    writeTarGz(gwPackageDir, 'package', join(out, GATEWAY_TGZ));
    // F-02: the FINAL retarred artifact must declare the exact identity.
    verifyArtifactIdentity(join(out, GATEWAY_TGZ), GATEWAY_PACKAGE_NAME, manifest.GATEWAY_PACKAGE_VERSION, 'gateway');
    console.log(`build-release: Gateway artifact ${GATEWAY_TGZ} (identity verified: ${GATEWAY_PACKAGE_NAME}@${manifest.GATEWAY_PACKAGE_VERSION}; deps materialized: @modelcontextprotocol/server@2.0.0, ajv@8.20.0, zod@4.4.3)`);

    // ── pi-guard artifact (no runtime dependencies) ──
    console.log('build-release: packing pi-guard artifact...');
    run('npm', ['pack', '--silent', '--ignore-scripts', '--pack-destination', out], { cwd: piGuardCheckout });
    if (!existsSync(join(out, PI_GUARD_TGZ))) fail(`expected pi-guard package not produced: ${PI_GUARD_TGZ}`);
    // F-02: the pi-guard artifact's own package.json is the identity
    // source; it must equal the approved pi-guard package identity and
    // version pin exactly.
    verifyArtifactIdentity(join(out, PI_GUARD_TGZ), PI_GUARD_PACKAGE_NAME, manifest.PI_GUARD_VERSION, 'pi-guard');
    console.log(`build-release: pi-guard artifact ${PI_GUARD_TGZ} (identity verified: ${PI_GUARD_PACKAGE_NAME}@${manifest.PI_GUARD_VERSION})`);

    // ── digests, envelope, install.sh, SHA256SUMS ──
    const piShuttleSha = sha256File(join(out, PI_SHUTTLE_TGZ));
    const gatewaySha = sha256File(join(out, GATEWAY_TGZ));
    const piGuardSha = sha256File(join(out, PI_GUARD_TGZ));

    const envelope = {
      schemaVersion: 1,
      releaseVersion: manifest.PI_SHUTTLE_VERSION,
      piShuttle: { version: manifest.PI_SHUTTLE_VERSION, fileName: PI_SHUTTLE_TGZ, sha256: piShuttleSha },
      gateway: {
        packageVersion: manifest.GATEWAY_PACKAGE_VERSION,
        sourceCommit: manifest.GATEWAY_PS1_BASELINE_COMMIT,
        fileName: GATEWAY_TGZ,
        sha256: gatewaySha,
      },
      piGuard: {
        version: manifest.PI_GUARD_VERSION,
        sourceCommit: manifest.PI_GUARD_COMMIT,
        sourceTag: manifest.PI_GUARD_TAG,
        fileName: PI_GUARD_TGZ,
        sha256: piGuardSha,
      },
      policy: {
        gatewayDependencies: { ...manifest.GATEWAY_DEPENDENCIES },
        configurationVersion: manifest.CONFIGURATION_VERSION,
        configFormatVersion: manifest.CONFIG_FORMAT_VERSION,
        nodeLaneVersion: manifest.NODE_LANE_VERSION,
        gitLaneVersion: manifest.GIT_LANE_VERSION,
        nodeRuntimeMinimum: manifest.NODE_RUNTIME_MINIMUM,
        gitRuntimeMinimum: manifest.GIT_RUNTIME_MINIMUM,
        piCompatibilityBaseline: manifest.PI_COMPATIBILITY_BASELINE,
        piRuntimeMinimum: manifest.PI_RUNTIME_MINIMUM,
        supportedLanes: [...manifest.COMPATIBILITY_MANIFEST.supportedLanes],
      },
    };
    const validated = validateEnvelope(envelope);
    if (!validated.ok) fail(`generated envelope failed validation: ${validated.message}`);
    const envelopePath = join(out, ENVELOPE_FILE);
    writeFileSync(envelopePath, JSON.stringify(envelope, null, 2) + '\n');
    const envelopeSha = sha256File(envelopePath);
    console.log(`build-release: envelope ${ENVELOPE_FILE} validated (schema v1, exact pins)`);

    // install.sh: version-specific bootstrap embedding the envelope digest
    // (single crypto trust root for the whole release).
    const template = readFileSync(join(ROOT, 'scripts', 'install-release.template.sh'), 'utf8');
    const installSh = template
      .replaceAll('__RELEASE_VERSION__', RELEASE_VERSION)
      .replaceAll('__ENVELOPE_SHA256__', envelopeSha)
      .replaceAll('__PI_SHUTTLE_TGZ_SHA256__', piShuttleSha);
    const installShPath = join(out, INSTALL_SH);
    writeFileSync(installShPath, installSh);
    chmodSync(installShPath, 0o755);
    run('bash', ['-n', installShPath]);
    const installShSha = sha256File(installShPath);

    const sums = [
      `${installShSha}  ${INSTALL_SH}`,
      `${envelopeSha}  ${ENVELOPE_FILE}`,
      `${piShuttleSha}  ${PI_SHUTTLE_TGZ}`,
      `${gatewaySha}  ${GATEWAY_TGZ}`,
      `${piGuardSha}  ${PI_GUARD_TGZ}`,
    ].sort();
    writeFileSync(join(out, SHA256SUMS), sums.join('\n') + '\n');

    // ── final verification ──
    console.log('build-release: verifying generated assets...');
    const assets = [INSTALL_SH, ENVELOPE_FILE, PI_SHUTTLE_TGZ, GATEWAY_TGZ, PI_GUARD_TGZ];
    for (const asset of assets) {
      const actual = sha256File(join(out, asset));
      const expected = sums.find((line) => line.endsWith(`  ${asset}`))?.split('  ')[0];
      if (actual !== expected) fail(`post-generation verification failed for ${asset}`);
    }
    for (const asset of [PI_SHUTTLE_TGZ, GATEWAY_TGZ, PI_GUARD_TGZ]) {
      const scan = await scanArtifactMembers(join(out, asset));
      if (!scan.ok) fail(`release artifact fails the installer archive policy: ${asset}: ${scan.message}`);
      console.log(`build-release: ${asset} passes the installer archive scan (${scan.memberCount} members)`);
    }
    // Gateway runnability: the exact smoke the installer records as
    // installed-verified must pass on the materialized artifact.
    const gwVerify = join(work, 'gw-verify');
    mkdirSync(gwVerify, { recursive: true });
    run('tar', ['-xzf', join(out, GATEWAY_TGZ), '-C', gwVerify]);
    const smoke = spawnSync(process.execPath, [join(gwVerify, 'package', 'dist', 'runtime', 'mcp', 'cli.js'), '--help'], { encoding: 'utf8', timeout: 30_000 });
    if (smoke.status !== 0) fail(`Gateway artifact smoke failed (exit ${smoke.status}): ${(smoke.stderr || smoke.stdout || '').slice(0, 400)}`);
    console.log('build-release: Gateway artifact smoke green (installed-verified bar)');
    // pi-shuttle package contains the release installer entry.
    const shuttleVerify = join(work, 'shuttle-verify');
    mkdirSync(shuttleVerify, { recursive: true });
    run('tar', ['-xzf', join(out, PI_SHUTTLE_TGZ), '-C', shuttleVerify]);
    for (const entry of ['dist/cli.js', 'dist/installer/release/bootstrap.js', 'dist/installer/main.js']) {
      if (!existsSync(join(shuttleVerify, 'package', entry))) fail(`pi-shuttle release package is missing ${entry}`);
    }

    console.log('\nbuild-release: release-candidate inventory (dist-release/v0.1.0):');
    console.log('  asset                                          size         sha256');
    for (const asset of assets) {
      const size = statSync(join(out, asset)).size;
      console.log(`  ${asset.padEnd(44)} ${String(size).padStart(10)}  ${sha256File(join(out, asset))}`);
    }
    console.log('\nbuild-release: OK — release candidate complete and verified (no push/tag/upload performed)');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Direct-execution guard: run the builder only when executed, never when
// imported by tests (F-02 identity helpers are importable). realpath keeps
// the comparison symlink-safe, matching the installer entries.
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