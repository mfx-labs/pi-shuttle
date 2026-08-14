/**
 * PS-8A focused tests: release install.sh shell bootstrap input
 * semantics (F-01) and QA base-URL override safety (F-07).
 *
 * The generated install.sh is rebuilt from the committed template with
 * dummy digests; every test here terminates before digest verification
 * (refusals happen earlier, and downloads fail on the network because
 * the v0.1.0 release is not published), so no network access is
 * required for the refusal assertions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(import.meta.dirname, '..', '..', '..');

function buildInstallSh(dir: string): string {
  const template = readFileSync(join(REPO, 'scripts', 'install-release.template.sh'), 'utf8');
  const installSh = template
    .replaceAll('__RELEASE_VERSION__', '0.1.0')
    .replaceAll('__ENVELOPE_SHA256__', 'e'.repeat(64))
    .replaceAll('__PI_SHUTTLE_TGZ_SHA256__', 'p'.repeat(64));
  const path = join(dir, 'install.sh');
  writeFileSync(path, installSh);
  return path;
}

function runInstallSh(installSh: string, args: readonly string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [installSh, ...args], { encoding: 'utf8', input: '', env: { ...process.env, ...env } });
}

const TTY_REFUSAL = 'must pass explicit selections';

test('shell (F-01): piped stdin with no explicit selections refuses instead of EOF-defaulting', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    // The refusal requires no usable controlling terminal; run under a
    // fresh session (setsid) so /dev/tty cannot open, mirroring CI.
    const probe = ['-e', 'require POSIX; POSIX::setsid(); exec @ARGV', 'bash', installSh];
    const result = spawnSync('perl', probe, { encoding: 'utf8', input: '' });
    if (result.error !== undefined && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      // perl unavailable (non-macOS hosts): the node-side F-01 guard is
      // covered by release-bootstrap tests; skip the shell-level probe.
      t.skip();
      return;
    }
    assert.equal(result.status, 2, `expected refusal exit 2, got ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, new RegExp(TTY_REFUSAL));
    assert.equal(result.stderr.includes('downloading release v0.1.0 assets'), false, 'refusal must happen before any download');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell (F-01): explicit batch selections under piped stdin proceed without a terminal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    const result = runInstallSh(installSh, ['--batch', '--gateway', 'yes', '--pi-guard', 'yes']);
    // No TTY refusal; the script proceeds to the download stage, which
    // fails on the network (the release is not published) — that failure
    // is expected and proves the input gate was passed.
    assert.equal(result.stderr.includes(TTY_REFUSAL), false, 'batch selections must not hit the interactive refusal');
    assert.match(result.stdout, /downloading release v0\.1\.0 assets/);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell (F-01): explicit selections without --batch also bypass prompting (both components)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    const result = runInstallSh(installSh, ['--gateway', 'no', '--pi-guard', 'no']);
    assert.equal(result.stderr.includes(TTY_REFUSAL), false);
    assert.match(result.stdout, /downloading release v0\.1\.0 assets/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell (F-01): --help under piped stdin still works (no terminal needed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    const result = runInstallSh(installSh, ['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /usage: curl -fsSL/);
    assert.equal(result.stderr.includes(TTY_REFUSAL), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell (F-01): piped stdin WITH a usable controlling terminal binds prompts to the terminal (proceeds)', async (t) => {
  // Only meaningful when the test process itself has a controlling
  // terminal (i.e. it is run from a real session, not CI): then a piped
  // script must NOT refuse — it binds the installer stdin to /dev/tty.
  let ttyUsable = false;
  try {
    // eslint-disable-next-line no-restricted-syntax
    const { openSync } = await import('node:fs');
    openSync('/dev/tty', 'r+');
    ttyUsable = true;
  } catch {
    ttyUsable = false;
  }
  if (!ttyUsable) {
    t.skip();
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    // stdin is a pipe (no explicit selections), but /dev/tty is usable:
    // the shell must proceed to the download stage, not refuse.
    const result = runInstallSh(installSh, []);
    assert.equal(result.stderr.includes(TTY_REFUSAL), false, 'a usable controlling terminal must not trigger the refusal');
    assert.match(result.stdout, /downloading release v0\.1\.0 assets/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell (F-07): an adversarial QA override that would become a downloader option is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    for (const evil of ['--version', '-K /tmp/curl-config', '-O /tmp/pwned', 'http://evil.example/assets']) {
      const result = runInstallSh(installSh, [], { PI_SHUTTLE_BASE_URL: evil });
      assert.equal(result.status, 2, `override ${evil} must be refused`);
      assert.match(result.stderr, /PI_SHUTTLE_BASE_URL \(QA override\) must be an https:\/\/ URL/);
      assert.equal(result.stderr.includes('downloading release v0.1.0 assets'), false, 'no download may start with an unvalidated override');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shell (F-07): a valid https:// QA override passes validation (still download-stage only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-shell.XXXXXX'));
  try {
    const installSh = buildInstallSh(dir);
    const result = runInstallSh(installSh, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], { PI_SHUTTLE_BASE_URL: 'https://127.0.0.1:1' });
    assert.equal(result.stderr.includes('must be an https:// URL'), false, 'a valid https override must pass validation');
    // Proceeds to the download stage (fails on the unreachable host).
    assert.match(result.stdout, /downloading release v0\.1\.0 assets/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
