/**
 * PS-3 installer selection: batch-mode argument parsing (closed grammar)
 * and the interactive component prompts (installation-contract §2).
 * Batch mode REQUIRES explicit component selections — no silent defaults
 * (installation-contract §2: "no silent defaults in batch mode for
 * components 1–2"). Interactive defaults are yes/yes per the contract.
 */
import { createInterface } from 'node:readline/promises';
import { isAbsolute } from 'node:path';

export interface InstallerSelections {
  readonly gateway: boolean;
  readonly piGuard: boolean;
}

export interface InstallerOptions {
  readonly help: boolean;
  readonly batch: boolean;
  readonly selections?: InstallerSelections;
  /** Share-dir override (prompt 3 / --install-dir). */
  readonly installDir?: string;
  /** Bin-dir override (prompt 4 / --bin-dir). */
  readonly binDir?: string;
  /** Local artifact directory (the PS-3 local component lane). */
  readonly artifactDir?: string;
  /** Optional strict artifact digest expectations (local lane verification). */
  readonly expectGatewaySha256?: string;
  readonly expectPiGuardSha256?: string;
}

export type InstallerArgResult = { readonly ok: true; readonly options: InstallerOptions } | { readonly ok: false; readonly message: string };

export const INSTALLER_USAGE = [
  'usage: pi-shuttle-installer [options]',
  '',
  'options:',
  '  --help                         show this help',
  '  --batch                        non-interactive; component selections are required',
  '  --gateway <yes|no>             install Project Gateway MCP (required in batch)',
  '  --pi-guard <yes|no>            install pi-guard (required in batch)',
  '  --install-dir <path>           installation directory (default ~/.local/share/pi-shuttle)',
  '  --bin-dir <path>               command/bin directory (default ~/.local/bin)',
  '  --artifact-dir <path>          local component artifact directory (local lane)',
  '  --expect-gateway-sha256 <hex>  strict expected digest for the gateway artifact',
  '  --expect-pi-guard-sha256 <hex> strict expected digest for the pi-guard artifact',
  '',
  'Official release installs use the version-pinned install.sh (curl | bash);',
  'artifact download and digest verification are managed internally there.',
].join('\n') + '\n';

const YES = new Set(['yes', 'y']);
const NO = new Set(['no', 'n']);

/**
 * Absolute-path input contract for installDir/binDir: the receipt schema
 * requires absolute paths, so a relative value can never be accepted —
 * not even interactively — or the installer would write a receipt that
 * its own validation rejects. Tilde is NOT expanded internally;
 * `~/...` is relative and rejected here (the shell expands unquoted
 * `~` before argv is built; a literal `~` must never be trusted).
 */
export function absolutePathProblem(value: string, what: string): string | null {
  if (isAbsolute(value)) return null;
  return `${what} must be an absolute path (got "${value}"); relative paths and ~-prefixed paths are not accepted — pass an absolute path starting with /`;
}

function parseYesNo(value: string): boolean | null {
  const v = value.toLowerCase();
  if (YES.has(v)) return true;
  if (NO.has(v)) return false;
  return null;
}

