/**
 * PS-3 — the ONLY subprocess execution boundary in pi-shuttle production
 * code (static guard enforced). Narrow process runner:
 *   - argv arrays only; never shell strings; no `shell: true`;
 *   - explicit executable resolution through PATH (no shell parsing);
 *   - bounded stdout/stderr capture (64 KiB each, truncated marker);
 *   - deterministic exit handling (code/signal) and bounded timeout;
 *   - no generic `exec` API and no execution of operator-provided command
 *     strings — component paths and versions are argv elements, never code.
 * The installer shell entrypoint (`install.sh`) is the only `shell`
 * exception in the product, and it is a fixed exec shim.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

export const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
export const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  /** Bounded; a truncation marker is appended when the cap was hit. */
  readonly stdout: string;
  /** Bounded; a truncation marker is appended when the cap was hit. */
  readonly stderr: string;
}

export interface RunOptions {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

/** Resolve an executable NAME (no slashes) through PATH. Never uses a shell. */
export function resolveExecutable(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (name.includes('/')) return null;
  const pathVar = env.PATH;
  if (pathVar === undefined || pathVar.length === 0) return null;
  for (const dir of pathVar.split(':')) {
    if (dir.length === 0) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // try the next PATH entry
    }
  }
  return null;
}

interface Sink {
  text: string;
  truncated: boolean;
}

function accumulate(sink: Sink, chunk: Buffer, max: number): void {
  if (sink.truncated) return;
  const room = max - sink.text.length;
  if (room <= 0) {
    sink.truncated = true;
    return;
  }
  const text = chunk.toString('utf8');
  sink.text += text.slice(0, room);
  if (text.length > room) sink.truncated = true;
}

/** Run one executable with an argv array. Deterministic, bounded, never a shell. */
export function runProcess(executable: string, args: readonly string[], options: RunOptions = {}): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const maxOutput = options.maxOutputBytes ?? MAX_PROCESS_OUTPUT_BYTES;
    const stdout: Sink = { text: '', truncated: false };
    const stderr: Sink = { text: '', truncated: false };
    let timedOut = false;
    let settled = false;

    const child = spawn(executable, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
      cwd: options.cwd,
    });
    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => accumulate(stdout, d, maxOutput));
    child.stderr.on('data', (d: Buffer) => accumulate(stderr, d, maxOutput));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stderr.text += `\n(process error: ${err.code ?? err.message})`;
      resolve({ exitCode: null, signal: null, timedOut: false, stdout: finalize(stdout), stderr: finalize(stderr) });
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, signal, timedOut, stdout: finalize(stdout), stderr: finalize(stderr) });
    });
  });
}

function finalize(sink: Sink): string {
  return sink.truncated ? `${sink.text}…(truncated)` : sink.text;
}
