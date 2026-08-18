import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { REPO } from '../helpers/installer-fixtures.js';
import { LINUX_HOST_LANE } from '../../src/compat/manifest.js';
import { promptSelections } from '../../src/installer/selection.js';
import { acquireLatestArtifacts, latestArtifactPlan } from '../../src/installer/release/latest.js';

const SHA = 'a'.repeat(40);
const MOVING_SHA = 'b'.repeat(40);

function sourceArchive(dir: string, sha = SHA, sentinelPath?: string): string {
  const root = `pi-shuttle-${sha}`;
  const source = join(dir, root);
  mkdirSync(source, { recursive: true, mode: 0o700 });
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'pi-shuttle', version: '0.1.1' }));
  writeFileSync(join(source, 'install.sh'), sentinelPath === undefined ? `#!/usr/bin/env bash
printf 'snapshot shell executed\\n' > "$SNAPSHOT_SHELL_SENTINEL"
exit 91
` : `#!/usr/bin/env bash
printf 'moving-master-content-executed\\n' > "$MOVING_SENTINEL"
exit 91
`);
  chmodSync(join(source, 'install.sh'), 0o700);
  const archive = join(dir, 'source.tgz');
  const result = spawnSync('tar', ['-czf', archive, '-C', dir, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return archive;
}

function escapedArchive(dir: string, kind: 'root' | 'install' | 'dist' | 'final'): { archive: string; sentinel: string } {
  const root = `pi-shuttle-${SHA}`;
  const tree = join(dir, `archive-${kind}`);
  const sentinel = join(dir, `${kind}-escape-sentinel`);
  mkdirSync(tree, { recursive: true, mode: 0o700 });
  writeFileSync(sentinel, '#!/usr/bin/env bash\nprintf escaped > "$ESCAPED_SENTINEL"\n', { mode: 0o700 });
  if (kind === 'root') {
    symlinkSync(sentinel, join(tree, root));
  } else {
    const source = join(tree, root);
    mkdirSync(source, { recursive: true, mode: 0o700 });
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'pi-shuttle', version: '0.1.1' }));
    if (kind === 'install') symlinkSync(sentinel, join(source, 'install.sh'));
    else writeFileSync(join(source, 'install.sh'), '#!/usr/bin/env bash\nprintf shell-escape > "$ESCAPED_SENTINEL"\n');
    if (kind === 'dist') symlinkSync(sentinel, join(source, 'dist'));
    if (kind === 'final') {
      mkdirSync(join(source, 'dist', 'installer'), { recursive: true, mode: 0o700 });
      symlinkSync(sentinel, join(source, 'dist', 'installer', 'main.js'));
    }
  }
  const archive = join(dir, `${kind}-source.tgz`);
  const result = spawnSync('tar', ['-czf', archive, '-C', tree, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { archive, sentinel };
}

function fakeTools(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { mode: 0o700 });
  writeFileSync(join(dir, 'built-installer-fixture.js'), `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
function recordExecution() {
  const entryPath = fs.realpathSync(process.argv[1]);
  const workPath = fs.realpathSync(path.dirname(process.env.PI_SHUTTLE_LATEST_PACKAGE_TGZ));
  const snapshotRoot = fs.realpathSync(path.resolve(path.dirname(entryPath), '../..'));
  fs.writeFileSync(process.env.FAKE_EXECUTED_PATH_LOG, JSON.stringify({ entryPath, snapshotRoot, workPath }) + '\\n');
  fs.writeFileSync(process.env.FAKE_ARG_LOG, args.join('\\n') + '\\n');
  fs.writeFileSync(process.env.FAKE_SOURCE_LOG, process.env.PI_SHUTTLE_LATEST_SOURCE + '\\n' + process.env.PI_SHUTTLE_LATEST_PACKAGE_TGZ + '\\n');
}
if (!process.env.FAKE_STDIN_LOG) {
  recordExecution();
  process.exit(Number(process.env.FAKE_INSTALL_STATUS || '0'));
}
if (args.includes('--batch')) {
  const stdin = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(process.env.FAKE_STDIN_LOG, JSON.stringify({ mode: 'batch', stdin, args }) + '\\n');
  if (process.env.FAKE_MUTATION_LOG) fs.writeFileSync(process.env.FAKE_MUTATION_LOG, 'batch completed\\n');
  recordExecution();
  process.exit(0);
}
if (!process.stdin.isTTY) {
  const stdin = fs.readFileSync(0, 'utf8');
  fs.writeFileSync(process.env.FAKE_STDIN_LOG, JSON.stringify({ mode: 'refused', stdin, args }) + '\\n');
  process.stderr.write('pi-shuttle-installer: interactive Latest installation requires a controlling terminal\\n');
  process.exit(2);
}
const prompts = ['Gateway? ', 'pi-guard? ', 'Install dir? ', 'Bin dir? ', 'Upgrade? '];
const answers = [];
const rl = require('node:readline').createInterface({ input: process.stdin, terminal: false });
process.stdout.write(prompts[0]);
rl.on('line', (line) => {
  answers.push(line.trim());
  if (answers.length < prompts.length) {
    process.stdout.write(prompts[answers.length]);
    return;
  }
  fs.writeFileSync(process.env.FAKE_STDIN_LOG, JSON.stringify({
    mode: 'interactive', answers,
    selections: { gateway: answers[0] === 'yes', piGuard: answers[1] === 'yes' },
    installDir: answers[2], binDir: answers[3],
    upgradeConsent: answers[4] === 'yes',
  }) + '\\n');
  if (process.env.FAKE_MUTATION_LOG) fs.writeFileSync(process.env.FAKE_MUTATION_LOG, 'interactive completed\\n');
  recordExecution();
  rl.close();
  process.exit(0);
});
`);
  writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash
if [ "$1" = '-p' ]; then printf 'linux:x64\\n'; exit 0; fi
if [ "$1" = '-e' ]; then
  case "$2" in
    *v.sha*) printf '%s\\n' "\${FAKE_SHA:-${SHA}}" ;;
    *p.version*) printf '0.1.1\\n' ;;
    *) printf '\\n' ;;
  esac
  exit 0
