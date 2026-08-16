#!/usr/bin/env node
/**
 * pi-shuttle CLI entry. Thin shell: dispatch state-free commands
 * (`--help`, `--version`) BEFORE constructing host/layout state so they
 * work without HOME (SIR-PS2-010); build the host environment only for
 * commands that need it, then run the composition root and apply the
 * outcome. `start` composes the Gateway runtime with inherited stdio and
 * forwards SIGINT/SIGTERM/SIGHUP to the child, so the CLI resolves only
 * after the Gateway child exits and propagates its status.
 */
import { run } from './app.js';
import { parseCommand } from './command/parse.js';
import { hostEnvironmentFromProcess } from './host/environment.js';
import type { HostEnvironment } from './host/environment.js';

const argv = process.argv.slice(2);
const parsed = parseCommand(argv);
// C2: --help/--version resolve the host lane when the environment is
// available so version text can be lane-selected; they remain usable
// WITHOUT HOME (SIR-PS2-010 — the lane line then makes no lane claim).
const stateFree = parsed.ok && (parsed.command.kind === 'help' || parsed.command.kind === 'version');
const needsEnvironment = parsed.ok && !stateFree;
let env: HostEnvironment | undefined;
let hostFailure = '';
if (needsEnvironment || stateFree) {
  const host = hostEnvironmentFromProcess();
  if (host.ok) {
    env = host.environment;
  } else {
    hostFailure = host.message;
  }
}
if (needsEnvironment && env === undefined) {
  process.stderr.write(`pi-shuttle: ${hostFailure}\n`);
  process.exit(2);
}
const outcome = await run(argv, { ...(env !== undefined ? { env } : {}), forwardSignals: true });
if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
process.exitCode = outcome.exitCode;
