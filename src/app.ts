/**
 * PS-2 composition root: parse argv, route to the owning handler, and
 * return a deterministic outcome (exit code + bounded stdout/stderr).
 *
 * Operational ownership:
 *   --help / --version           PS-2 (fully implemented)
 *   doctor                       PS-2 skeleton (see command/doctor.ts)
 *   project add/list/remove      grammar PS-2; operational behavior PS-4
 *   start                        grammar PS-2; operational behavior PS-4
 *
 * Deferred handlers fail closed with a typed, stable message and exit 1 —
 * the grammar is closed and validated, but the end-user workflow is
 * truthfully reported as not implemented in this gate.
 */
import type { HostEnvironment } from './host/environment.js';
import { parseCommand } from './command/parse.js';
import { helpText, versionText } from './command/help.js';
import { formatDoctorReport, runDoctorSkeleton } from './command/doctor.js';

export interface AppDeps {
  /**
   * Host environment. Required ONLY by commands that observe host/layout
   * state (`doctor`); state-free commands (`--help`, `--version`) work
   * without it (SIR-PS2-010). Deferred PS-4 handlers need no environment.
   */
  readonly env?: HostEnvironment;
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const DEFERRED_NOTE = 'operational behavior is not implemented in PS-2 (owned by PS-4); the command grammar is closed and validated';

function deferred(command: string): CommandOutcome {
  return { exitCode: 1, stdout: '', stderr: `pi-shuttle: ${command}: ${DEFERRED_NOTE}\n` };
}

/** Run one CLI invocation. Pure IO-free dispatch: writes nothing itself. */
export function run(argv: readonly string[], deps: AppDeps): CommandOutcome {
  const parsed = parseCommand(argv);
  if (!parsed.ok) {
    return { exitCode: 2, stdout: '', stderr: `pi-shuttle: ${parsed.message}` };
  }
  switch (parsed.command.kind) {
    case 'help':
      return { exitCode: 0, stdout: helpText(), stderr: '' };
    case 'version':
      return { exitCode: 0, stdout: versionText(), stderr: '' };
    case 'doctor': {
      if (deps.env === undefined) {
        return { exitCode: 2, stdout: '', stderr: 'pi-shuttle: HOME is not set; pi-shuttle requires an operator home directory\n' };
      }
      const result = runDoctorSkeleton(deps.env);
      if (!result.ok) {
        return { exitCode: result.exitCode, stdout: '', stderr: `pi-shuttle: doctor: ${result.message}\n` };
      }
      return { exitCode: result.exitCode, stdout: formatDoctorReport(result.report), stderr: '' };
    }
    case 'project-add':
      return deferred('project add');
    case 'project-list':
      return deferred('project list');
    case 'project-remove':
      return deferred('project remove');
    case 'start':
      return deferred('start');
  }
}