fi
if [ "$#" -gt 0 ]; then exec "$@"; fi
exit 0
`);
  writeFileSync(join(bin, 'npm'), `#!/usr/bin/env bash
printf 'npm %s\\n' "$*" >> "$FAKE_NPM_LOG"
if [ "$1" = 'run' ] && [ "$2" = 'build' ] && [ "\${FAKE_BUILD_FAIL:-0}" = '1' ]; then exit 19; fi
if [ "$1" = 'ci' ] && [ -n "\${FAKE_READY_FILE:-}" ]; then
  : > "$FAKE_READY_FILE"
  while [ ! -f "\${FAKE_RELEASE_FILE:-}" ]; do sleep 0.05; done
fi
if [ "$1" = 'run' ] && [ "$2" = 'build' ]; then
  mkdir -p dist/installer
  if [ "\${FAKE_BUILD_SYMLINK:-0}" = '1' ]; then
    ln -sfn "$FAKE_ESCAPE_TARGET" dist/installer/main.js
  else
    cp "$FAKE_BUILT_INSTALLER" dist/installer/main.js
    chmod 700 dist/installer/main.js
  fi
fi
if [ "$1" = 'pack' ]; then
  destination='.'
  while [ "$#" -gt 0 ]; do
    if [ "$1" = '--pack-destination' ]; then destination="$2"; shift 2; else shift; fi
  done
  touch "$destination/pi-shuttle-0.1.1.tgz"
fi
`);
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
url=''
out=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --url) url="$2"; shift 2 ;;
    -o) out="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '%s\\n' "$url" >> "$FAKE_FETCH_LOG"
case "$url" in
  *api.github.com/repos/mfx-labs/pi-shuttle/commits/master) printf '{"sha":"%s"}\\n' "\${FAKE_SHA:-${SHA}}" > "$out" ;;
  *codeload.github.com/mfx-labs/pi-shuttle/tar.gz/${MOVING_SHA}) cp "$FAKE_SOURCE_ARCHIVE_B" "$out" ;;
  *codeload.github.com/mfx-labs/pi-shuttle/tar.gz/*) cp "$FAKE_SOURCE_ARCHIVE" "$out" ;;
  *) : > "$out" ;;
esac
`);
  for (const name of ['node', 'npm', 'curl']) chmodSync(join(bin, name), 0o700);
  return bin;
}