/** Parse installer argv against the closed grammar. Deterministic. */
export function parseInstallerArgs(argv: readonly string[]): InstallerArgResult {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { ok: true, options: { help: true, batch: false } };
  }
  let batch = false;
  let gateway: boolean | undefined;
  let piGuard: boolean | undefined;
  let installDir: string | undefined;
  let binDir: string | undefined;
  let artifactDir: string | undefined;
  let expectGatewaySha256: string | undefined;
  let expectPiGuardSha256: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const flag = argv[i]!;
    const next = argv[i + 1];
    switch (flag) {
      case '--batch':
        batch = true;
        i += 1;
        break;
      case '--gateway':
      case '--pi-guard': {
        if (next === undefined) return { ok: false, message: `${flag} requires a value\n${INSTALLER_USAGE}` };
        const parsed = parseYesNo(next);
        if (parsed === null) return { ok: false, message: `${flag} must be yes or no\n${INSTALLER_USAGE}` };
        if (flag === '--gateway') gateway = parsed;
        else piGuard = parsed;
        i += 2;
        break;
      }
      case '--install-dir':
      case '--bin-dir': {
        if (next === undefined || next.length === 0) return { ok: false, message: `${flag} requires a value\n${INSTALLER_USAGE}` };
        const pathProblem = absolutePathProblem(next, flag);
        if (pathProblem !== null) return { ok: false, message: `${pathProblem}\n${INSTALLER_USAGE}` };
        if (flag === '--install-dir') installDir = next;
        else binDir = next;
        i += 2;
        break;
      }
      case '--artifact-dir':
      case '--expect-gateway-sha256':
      case '--expect-pi-guard-sha256': {
        if (next === undefined || next.length === 0) return { ok: false, message: `${flag} requires a value\n${INSTALLER_USAGE}` };
        if (flag === '--artifact-dir') artifactDir = next;
        else if (flag === '--expect-gateway-sha256') expectGatewaySha256 = next;
        else expectPiGuardSha256 = next;
        i += 2;
        break;
      }
      default:
        return { ok: false, message: `unknown installer option: ${flag}\n${INSTALLER_USAGE}` };
    }
  }
  if (batch && (gateway === undefined || piGuard === undefined)) {
    return { ok: false, message: 'batch mode requires explicit --gateway and --pi-guard selections\n' + INSTALLER_USAGE };
  }
  if (!batch && (gateway !== undefined || piGuard !== undefined) && (gateway === undefined || piGuard === undefined)) {
    // SIR-PS3-005: an explicit component selection flag must never imply a
    // silent default for the other component. Require BOTH selections.
    const missing = gateway === undefined ? '--gateway' : '--pi-guard';
    return { ok: false, message: `explicit component selections require both --gateway and --pi-guard (missing ${missing}); no silent defaults\n` + INSTALLER_USAGE };
  }
  if (!batch && (gateway !== undefined || piGuard !== undefined)) {
    // Both selections supplied without --batch: deterministic
    // non-prompting path (documented; used by tests) — no silent default
    // is possible because both components were explicit.
    batch = true;
  }
  return {
    ok: true,
    options: {
      help: false,
      batch,
      ...(gateway !== undefined || piGuard !== undefined ? { selections: { gateway: gateway ?? true, piGuard: piGuard ?? true } } : {}),
      ...(installDir !== undefined ? { installDir } : {}),
      ...(binDir !== undefined ? { binDir } : {}),
      ...(artifactDir !== undefined ? { artifactDir } : {}),
      ...(expectGatewaySha256 !== undefined ? { expectGatewaySha256 } : {}),
      ...(expectPiGuardSha256 !== undefined ? { expectPiGuardSha256 } : {}),
    },
  };
}

/** Minimal prompt seam (readline-backed; injectable for tests). */
export interface PromptUI {
  ask(question: string, defaultValue?: string): Promise<string>;
}

function upgradeNotice(installedVersion: string, installerVersion: string): string {
  return [
    'Existing pi-shuttle installation detected:',
    `  Installed: ${installedVersion}`,
    `  Installer: ${installerVersion}`,
    '',
  ].join('\n');
}

/** Ask for explicit interactive consent after the core proves ownership. */
export async function promptUpgrade(installedVersion: string, installerVersion: string): Promise<boolean> {
  process.stdout.write(upgradeNotice(installedVersion, installerVersion));
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  try {
    return await askYesNo({
      ask: async (question, defaultValue) => {
        process.stdout.write(question);
        const next = await lines.next();
        const answer = next.done ? '' : next.value.trim();
        return answer.length > 0 ? answer : (defaultValue ?? '');
      },
    }, `Upgrade ${installedVersion} → ${installerVersion}?`, true);
  } finally {
    rl.close();
  }
}

