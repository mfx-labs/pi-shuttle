/**
 * PS-4 composition root: parse argv, route to the owning handler, and
 * return a deterministic outcome (exit code + bounded stdout/stderr).
 *
 * Operational ownership (post-PS-4):
 *   --help / --version      PS-2 (deterministic, state-free)
 *   doctor                  PS-4 (full local probe suite)
 *   project add/list/remove PS-4 (lifecycle; Gateway bootstrap composition)
 *   start                   PS-4 (Gateway runtime composition; stdio inherited)
 *
 * `run` is async because `start` composes a live child process and
 * resolves only when the Gateway child exits (exit status propagated).
 */
import type { HostEnvironment } from './host/environment.js';
import { parseCommand } from './command/parse.js';
import { helpText, versionText } from './command/help.js';
import { formatDoctorReport, runDoctor } from './command/doctor.js';
import { addProject, listProjects, removeProject } from './lifecycle/projects.js';
import { runStartCommand } from './lifecycle/start.js';
import { resolveLayout } from './host/environment.js';

export interface AppDeps {
  /**
   * Host environment. Required ONLY by commands that observe host/layout
   * state; state-free commands (`--help`, `--version`) work without it
   * (SIR-PS2-010).
   */
  readonly env?: HostEnvironment;
  /**
   * Real CLI path only: forward SIGINT/SIGTERM/SIGHUP to the Gateway child
   * during `start` (direct tests leave this off).
   */
  readonly forwardSignals?: boolean;
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function noHome(): CommandOutcome {
  return { exitCode: 2, stdout: '', stderr: 'pi-shuttle: HOME is not set; pi-shuttle requires an operator home directory\n' };
}

/** Run one CLI invocation. State writes happen only inside the owning handlers. */
export async function run(argv: readonly string[], deps: AppDeps): Promise<CommandOutcome> {
  const parsed = parseCommand(argv);
  if (!parsed.ok) {
    return { exitCode: 2, stdout: '', stderr: `pi-shuttle: ${parsed.message}` };
  }
  switch (parsed.command.kind) {
    case 'help':
      return { exitCode: 0, stdout: helpText(), stderr: '' };
    case 'version':
      return { exitCode: 0, stdout: versionText(deps.env), stderr: '' };
    case 'doctor': {
      if (deps.env === undefined) return noHome();
      const result = await runDoctor({ env: deps.env, layout: resolveLayout(deps.env.home), nodeExecutable: process.execPath, pathEnv: deps.env.pathEnv });
      if (!result.ok) {
        return { exitCode: result.exitCode, stdout: '', stderr: `pi-shuttle: doctor: ${result.message}\n` };
      }
      return { exitCode: result.exitCode, stdout: formatDoctorReport(result.report), stderr: '' };
    }
    case 'project-add': {
      if (deps.env === undefined) return noHome();
      return addProject({ env: deps.env, layout: resolveLayout(deps.env.home), nodeExecutable: process.execPath, pathEnv: deps.env.pathEnv }, parsed.command.path);
    }
    case 'project-list': {
      if (deps.env === undefined) return noHome();
      return listProjects({ env: deps.env, layout: resolveLayout(deps.env.home), nodeExecutable: process.execPath, pathEnv: deps.env.pathEnv });
    }
    case 'project-remove': {
      if (deps.env === undefined) return noHome();
      return removeProject({ env: deps.env, layout: resolveLayout(deps.env.home), nodeExecutable: process.execPath, pathEnv: deps.env.pathEnv }, parsed.command.target);
    }
    case 'start': {
      if (deps.env === undefined) return noHome();
      return runStartCommand({ env: deps.env, layout: resolveLayout(deps.env.home), nodeExecutable: process.execPath, pathEnv: deps.env.pathEnv, forwardSignals: deps.forwardSignals ?? false });
    }
  }
}