function latestFixture(dir: string, extra: Record<string, string> = {}) {
  const entry = join(dir, 'install.sh');
  writeFileSync(entry, readFileSync(join(REPO, 'install.sh')));
  const archive = sourceArchive(dir);
  const bin = fakeTools(dir);
  const temp = join(dir, 'tmp');
  mkdirSync(temp, { mode: 0o700 });
  return {
    entry,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      TMPDIR: temp,
      FAKE_SOURCE_ARCHIVE: archive,
      FAKE_FETCH_LOG: join(dir, 'fetch.log'),
      FAKE_NPM_LOG: join(dir, 'npm.log'),
      FAKE_ARG_LOG: join(dir, 'args.log'),
      FAKE_SOURCE_LOG: join(dir, 'source.log'),
      FAKE_EXECUTED_PATH_LOG: join(dir, 'executed-path.log'),
      FAKE_BUILT_INSTALLER: join(dir, 'built-installer-fixture.js'),
      SNAPSHOT_SHELL_SENTINEL: join(dir, 'snapshot-shell.log'),
      NODE_BIN: process.execPath,
      ...extra,
    } satisfies NodeJS.ProcessEnv,
  };
}

function runLatest(dir: string, args: readonly string[], extra: Record<string, string> = {}, piped = false) {
  const fixture = latestFixture(dir, extra);
  return spawnSync('bash', piped ? ['-s', '--', ...args] : [fixture.entry, ...args], {
    encoding: 'utf8',
    env: fixture.env,
    cwd: dir,
    ...(piped ? { input: readFileSync(join(REPO, 'install.sh')) } : {}),
  });
}

function clean(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

test('latest bootstrap resolves master once, downloads the exact SHA, forwards argv, propagates status, and cleans temp state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-test-'));
  try {
    const result = runLatest(dir, ['--batch', '--gateway', 'no', '--pi-guard', 'no', '--install-dir', '/tmp/example'], { FAKE_INSTALL_STATUS: '37' });
    assert.equal(result.status, 37, result.stderr);
    const fetches = readFileSync(join(dir, 'fetch.log'), 'utf8').trim().split('\n');
    assert.equal(fetches.filter((url) => url.includes('/commits/master')).length, 1);
    assert.equal(fetches.filter((url) => url.includes(`/tar.gz/${SHA}`)).length, 1);
    assert.equal(fetches.some((url) => url.includes('/tar.gz/master')), false);
    assert.deepEqual(readFileSync(join(dir, 'args.log'), 'utf8').trim().split('\n'), ['--batch', '--gateway', 'no', '--pi-guard', 'no', '--install-dir', '/tmp/example']);
    assert.equal(readFileSync(join(dir, 'source.log'), 'utf8').split('\n')[0], `mfx-labs/pi-shuttle@${SHA}`);
    assert.match(readFileSync(join(dir, 'npm.log'), 'utf8'), /npm run build/);
    assert.equal(existsSync(join(dir, 'snapshot-shell.log')), false, 'snapshot install.sh must not execute');
    assert.equal(readdirSync(join(dir, 'tmp')).some((name) => name.startsWith('pi-shuttle-latest.')), false);
  } finally {
    clean(dir);
  }
});

test('latest bootstrap refuses an invalid resolved SHA before source download or build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-test-'));
  try {
    const result = runLatest(dir, [], { FAKE_SHA: 'not-a-full-sha' });
    assert.equal(result.status, 2);
    const fetches = readFileSync(join(dir, 'fetch.log'), 'utf8');
    assert.match(fetches, /commits\/master/);
    assert.doesNotMatch(fetches, /codeload/);
    assert.equal(existsSync(join(dir, 'npm.log')), false);
    assert.equal(readdirSync(join(dir, 'tmp')).some((name) => name.startsWith('pi-shuttle-latest.')), false);
  } finally {
    clean(dir);
  }
});

test('latest bootstrap preserves a real build failure status while cleaning temporary state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-build-fail-'));
  try {
    const result = runLatest(dir, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], { FAKE_BUILD_FAIL: '1' });
    assert.equal(result.status, 19, result.stderr);
    assert.equal(readdirSync(join(dir, 'tmp')).some((name) => name.startsWith('pi-shuttle-latest.')), false);
  } finally {
    clean(dir);
  }
});

test('latest bootstrap downloads no component artifacts for explicit no/no selections', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-test-'));
  try {
    const result = runLatest(dir, ['--batch', '--gateway', 'no', '--pi-guard', 'no']);
    assert.equal(result.status, 0, result.stderr);
    const fetches = readFileSync(join(dir, 'fetch.log'), 'utf8');
    assert.doesNotMatch(fetches, /releases\/download/);
  } finally {
    clean(dir);
  }
});

