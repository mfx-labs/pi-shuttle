/**
 * PS-3 test fixtures: npm-pack-style tarballs (with `package/` prefix and
 * the REAL hyphen artifact names — SIR-PS3-004), a fake `pi` executable
 * with truthful-state controls, a minimal hostile-tar builder for
 * adversarial archive tests (SIR-PS3-001/013), and the installer
 * subprocess runner. Fixture tar construction uses system `tar` via
 * spawn (tests may spawn processes; production code never does outside
 * the installer process boundary); hostile archives are built with Node
 * core only (zlib + raw tar blocks).
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';

export const REPO = join(import.meta.dirname, '..', '..', '..');

/** Real npm-pack artifact names (hyphen form; SIR-PS3-004). */
export const GATEWAY_ARTIFACT_NAME = 'project-gateway-artifact-core-0.1.0.tgz';
export const PI_GUARD_ARTIFACT_NAME = 'pi-guard-0.1.2.tgz';

/** Create a fresh isolated environment root (0700). */
export function makeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps3-test-'));
  chmodSync(dir, 0o700);
  return dir;
}

/** Build an npm-pack-style tarball (package/ prefix) from files. */
export function buildTarball(env: string, files: Readonly<Record<string, string>>, tarballName: string): Promise<string> {
  const pkgDir = join(env, 'pkg');
  const packageDir = join(pkgDir, 'package');
  mkdirSync(join(packageDir, 'dist'), { recursive: true, mode: 0o700 });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(packageDir, rel);
    if (rel.includes('/')) {
      mkdirSync(join(packageDir, rel.slice(0, rel.lastIndexOf('/'))), { recursive: true, mode: 0o700 });
    }
    writeFileSync(target, content, { mode: 0o600 });
  }
  const tarball = join(env, tarballName);
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-czf', tarball, '-C', pkgDir, 'package'], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`fixture tar failed: ${code}`));
      else resolve(tarball);
    });
  });
}

export const GATEWAY_FIXTURE_BIN = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--help')) { console.log('project-gateway-mcp fixture help'); process.exit(0); }
if (args.includes('--version')) { console.log('0.1.0 (fixture)'); process.exit(0); }
console.log('fixture gateway (no MCP server in fixtures)');
process.exit(0);
`;

export function gatewayFixtureFiles(overrides: { readonly version?: string; readonly name?: string; readonly bin?: Record<string, string> } = {}): Record<string, string> {
  return {
    'package.json': JSON.stringify({
      name: overrides.name ?? '@project-gateway/artifact-core',
      version: overrides.version ?? '0.1.0',
      type: 'module',
      bin: overrides.bin ?? { 'project-gateway-mcp': './dist/cli.js' },
    }, null, 2),
    'dist/cli.js': GATEWAY_FIXTURE_BIN,
  };
}

export function piGuardFixtureFiles(overrides: { readonly version?: string; readonly name?: string } = {}): Record<string, string> {
  return {
    'package.json': JSON.stringify({
      name: overrides.name ?? 'pi-guard',
      version: overrides.version ?? '0.1.2',
      private: true,
      type: 'module',
      pi: { extensions: ['./extensions/pi-guard/index.ts'] },
    }, null, 2),
    'extensions/pi-guard/index.ts': 'export const fixture = true;\n',
    'src/index.ts': 'export const fixture = true;\n',
  };
}

/**
 * Write a fake `pi` fixture executable that records installs in a state
 * file and mirrors the real `pi list` output shape (source line + indented
 * path line). Controls (all fixture-only, never read by production):
 *   FIXTURE_PI_STATE              state file (recorded install sources)
 *   FIXTURE_PI_VERSION            version string for `--version`
 *   FIXTURE_PI_FAIL_INSTALL=1     `pi install` exits 1
 *   FIXTURE_PI_INSTALL_NO_RECORD=1  `pi install` succeeds but does not
 *                                 register the source (models a silent
 *                                 non-registration for false-positive tests)
 *   FIXTURE_PI_LIST_EXTRA         extra `pi list` entries (false-positive
 *                                 tests, e.g. `pi-guard-extra`)
 *   FIXTURE_PI_CHMOD_DIR_ON_INSTALL=<dir>  chmod 0500 after recording an
 *                                 install (post-Pi failure injection)
 *   FIXTURE_PI_CHMOD_DIR_ON_LIST=<dir>     chmod 0500 on `pi list`
 */
export function writeFakePi(binDir: string): string {
  const script = join(binDir, 'pi');
  writeFileSync(script, `#!/usr/bin/env node
