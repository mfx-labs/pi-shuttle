/**
 * PS-3 installer entry (local lane): `node dist/installer/main.js` via the
 * `install.sh` entrypoint. This is NOT the `pi-shuttle` operational CLI —
 * the closed public grammar (doctor / project / start / --help /
 * --version) is unchanged; the installer is a separate operator surface
 * with its own closed argument grammar.
 *
 * Exit codes (documented, closed): 0 COMPLETE; 1 PARTIAL (truthful
 * opt-out/unverified stack); 2 FAILED / UNSUPPORTED / REFUSED / malformed
 * invocation.
 */
import { createInterface } from 'node:readline/promises';
import { hostEnvironmentFromProcess } from '../host/environment.js';
import { hostLane, resolveLayout } from '../host/environment.js';
import { INSTALLER_USAGE, PROJECT_ONBOARDING_DEFERRED, parseInstallerArgs, promptSelections } from './selection.js';
import type { PromptUI } from './selection.js';
import { runInstall } from './install.js';
import type { InstallOutcome } from './install.js';
import { PI_SHUTTLE_VERSION } from '../compat/manifest.js';

export const INSTALLER_EXIT = { COMPLETE: 0, PARTIAL: 1, FAILED: 2 } as const;

function formatOutcome(outcome: InstallOutcome): string {
  switch (outcome.kind) {
    case 'COMPLETE':
      return 'result: COMPLETE — all selected components installed and verified';
    case 'PARTIAL':
      return `result: PARTIAL INSTALLATION${outcome.omitted.length > 0 ? ` — not installed: ${outcome.omitted.join(', ')}` : ''}${outcome.notes.length > 0 ? `\n  notes: ${outcome.notes.join('\n  notes: ')}` : ''}`;
    case 'FAILED':
      return `result: FAILED at stage "${outcome.stage}" — ${outcome.message}\nrollback: ${outcome.rollback} (prior installation state preserved)`;
    case 'UNSUPPORTED':
      return `result: UNSUPPORTED — ${outcome.reason}`;
    case 'REFUSED':
      return `result: REFUSED — ${outcome.reason}`;
  }
}

function exitCodeFor(outcome: InstallOutcome): number {
  switch (outcome.kind) {
    case 'COMPLETE':
      return INSTALLER_EXIT.COMPLETE;
    case 'PARTIAL':
      return INSTALLER_EXIT.PARTIAL;
    case 'FAILED':
    case 'UNSUPPORTED':
    case 'REFUSED':
      return INSTALLER_EXIT.FAILED;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseInstallerArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`pi-shuttle-installer: ${parsed.message}`);
    return 2;
  }
  if (parsed.options.help) {
    process.stdout.write(INSTALLER_USAGE);
    return 0;
  }

  const env = hostEnvironmentFromProcess();
  if (!env.ok) {
    process.stderr.write(`pi-shuttle-installer: ${env.message}\n`);
    return 2;
  }
  const home = env.environment.home;
  const layout = resolveLayout(home);

  process.stdout.write(`pi-shuttle installer ${PI_SHUTTLE_VERSION} (pre-release, local lane)\n`);

  let selections = parsed.options.selections;
  let installDir = parsed.options.installDir;
  let binDir = parsed.options.binDir;
  let configureProject = false;
  if (selections === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
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
      const interactive = await promptSelections(ui, { installDir: parsed.options.installDir ?? layout.shareDir, binDir: parsed.options.binDir ?? layout.binDir });
      selections = interactive.selections;
      installDir = interactive.installDir;
      binDir = interactive.binDir;
      configureProject = interactive.configureProject;
    } finally {
      rl.close();
    }
  }

  if (configureProject) {
    process.stdout.write(`${PROJECT_ONBOARDING_DEFERRED}\n`);
  }

  const outcome = await runInstall(env.environment, {
    selections,
    ...(installDir !== undefined ? { installDir } : {}),
    ...(binDir !== undefined ? { binDir } : {}),
    ...(parsed.options.artifactDir !== undefined ? { artifactDir: parsed.options.artifactDir } : {}),
    ...(parsed.options.expectGatewaySha256 !== undefined ? { expectGatewaySha256: parsed.options.expectGatewaySha256 } : {}),
    ...(parsed.options.expectPiGuardSha256 !== undefined ? { expectPiGuardSha256: parsed.options.expectPiGuardSha256 } : {}),
  });

  process.stdout.write(`${formatOutcome(outcome)}\n`);
  process.stdout.write(`receipt: ${layout.installReceiptPath}\n`);
  if (outcome.kind === 'PARTIAL' || outcome.kind === 'COMPLETE') {
    process.stdout.write(`platform lane: ${hostLane(env.environment.platform, env.environment.arch)}\n`);
  }
  if (outcome.kind === 'FAILED' || outcome.kind === 'UNSUPPORTED' || outcome.kind === 'REFUSED') {
    process.stdout.write('no installation changes were finalized; prior installation state (if any) is preserved\n');
  }
  return exitCodeFor(outcome);
}

// Direct execution entry (install.sh execs this module): run the installer
// only when executed, never when imported by tests.
if (process.argv[1] !== undefined) {
  const { pathToFileURL } = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main(process.argv.slice(2));
  }
}