test('latest bootstrap verifies a selected artifact before invoking the installer core', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-test-'));
  try {
    const stage = join(dir, 'artifacts');
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return { status: 200, body: Readable.from([Buffer.from('wrong artifact')]), contentLength: 'wrong artifact'.length };
    };
    const outcome = await acquireLatestArtifacts(LINUX_HOST_LANE, { gateway: false, piGuard: true }, stage, fetcher);
    assert.equal(outcome.ok, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /pi-guard-0\.1\.2\.tgz$/);
    assert.equal(existsSync(join(stage, 'pi-guard-0.1.2.tgz')), false);
  } finally {
    clean(dir);
  }
});

test('latest bootstrap child proves the exact canonical built-snapshot installer path in piped mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-test-'));
  try {
    mkdirSync(join(dir, 'dist', 'installer'), { recursive: true, mode: 0o700 });
    const sentinel = join(dir, 'sentinel.log');
    const main = join(dir, 'dist', 'installer', 'main.js');
    writeFileSync(main, `#!/usr/bin/env bash\nprintf 'sentinel executed\\n' > "$SENTINEL_LOG"\nexit 91\n`, { mode: 0o700 });
    chmodSync(main, 0o700);
    const result = runLatest(dir, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], { SENTINEL_LOG: sentinel }, true);
    assert.equal(result.status, 0, result.stderr);
    const executed = JSON.parse(readFileSync(join(dir, 'executed-path.log'), 'utf8')) as { entryPath: string; snapshotRoot: string; workPath: string };
    const expectedRoot = join(executed.workPath, 'source', `pi-shuttle-${SHA}`);
    assert.equal(executed.snapshotRoot, expectedRoot, 'executed child must resolve to the exact-SHA snapshot root');
    assert.equal(executed.entryPath, join(expectedRoot, 'dist', 'installer', 'main.js'), 'child-observed entry must be the snapshot dist/installer/main.js');
    const insideWork = relative(executed.workPath, executed.entryPath);
    assert.equal(insideWork !== '' && !insideWork.startsWith(`..${sep}`) && insideWork !== '..' && !isAbsolute(insideWork), true, 'executed child path must remain inside bootstrap WORK');
    assert.equal(existsSync(sentinel), false, 'caller-CWD sentinel must never execute');
    assert.equal(existsSync(join(dir, 'snapshot-shell.log')), false, 'archived snapshot install.sh must never execute');
    assert.match(result.stderr, /pi-shuttle latest installer/);
    assert.doesNotMatch(result.stderr, /unbound variable/);
  } finally {
    clean(dir);
  }
});

test('latest public pipe binds interactive answers and upgrade consent only to the controlling terminal', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-tty-'));
  try {
    const stdinLog = join(dir, 'stdin.log');
    const mutationLog = join(dir, 'mutation.log');
    const fixture = latestFixture(dir, { FAKE_STDIN_LOG: stdinLog, FAKE_MUTATION_LOG: mutationLog });
    const command = `cat "${fixture.entry}" | bash -s --`;
    const answers = ['no', 'yes', join(dir, 'install'), join(dir, 'bin'), 'yes'];
    const child = spawn('script', ['-q', '/dev/null', 'bash', '-c', command], {
      cwd: dir,
      env: fixture.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.stdin.write(`${answers.join('\n')}\n`);
    const result = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, error: new Error('PTY process timed out') }); }, 30_000);
      child.once('error', (error) => { clearTimeout(timeout); resolve({ code: null, error }); });
      child.once('close', (code) => { clearTimeout(timeout); resolve({ code }); });
    });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { t.skip('script(1) is unavailable'); return; }
    assert.equal(result.error, undefined, result.error?.message ?? 'PTY process failed');
    assert.equal(result.code, 0, stdout + stderr);
    const observed = JSON.parse(readFileSync(stdinLog, 'utf8')) as Record<string, unknown>;
    assert.equal(observed.mode, 'interactive');
    assert.deepEqual(observed.answers, answers);
    assert.deepEqual(observed.selections, { gateway: false, piGuard: true });
    assert.equal(observed.upgradeConsent, true);
    assert.equal(Object.hasOwn(observed, 'configureProject'), false);
    assert.equal((observed.answers as string[]).some((answer) => /status=\$\?|set -e|exit "\$status"/.test(answer)), false);
    assert.equal(readFileSync(mutationLog, 'utf8'), 'interactive completed\n');
  } finally {
    clean(dir);
  }
});

