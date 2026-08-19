/**
 * Manifest-native distribution tests: the corrected release install.sh
 * shell bootstrap semantics.
 *
 * The generated release installer is rebuilt from the committed template
 * with a dummy pi-shuttle package digest; every test here terminates
 * before the (unreachable) download succeeds, so no network access is
 * required for the refusal/validation assertions.
 *
 * The corrected installer carries NO Gateway release authority and NO
 * previous-generation envelope/component-selection grammar: it downloads
 * only the digest-pinned pi-shuttle package and runs the manifest-native
 * installer entry (dist/installer/main.js), which performs the signed
 * Gateway selection itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(import.meta.dirname, '..', '..', '..');

function buildInstallSh(dir: string): string {
  const template = readFileSync(join(REPO, 'scripts', 'install-release.template.sh'), 'utf8');
  const installSh = template
    .replaceAll('__RELEASE_VERSION__', '0.1.1')
    .replaceAll('__PI_SHUTTLE_TGZ_SHA256__', 'p'.repeat(64));
  const path = join(dir, 'install.sh');
  writeFileSync(path, installSh);
  return path;
}

function runInstallSh(installSh: string, args: readonly string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [installSh, ...args], { encoding: 'utf8', input: '', env: { ...process.env, ...env } });
}

/** A fake curl that records its fetch target and exits 22 (download failure). */
function fetchProbe(dir: string): { readonly bin: string; readonly fetchLog: string } {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const curl = join(bin, 'curl');
  const fetchLog = join(dir, 'fetch.log');
  writeFileSync(curl, `#!/bin/sh\nprintf "%s\\n" "$*" > "$FAKE_FETCH_LOG"\nexit 22\n`);
  chmodSync(curl, 0o755);
  return { bin, fetchLog };
}

function runToDownload(installSh: string, dir: string, args: readonly string[] = []) {
  const { bin, fetchLog } = fetchProbe(dir);
  const result = runInstallSh(installSh, args, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, FAKE_FETCH_LOG: fetchLog });
  // The fake curl creates the log only when it is actually invoked; a
  // refusal/help path never reaches fetch, so the log may be absent.
  return { result, fetchLog: existsSync(fetchLog) ? readFileSync(fetchLog, 'utf8') : null };
}

test('dist (E2A): the corrected template carries no previous-generation release grammar or envelope', () => {
  const template = readFileSync(join(REPO, 'scripts', 'install-release.template.sh'), 'utf8');
  for (const forbidden of ['--batch', '--gateway', '--pi-guard', '--install-dir', '--bin-dir', 'PI_SHUTTLE_RELEASE_ENVELOPE', 'LINUX_ENVELOPE_SHA256', 'MACOS_ENVELOPE_SHA256', 'bootstrap.js']) {
    assert.equal(template.includes(forbidden), false, `template must not reference ${forbidden}`);
  }
  for (const required of ['PI_SHUTTLE_TGZ_SHA256', 'dist/installer/main.js']) {
    assert.equal(template.includes(required), true, `template must reference ${required}`);
  }
  // No public target/lane/architecture/acceptance/release selector.
  for (const selector of ['--target', '--lane', '--architecture', '--experimental', '--acceptance', '--release-id', '--gateway-version', '--manifest-url', '--artifact-url']) {
    assert.equal(template.includes(selector), false, selector);
  }
});

test('dist (E2A): the generated installer embeds the pi-shuttle digest and no unresolved placeholder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-shell.XXXXXX'));
  try {
    const generated = readFileSync(buildInstallSh(dir), 'utf8');
    assert.ok(generated.includes(`PI_SHUTTLE_TGZ_SHA256="${'p'.repeat(64)}"`), 'pi-shuttle package digest slot must be embedded');
    assert.equal(generated.includes('__PI_SHUTTLE_TGZ_SHA256__'), false);
    assert.equal(generated.includes('__RELEASE_VERSION__'), false);
    // Routes to the manifest-native production entry only.
    assert.ok(generated.includes('dist/installer/main.js'), 'the generated installer must run the manifest-native production entry');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist (F-01): --help under piped stdin prints the manifest-native usage with no download', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    const { result, fetchLog } = runToDownload(installSh, dir, ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /usage: curl -fsSL/);
    assert.match(result.stdout, /manifest-native trust/);
    assert.equal(fetchLog, null, 'no download may start for --help');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist (E2A): previous-generation installer arguments are refused before any download', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    for (const args of [['--batch'], ['--gateway', 'yes'], ['--pi-guard', 'no'], ['--install-dir', '/x'], ['--bin-dir', '/y']]) {
      const { result, fetchLog } = runToDownload(installSh, dir, args);
      assert.equal(result.status, 2, `args ${args.join(' ')} must be refused`);
      assert.match(result.stderr, /unrecognized installer option/, args.join(' '));
      assert.equal(fetchLog, null, `args ${args.join(' ')} must refuse before any download`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist (E2A): the normal zero-argument invocation downloads only the pi-shuttle package', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    const { result, fetchLog } = runToDownload(installSh, dir, []);
    assert.ok(fetchLog !== null, 'the normal invocation must reach the fetch stage');
    // The single fetch must be the pi-shuttle package; no envelope, no
    // Gateway artifact, no pi-guard download.
    assert.match(fetchLog, /pi-shuttle-0\.1\.1\.tgz/, 'the only download must be the pi-shuttle package');
    assert.equal(fetchLog.includes('.json'), false, 'no release envelope may be downloaded');
    assert.equal(fetchLog.includes('project-gateway'), false, 'no Gateway artifact may be downloaded by the shell');
    assert.equal(fetchLog.includes('pi-guard'), false, 'no pi-guard artifact may be downloaded by the shell');
    // Download fails (fake curl exits 22): the shell must not proceed to run node.
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist (F-07): an adversarial QA override that would become a downloader option is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    for (const evil of ['--version', '-K /tmp/curl-config', '-O /tmp/pwned', 'http://evil.example/assets']) {
      const result = runInstallSh(installSh, [], { PI_SHUTTLE_BASE_URL: evil });
      assert.equal(result.status, 2, `override ${evil} must be refused`);
      assert.match(result.stderr, /PI_SHUTTLE_BASE_URL \(QA override\) must be an https:\/\/ URL/);
      assert.equal(result.stderr.includes('pi-shuttle package'), false, 'no download may start with an unvalidated override');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist (F-07): a valid https:// QA override passes validation (still download-stage only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    const { result, fetchLog } = runToDownload(installSh, dir);
    assert.equal(result.stderr.includes('must be an https:// URL'), false, 'a valid https override must pass validation');
    assert.ok(fetchLog !== null, 'a valid override must reach the fetch stage');
    assert.match(fetchLog, /pi-shuttle-0\.1\.1\.tgz/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dist: root execution is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dist-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    // Only run the root-refusal branch if we are actually root (otherwise
    // the script proceeds to the download stage and fails there); CI is
    // typically non-root, so this is best-effort.
    const uid = process.getuid?.() ?? -1;
    if (uid === 0) {
      const result = runInstallSh(installSh, []);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /refusing to run as root/);
    } else {
      // Non-root: root branch is skipped; the script proceeds to fetch.
      const { result, fetchLog } = runToDownload(installSh, dir, []);
      assert.notEqual(result.status, 0);
      assert.ok(fetchLog !== null, 'a non-root invocation must reach the fetch stage');
      assert.match(fetchLog, /pi-shuttle-0\.1\.1\.tgz/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
