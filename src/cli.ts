#!/usr/bin/env node
/**
 * pi-shuttle CLI entry (PS-2). Thin shell: dispatch state-free commands
 * (`--help`, `--version`) BEFORE constructing host/layout state so they
 * work without HOME (SIR-PS2-010); build the host environment only for
 * commands that need it, then run the composition root and apply the
 * outcome. The CLI is installed as `pi-shuttle`; no publication occurs in
 * this gate.
 */
import { run } from './app.js';
import { parseCommand } from './command/parse.js';
import { hostEnvironmentFromProcess } from './host/environment.js';
import type { HostEnvironment } from './host/environment.js';

const argv = process.argv.slice(2);
const parsed = parseCommand(argv);
const needsEnvironment = parsed.ok && parsed.command.kind !== 'help' && parsed.command.kind !== 'version';
let env: HostEnvironment | undefined;
if (needsEnvironment) {
  const host = hostEnvironmentFromProcess();
  if (!host.ok) {
    process.stderr.write(`pi-shuttle: ${host.message}\n`);
    process.exit(2);
  }
  env = host.environment;
}
const outcome = run(argv, { ...(env !== undefined ? { env } : {}) });
if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
process.exitCode = outcome.exitCode;