test('latest public pipe without a controlling terminal exposes EOF, never shell source, and refuses before mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-no-tty-'));
  try {
    const stdinLog = join(dir, 'stdin.log');
    const mutationLog = join(dir, 'mutation.log');
    const fixture = latestFixture(dir, { FAKE_STDIN_LOG: stdinLog, FAKE_MUTATION_LOG: mutationLog });
    const result = spawnSync('perl', ['-MPOSIX', '-e', 'POSIX::setsid(); exec @ARGV', 'bash', '-s', '--'], {
      cwd: dir,
      env: fixture.env,
      encoding: 'utf8',
      input: readFileSync(fixture.entry),
      timeout: 30_000,
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /interactive Latest installation requires a controlling terminal/);
    assert.deepEqual(JSON.parse(readFileSync(stdinLog, 'utf8')), { mode: 'refused', stdin: '', args: [] });
    assert.equal(existsSync(mutationLog), false);
  } finally {
    clean(dir);
  }
});

test('actual Latest Node entry refuses non-TTY script bytes before creating installer state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-node-no-tty-'));
  try {
    const packageTgz = join(dir, 'pi-shuttle.tgz');
    const artifactDir = join(dir, 'artifacts');
    writeFileSync(packageTgz, 'fixture');
    const result = spawnSync(process.execPath, [join(REPO, 'dist', 'installer', 'main.js')], {
      encoding: 'utf8',
      input: readFileSync(join(REPO, 'install.sh')),
      env: {
        ...process.env,
        HOME: dir,
        PI_SHUTTLE_LATEST_SOURCE: `mfx-labs/pi-shuttle@${SHA}`,
        PI_SHUTTLE_LATEST_PACKAGE_TGZ: packageTgz,
        PI_SHUTTLE_LATEST_ARTIFACT_DIR: artifactDir,
      },
    });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /interactive Latest installation requires a controlling terminal/);
    assert.equal(existsSync(join(dir, '.local')), false, 'refusal must precede installer mutation');
  } finally {
    clean(dir);
  }
});

test('latest public pipe accepts the existing complete batch contract without a terminal or prompt input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-batch-'));
  try {
    const stdinLog = join(dir, 'stdin.log');
    const mutationLog = join(dir, 'mutation.log');
    const fixture = latestFixture(dir, { FAKE_STDIN_LOG: stdinLog, FAKE_MUTATION_LOG: mutationLog });
    const args = ['--batch', '--gateway', 'no', '--pi-guard', 'yes'];
    const result = spawnSync('perl', ['-MPOSIX', '-e', 'POSIX::setsid(); exec @ARGV', 'bash', '-s', '--', ...args], {
      cwd: dir,
      env: fixture.env,
      encoding: 'utf8',
      input: readFileSync(fixture.entry),
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(stdinLog, 'utf8')), { mode: 'batch', stdin: '', args });
    assert.equal(readFileSync(mutationLog, 'utf8'), 'batch completed\n');
  } finally {
    clean(dir);
  }
});

test('repository-local install.sh preserves its normal inherited stdin behavior', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-local-stdin-'));
  try {
    const entry = join(dir, 'install.sh');
    const stdinLog = join(dir, 'local-stdin.log');
    mkdirSync(join(dir, 'dist', 'installer'), { recursive: true, mode: 0o700 });
    writeFileSync(entry, readFileSync(join(REPO, 'install.sh')));
    writeFileSync(join(dir, 'dist', 'installer', 'main.js'), `const fs = require('node:fs'); fs.writeFileSync(process.env.LOCAL_STDIN_LOG, fs.readFileSync(0, 'utf8'));\n`);
    const result = spawnSync('bash', [entry], {
      cwd: dir,
      env: { ...process.env, NODE_BIN: process.execPath, LOCAL_STDIN_LOG: stdinLog },
      encoding: 'utf8',
      input: 'local operator input\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(stdinLog, 'utf8'), 'local operator input\n');
  } finally {
    clean(dir);
  }
});

test('latest bootstrap remains confined to the resolved SHA when the moving ref changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-test-'));
  try {
    const movingSentinel = join(dir, 'moving-sentinel.log');
    const movingArchive = sourceArchive(dir, MOVING_SHA, movingSentinel);
    const result = runLatest(dir, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], {
      FAKE_SOURCE_ARCHIVE_B: movingArchive,
      MOVING_SENTINEL: movingSentinel,
    });
    assert.equal(result.status, 0, result.stderr);
    const fetches = readFileSync(join(dir, 'fetch.log'), 'utf8').trim().split('\n');
    assert.equal(fetches.filter((url) => url.includes('/commits/master')).length, 1);
    assert.equal(fetches.filter((url) => url.includes(`/tar.gz/${SHA}`)).length, 1);
    assert.equal(fetches.some((url) => url.includes(`/tar.gz/${MOVING_SHA}`) || url.includes('/tar.gz/master')), false);
    assert.equal(existsSync(movingSentinel), false, 'moving-ref content must never execute');
  } finally {
    clean(dir);
  }
});