/** Explicit batch installation is the non-interactive upgrade consent. */
export async function approveBatchUpgrade(installedVersion: string, installerVersion: string): Promise<boolean> {
  process.stdout.write(`${upgradeNotice(installedVersion, installerVersion)}Upgrade accepted by explicit batch invocation.\n`);
  return true;
}

/** Ask before removing narrow blockers and performing a fresh install. */
export async function promptIncompleteCleanup(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  try {
    return await askYesNo({
      ask: async (question, defaultValue) => {
        process.stdout.write(question);
        const next = await lines.next();
        const answer = next.done ? '' : next.value.trim();
        return answer.length > 0 ? answer : (defaultValue ?? '');
      },
    }, 'Clean recognized incomplete installer state and reinstall?', false);
  } finally {
    rl.close();
  }
}

/** Complete batch arguments are explicit non-interactive reinstall consent. */
export async function approveBatchIncompleteCleanup(): Promise<boolean> {
  process.stdout.write('Incomplete cleanup/reinstall accepted by explicit batch invocation.\n');
  return true;
}

/**
 * The interactive prompt session (installation-contract §2, prompts 1–4)
 * backed by stdin/stdout readline. Shared by the local installer entry
 * (main.ts) and the release installer entry (release/bootstrap.ts).
 */
export async function promptInteractive(defaults: { readonly installDir: string; readonly binDir: string }): Promise<InteractiveResult> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ui: PromptUI = {
    ask: async (question: string, defaultValue?: string) => {
      process.stdout.write(question);
      const next = await lines.next();
      const answer = next.done ? '' : next.value.trim();
      return answer.length > 0 ? answer : (defaultValue ?? '');
    },
  };
  try {
    return await promptSelections(ui, defaults);
  } finally {
    rl.close();
  }
}

export interface InteractiveResult {
  readonly selections: InstallerSelections;
  readonly installDir?: string;
  readonly binDir?: string;
}

/** The four installer prompts (installation-contract §2). */
export async function promptSelections(ui: PromptUI, defaults: { readonly installDir: string; readonly binDir: string }): Promise<InteractiveResult> {
  const gateway = await askYesNo(ui, 'Install Project Gateway MCP?', true);
  const piGuard = await askYesNo(ui, 'Install Pi integration / pi-guard?', true);
  const installDir = await askPath(ui, `Installation directory [${defaults.installDir}]: `, defaults.installDir, 'Installation directory');
  const binDir = await askPath(ui, `Command/bin directory [${defaults.binDir}]: `, defaults.binDir, 'Command/bin directory');
  return {
    selections: { gateway, piGuard },
    ...(installDir.trim().length > 0 ? { installDir: installDir.trim() } : {}),
    ...(binDir.trim().length > 0 ? { binDir: binDir.trim() } : {}),
  };
}

/**
 * Prompt for an absolute directory: empty input selects the absolute
 * default; invalid (relative/~-prefixed) input is rejected with guidance
 * and the prompt repeats — an invalid answer never advances to the next
 * prompt.
 */
async function askPath(ui: PromptUI, question: string, defaultValue: string, label: string): Promise<string> {
  for (;;) {
    const answer = (await ui.ask(question, defaultValue)).trim();
    if (answer.length === 0) return defaultValue;
    const problem = absolutePathProblem(answer, label);
    if (problem === null) return answer;
    process.stderr.write(`pi-shuttle-installer: ${problem}\n`);
  }
}

async function askYesNo(ui: PromptUI, question: string, defaultValue: boolean): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  for (;;) {
    const answer = (await ui.ask(`${question} [${hint}]: `, defaultValue ? 'yes' : 'no')).trim().toLowerCase();
    const parsed = parseYesNo(answer);
    if (parsed !== null) return parsed;
    if (answer.length === 0) return defaultValue;
    process.stderr.write(`pi-shuttle-installer: please answer yes or no\n`);
  }
}
