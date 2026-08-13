#!/usr/bin/env node
/**
 * PS-5 correction (PS5-LINUX-001) — post-build executable-mode normalizer.
 *
 * Root cause: `tsc` emits build output with the process umask's regular
 * mode (0644), and `npm pack` preserves that mode in the release-shaped
 * artifact; the installed `<binDir>/pi-shuttle` symlink then resolves to
 * a NON-executable target, so direct invocation fails with EACCES (exit
 * 126). The shebang alone cannot save a file that lacks +x.
 *
 * This step is part of the SOURCE-CONTROLLED build behavior
 * (`npm run build`): after TypeScript compilation it verifies the known
 * pi-shuttle CLI entrypoint and normalizes it to the conventional
 * executable mode 0755, so every downstream consumer (npm-pack artifact,
 * extraction, installer bin-link, direct operator invocation) sees a
 * directly executable entrypoint.
 *
 * Discipline:
 *   - operates ONLY on the known CLI entrypoint (default `dist/cli.js`,
 *     or an explicit output directory argument for isolated clean-build
 *     tests) — never chmods arbitrary `dist/**` files;
 *   - fail closed: the entrypoint must exist and be a REGULAR file
 *     (lstat — a symlink/FIFO/device is rejected, never followed);
 *   - preserves the existing shebang (verified, never rewritten) and the
 *     JavaScript bytes (mode-only change);
 *   - deterministic conventional release mode 0755 on the supported
 *     POSIX lane; no runtime dependency, no sudo, no global mutation.
 */
import { chmodSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CLI_RELATIVE = 'cli.js';
const TARGET_MODE = 0o755;

/** Resolve the CLI entrypoint; fail closed on anything but a regular file. */
function resolveCliEntry(outDir) {
  const cliPath = resolve(outDir, CLI_RELATIVE);
  let stat;
  try {
    stat = lstatSync(cliPath);
  } catch (err) {
    throw new Error(`CLI entrypoint missing: ${cliPath} (${err.code ?? 'unknown error'}) — build produced no ${CLI_RELATIVE}`);
  }
  if (!stat.isFile()) {
    throw new Error(`CLI entrypoint is not a regular file: ${cliPath} (mode ${stat.mode.toString(8)}) — refusing to normalize`);
  }
  return cliPath;
}

/** Verify the shebang is present; never rewrite it. */
function verifyShebang(cliPath) {
  const head = readFileSync(cliPath, 'utf8').slice(0, 64);
  if (!head.startsWith('#!')) {
    throw new Error(`CLI entrypoint shebang missing or malformed: ${cliPath} — refusing to normalize a non-executable-script file`);
  }
}

const outDir = process.argv[2] ?? 'dist';
try {
  const cliPath = resolveCliEntry(outDir);
  verifyShebang(cliPath);
  chmodSync(cliPath, TARGET_MODE);
  const after = lstatSync(cliPath);
  if ((after.mode & 0o777) !== TARGET_MODE) {
    throw new Error(`CLI entrypoint mode after normalization is ${(after.mode & 0o777).toString(8)}, expected ${TARGET_MODE.toString(8)}`);
  }
  process.stdout.write(`pi-shuttle build: CLI entrypoint executable mode set (${cliPath} -> 0${TARGET_MODE.toString(8)})\n`);
} catch (err) {
  process.stderr.write(`pi-shuttle build: ${err.message}\n`);
  process.exit(1);
}