import { appendFileSync, chmodSync, readFileSync } from 'node:fs';
const state = process.env.FIXTURE_PI_STATE ?? '';
const version = process.env.FIXTURE_PI_VERSION || '0.83.0';
const args = process.argv.slice(2);
const cmd = args[0];
if (cmd === '--version') { process.stdout.write(version + '\\n'); process.exit(0); }
if (cmd === 'install') {
  if (process.env.FIXTURE_PI_FAIL_INSTALL === '1') { process.stderr.write('fixture: install failed\\n'); process.exit(1); }
  if (state.length > 0 && process.env.FIXTURE_PI_INSTALL_NO_RECORD !== '1') appendFileSync(state, args[1] + '\\n');
  if (process.env.FIXTURE_PI_CHMOD_DIR_ON_INSTALL) chmodSync(process.env.FIXTURE_PI_CHMOD_DIR_ON_INSTALL, 0o500);
  process.exit(0);
}
if (cmd === 'list') {
  let content = '';
  try { content = readFileSync(state, 'utf8'); } catch { /* empty */ }
  const extra = process.env.FIXTURE_PI_LIST_EXTRA ?? '';
  const lines = content.split('\\n').filter(Boolean);
  const extraLines = extra.split('\\n').filter(Boolean);
  process.stdout.write('User packages:\\n' + [...lines, ...extraLines].map((s) => '  ' + s + '\\n    ' + s).join('\\n') + '\\n');
  if (process.env.FIXTURE_PI_CHMOD_DIR_ON_LIST) chmodSync(process.env.FIXTURE_PI_CHMOD_DIR_ON_LIST, 0o500);
  process.exit(0);
}
process.stderr.write('fixture pi: unknown command\\n');
process.exit(2);
`, { mode: 0o700 });
  chmodSync(script, 0o700);
  return script;
}

// ─── hostile tar builder (Node core; tests only) ─────────────────────────

export interface TarMember {
  readonly name: string;
  readonly type: 'file' | 'dir' | 'symlink' | 'hardlink' | 'fifo' | 'longname' | 'paxpath';
  /** file payload, GNU longname value, or pax `path` value */
  readonly data?: string;
  /** symlink/hardlink target */
  readonly linkname?: string;
}

function writeOctal(block: Buffer, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 2, '0');
  block.write(text, offset, length - 2, 'ascii');
  block[offset + length - 2] = 0;
  block[offset + length - 1] = 0x20;
}

function tarHeader(name: string, size: number, typeflag: string, linkname: string): Buffer {
  const block = Buffer.alloc(512);
  const nameBuf = Buffer.from(name, 'utf8');
  nameBuf.copy(block, 0, 0, Math.min(100, nameBuf.length));
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, 0);
  block.fill(0x20, 148, 156); // checksum placeholder
  block[156] = typeflag.charCodeAt(0);
  const linkBuf = Buffer.from(linkname, 'utf8');
  linkBuf.copy(block, 157, 0, Math.min(100, linkBuf.length));
  block.write('ustar', 257, 5, 'ascii');
  block.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += block[i]!;
  writeOctal(block, 148, 8, sum);
  return block;
}

function pad512(data: Buffer): Buffer {
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return padded;
}

/** Build a raw (uncompressed) tar byte stream from explicit members. */
export function buildTarBuffer(members: readonly TarMember[]): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    if (member.type === 'longname') {
      const data = Buffer.from(member.name, 'utf8');
      blocks.push(tarHeader('longname', data.length, 'L', ''));
      blocks.push(pad512(data));
      continue;
    }
    if (member.type === 'paxpath') {
      const record = `path=${member.data ?? ''}\n`;
      let len = record.length + 2;
      let pax = `${len} ${record}`;
      while (pax.length > len) {
        len = pax.length;
        pax = `${len} ${record}`;
      }
      const data = Buffer.from(pax, 'utf8');
      blocks.push(tarHeader('pax', data.length, 'x', ''));
      blocks.push(pad512(data));
      continue;
    }
    const typeflag = member.type === 'file' ? '0' : member.type === 'dir' ? '5' : member.type === 'symlink' ? '2' : member.type === 'hardlink' ? '1' : '6';
    const data = Buffer.from(member.data ?? '', 'utf8');
    blocks.push(tarHeader(member.name, typeflag === '0' ? data.length : 0, typeflag, member.linkname ?? ''));
    if (typeflag === '0') blocks.push(pad512(data));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(blocks);
}

/** Write a gzip-compressed hostile/valid tarball artifact. */
export function writeArtifact(env: string, fileName: string, members: readonly TarMember[]): string {
  const path = join(env, fileName);
  writeFileSync(path, gzipSync(buildTarBuffer(members)), { mode: 0o600 });
  return path;
}

export interface InstallerRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the compiled installer main with an isolated HOME and controlled PATH. */
export function runInstaller(args: readonly string[], env: { readonly home: string; readonly fixtureBin?: string; readonly path?: string; readonly extraEnv?: NodeJS.ProcessEnv }): Promise<InstallerRun> {
  return new Promise((resolve, reject) => {
    const pathEntries: string[] = env.path !== undefined
      ? [env.path]
      : [env.fixtureBin, join(env.home, '.local', 'bin'), process.env.PATH].filter((p): p is string => p !== undefined && p.length > 0);
    const child = spawn(process.execPath, ['--require', join(REPO, 'tests', 'helpers', 'platform-linux.cjs'), join(REPO, 'dist', 'installer', 'main.js'), ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env.extraEnv,
        HOME: env.home,
        PATH: pathEntries.join(':'),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Standard installer env for a fixture-driven COMPLETE install. */
export function fullInstallEnv(env: string, piVersion = '0.83.0', piState?: string): { readonly home: string; readonly fixtureBin: string; readonly extraEnv: NodeJS.ProcessEnv } {
  const binDir = join(env, 'fixture-bin');
  mkdirSync(binDir, { mode: 0o700 });
  writeFakePi(binDir);
  return {
    home: env,
    fixtureBin: binDir,
    extraEnv: {
      ...(piState !== undefined ? { FIXTURE_PI_STATE: piState } : {}),
      FIXTURE_PI_VERSION: piVersion,
    },
  };
}

export function cleanupEnv(env: string): void {
  rmSync(env, { recursive: true, force: true });
}

export { join };