test('latest bootstrap refuses archive path escapes before execution and cleans bootstrap state', () => {
  for (const kind of ['root', 'install', 'dist', 'final'] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-escape-'));
    try {
      const escaped = escapedArchive(dir, kind);
      const result = runLatest(dir, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], {
        FAKE_SOURCE_ARCHIVE: escaped.archive,
        ESCAPED_SENTINEL: join(dir, 'executed.log'),
        FAKE_ESCAPE_TARGET: escaped.sentinel,
      });
      assert.equal(result.status, 2, `${kind}: ${result.stderr}`);
      assert.equal(existsSync(join(dir, 'executed.log')), false, `${kind}: escaped sentinel executed`);
      assert.equal(readdirSync(join(dir, 'tmp')).some((name) => name.startsWith('pi-shuttle-latest.')), false, `${kind}: bootstrap state remained`);
    } finally {
      clean(dir);
    }
  }
});

test('latest bootstrap refuses a built installer symlink escaping WORK before execution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-built-escape-'));
  try {
    const archive = sourceArchive(dir);
    const sentinel = join(dir, 'built-escape-sentinel');
    writeFileSync(sentinel, '#!/usr/bin/env bash\nprintf executed > "$ESCAPED_SENTINEL"\n', { mode: 0o700 });
    const result = runLatest(dir, ['--batch', '--gateway', 'no', '--pi-guard', 'no'], {
      FAKE_BUILD_SYMLINK: '1',
      FAKE_ESCAPE_TARGET: sentinel,
      ESCAPED_SENTINEL: join(dir, 'executed.log'),
      FAKE_SOURCE_ARCHIVE: archive,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(join(dir, 'executed.log')), false, 'escaped built installer executed');
    assert.equal(readdirSync(join(dir, 'tmp')).some((name) => name.startsWith('pi-shuttle-latest.')), false);
  } finally {
    clean(dir);
  }
});

test('latest bootstrap cleans source/build/artifact state on SIGTERM and exits with signal status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-signal-'));
  const entry = join(dir, 'install.sh');
  try {
    writeFileSync(entry, readFileSync(join(REPO, 'install.sh')));
    const archive = sourceArchive(dir);
    const bin = fakeTools(dir);
    const temp = join(dir, 'tmp');
    const ready = join(dir, 'ready');
    const release = join(dir, 'release');
    mkdirSync(temp, { mode: 0o700 });
    const child = spawn('bash', [entry, '--batch', '--gateway', 'no', '--pi-guard', 'no'], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        NODE_BIN: process.execPath,
        TMPDIR: temp,
        FAKE_SOURCE_ARCHIVE: archive,
        FAKE_FETCH_LOG: join(dir, 'fetch.log'),
        FAKE_NPM_LOG: join(dir, 'npm.log'),
        FAKE_ARG_LOG: join(dir, 'args.log'),
        FAKE_SOURCE_LOG: join(dir, 'source.log'),
        SNAPSHOT_SHELL_SENTINEL: join(dir, 'snapshot-shell.log'),
        FAKE_READY_FILE: ready,
        FAKE_RELEASE_FILE: release,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    for (let attempt = 0; attempt < 300 && !existsSync(ready); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(existsSync(ready), true, 'bootstrap did not reach its temporary build state');
    const workDirs = readdirSync(temp).filter((name) => name.startsWith('pi-shuttle-latest.'));
    assert.equal(workDirs.length, 1);
    assert.equal(existsSync(join(temp, workDirs[0]!, 'source')), true, 'source snapshot was not present before signal');
    child.kill('SIGTERM');
    writeFileSync(release, 'release child wait');
    const result = await closed;
    assert.equal(result.signal, null);
    assert.equal(result.code, 143, `SIGTERM should propagate as 143, got ${JSON.stringify(result)}`);
    assert.equal(readdirSync(temp).some((name) => name.startsWith('pi-shuttle-latest.')), false, 'signal cleanup left bootstrap state');
  } finally {
    clean(dir);
  }
});

