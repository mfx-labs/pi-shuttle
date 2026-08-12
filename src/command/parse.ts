/**
 * Closed CLI command grammar (PS-2, operator-cli-contract §1).
 *
 * The v0.1.0 public grammar is complete and CLOSED: unknown commands,
 * unknown options, extra operands, and empty operands fail closed with a
 * deterministic malformed-invocation result. The operational handlers for
 * `doctor` (skeleton), `project add/list/remove`, and `start` are owned as
 * follows: doctor skeleton = PS-2; project lifecycle + start operational
 * behavior = PS-4 (grammar only here). No hidden generic commands
 * (shell/exec/admin/init-store/grant/approve/activate/issue/receipt)
 * exist or can parse.
 */
export type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'doctor' }
  | { readonly kind: 'project-add'; readonly path: string }
  | { readonly kind: 'project-list' }
  | { readonly kind: 'project-remove'; readonly target: string }
  | { readonly kind: 'start' };

export type ParseResult = { readonly ok: true; readonly command: ParsedCommand } | { readonly ok: false; readonly message: string };

export const USAGE = [
  'usage: pi-shuttle <command> [operands]',
  '',
  'commands:',
  '  doctor                            verify installation state',
  '  project add <path>                register a project',
  '  project list                      list registered projects',
  '  project remove <path-or-workspace-id>  deregister a project (store preserved)',
  '  start                             start the Gateway stdio MCP runtime',
  '  --help                            show this help',
  '  --version                         print version and pinned components',
].join('\n') + '\n';

/** Parse argv against the closed grammar. Deterministic; never ambiguous. */
export function parseCommand(argv: readonly string[]): ParseResult {
  if (argv.length === 0) return { ok: false, message: USAGE };
  const head = argv[0];
  if (head === undefined) return { ok: false, message: USAGE };

  // Sole-operand commands: --help, --version, doctor, start.
  if (argv.length === 1) {
    if (head === '--help') return { ok: true, command: { kind: 'help' } };
    if (head === '--version') return { ok: true, command: { kind: 'version' } };
    if (head === 'doctor') return { ok: true, command: { kind: 'doctor' } };
    if (head === 'start') return { ok: true, command: { kind: 'start' } };
    return { ok: false, message: `unknown command: ${head}\n${USAGE}` };
  }

  // Project subcommands (closed: list takes no operand; add/remove take
  // exactly one non-empty, non-option operand).
  if (head === 'project') {
    const sub = argv[1];
    if (sub === 'list') {
      if (argv.length === 2) return { ok: true, command: { kind: 'project-list' } };
      return { ok: false, message: 'project list accepts no operands\n' + USAGE };
    }
    if (sub === 'add' || sub === 'remove') {
      if (argv.length !== 3) {
        const need = sub === 'add' ? 'project add requires exactly one non-empty project path' : 'project remove requires exactly one non-empty path-or-workspace-id';
        return { ok: false, message: need + '\n' + USAGE };
      }
      const operand = argv[2];
      if (operand === undefined || operand.length === 0) {
        const need = sub === 'add' ? 'project add requires exactly one non-empty project path' : 'project remove requires exactly one non-empty path-or-workspace-id';
        return { ok: false, message: need + '\n' + USAGE };
      }
      if (operand.startsWith('-')) {
        return { ok: false, message: `project ${sub} operand must not start with "-"\n${USAGE}` };
      }
      return { ok: true, command: sub === 'add' ? { kind: 'project-add', path: operand } : { kind: 'project-remove', target: operand } };
    }
    return { ok: false, message: `unknown project subcommand: ${sub ?? ''}\n${USAGE}` };
  }

  // Known sole commands with unexpected operands.
  if (head === '--help' || head === '--version' || head === 'doctor' || head === 'start') {
    return { ok: false, message: `unexpected operand for ${head}: ${argv[1] ?? ''}\n${USAGE}` };
  }

  return { ok: false, message: `unknown command: ${head}\n${USAGE}` };
}