test('latest bootstrap keeps INT and HUP on the same signal-safe cleanup path', () => {
  const script = readFileSync(join(REPO, 'install.sh'), 'utf8');
  assert.match(script, /trap 'handle_signal INT' INT/);
  assert.match(script, /trap 'handle_signal HUP' HUP/);
  assert.match(script, /cleanup_done=1/);
});

test('latest interactive selections acquire only the selected artifacts', async (t) => {
  for (const [label, gateway, piGuard, expected] of [
    ['no/no', false, false, []],
    ['no/yes', false, true, ['pi-guard-0.1.2.tgz']],
    ['yes/no', true, false, ['project-gateway-artifact-core-0.1.0.tgz']],
  ] as const) {
    await t.test(label, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-interactive-'));
      try {
        const answers = [gateway ? 'yes' : 'no', piGuard ? 'yes' : 'no', dir, join(dir, 'bin')];
        let answer = 0;
        const events: string[] = [];
        const interactive = await promptSelections({ ask: async () => { events.push(`prompt-${answer}`); return answers[answer++]!; } }, { installDir: dir, binDir: join(dir, 'bin') });
        assert.equal(answer, 4, 'Latest interactive selection has four prompts');
        events.push('selection-complete');
        const calls: string[] = [];
        const fetcher = async (url: string) => {
          events.push(`fetch-${url.slice(url.lastIndexOf('/') + 1)}`);
          calls.push(url);
          return { status: 200, body: Readable.from([Buffer.from('not the pinned artifact')]), contentLength: 'not the pinned artifact'.length };
        };
        const stage = join(dir, 'artifacts');
        await acquireLatestArtifacts(LINUX_HOST_LANE, interactive.selections, stage, fetcher);
        const firstFetch = events.findIndex((event) => event.startsWith('fetch-'));
        assert.equal(firstFetch === -1 || events.indexOf('selection-complete') < firstFetch, true, 'selection must complete before the first artifact fetch');
        assert.deepEqual(calls.map((url) => url.slice(url.lastIndexOf('/') + 1)).sort(), [...expected].sort());
        for (const name of expected) assert.equal(existsSync(join(stage, name)), false, 'wrong digest must remove unverified bytes');
      } finally {
        clean(dir);
      }
    });
  }
});

test('latest interactive yes/yes acquires both planned artifacts after the prompt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-shuttle-latest-interactive-'));
  try {
    const answers = ['yes', 'yes', dir, join(dir, 'bin')];
    let answer = 0;
    const events: string[] = [];
    const interactive = await promptSelections({ ask: async () => { events.push(`prompt-${answer}`); return answers[answer++]!; } }, { installDir: dir, binDir: join(dir, 'bin') });
    assert.equal(answer, 4, 'Latest interactive selection has four prompts');
    events.push('selection-complete');
    const plan = latestArtifactPlan(LINUX_HOST_LANE);
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const calls: string[] = [];
    const acquireFile = async (_baseUrl: string, fileName: string, expectedSha256: string, artifactDir: string) => {
      events.push(`fetch-${fileName}`);
      calls.push(`${fileName}:${expectedSha256}`);
      mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
      const path = join(artifactDir, fileName);
      writeFileSync(path, 'verified fixture', { mode: 0o600 });
      return { ok: true as const, path };
    };
    const result = await acquireLatestArtifacts(LINUX_HOST_LANE, interactive.selections, join(dir, 'artifacts'), undefined, acquireFile);
    assert.equal(result.ok, true);
    assert.equal(events.indexOf('selection-complete') < events.findIndex((event) => event.startsWith('fetch-')), true, 'both selected artifacts must fetch after selection resolution');
    assert.deepEqual(calls, [
      `${plan.plan.gateway.fileName}:${plan.plan.gateway.sha256}`,
      `${plan.plan.piGuard.fileName}:${plan.plan.piGuard.sha256}`,
    ]);
    assert.equal(existsSync(join(dir, 'artifacts', plan.plan.gateway.fileName)), true);
    assert.equal(existsSync(join(dir, 'artifacts', plan.plan.piGuard.fileName)), true);
  } finally {
    clean(dir);
  }
});
