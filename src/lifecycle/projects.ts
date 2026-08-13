/**
 * PS-4 — `pi-shuttle project add | list | remove` (operator-cli-contract
 * §3–§5, gate PS-4 §5–§10).
 *
 * `project add <path>` is the supported HUMAN/OPERATOR-controlled Gateway
 * bootstrap path (product-contract §5, ADR-001): canonicalize → derive
 * deterministic identity → prepare pi-shuttle-owned operator directories →
 * compose the smallest bootstrap input → invoke the installed Gateway
 * operator bootstrap verb (`node <gateway-bin> bootstrap --config <input>
 * --output <resolved>`, argv only, bounded) → validate the resolved
 * runtime configuration through the PS-2 closed model → correlate every
 * resolved fact against this project (surface/locator/workspace/root/git
 * lane) → register transactionally. pi-shuttle NEVER computes the trusted
 * configuration identity, NEVER imports Gateway internals, and NEVER
 * recreates bootstrap authority: the identity comes back from the Gateway
 * verb and is stored as ordinary operator orchestration state.
 *
 * Authority boundary (binding): the only trusted-store bootstrap path is
 * the installed Gateway operator CLI (PS-1). No store deletion, no
 * rollback of Gateway state, no project-content mutation beyond the
 * contract-approved operator directories (locator parent 0700, git
 * isolation dirs, `<root>/artifacts`).
 *
 * Failure/residual semantics (gate §19): Gateway store state and
 * pi-shuttle registry state are two state classes and are NEVER presented
 * as one atomic transaction. If bootstrap succeeds but pi-shuttle
 * registration fails, the store is preserved and the failure message
 * reports the residual truthfully with re-run guidance. `project remove`
 * is DEREGISTER ONLY: the store, the project directory, Git history, and
 * lifecycle records are never touched.
 */
import { existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandOutcome } from '../app.js';
import { CONFIGURATION_VERSION } from '../compat/manifest.js';
import { parseRuntimeDocument, readRuntimeDocument, serializeRuntimeDocument } from '../config/document.js';
import type { RuntimeDocument, SurfaceConfig } from '../config/document.js';
import { canonicalizePath } from '../host/environment.js';
import { checkNodeLane, checkPlatformLane } from '../installer/preflight.js';
import { resolveExecutable, runProcess } from '../process/runner.js';
import { mutateDocumentAtomically, writeFileAtomic } from '../persistence/writer.js';
import { deriveStoreId, deriveStoreLocator, deriveSurfaceId, deriveWorkspaceId } from '../registry/identity.js';
import { deregisterSurface, listSurfaces, registerSurface } from '../registry/model.js';
import { acquireProjectLock, pathExists, releaseProjectLock, resolveGatewayInstallation } from './state.js';
import type { OperatorContext } from './state.js';

// ─── typed failure helpers ───────────────────────────────────────────────

function fail(code: string, detail: string, exitCode: 1 | 2): CommandOutcome {
  return { exitCode, stdout: '', stderr: `pi-shuttle: ${detail} (${code})\n` };
}

function ok(stdout: string): CommandOutcome {
  return { exitCode: 0, stdout, stderr: '' };
}

// ─── bootstrap input composition (pure; SIR-PS2-009 drift surface) ───────

export interface BootstrapComposeInput {
  readonly surfaceId: string;
  readonly locator: string;
  readonly configurationVersion: string;
  readonly canonicalRoot: string;
  readonly workspaceId: string;
  readonly artifactsDir: string;
  readonly gitPath: string;
  readonly gitHome: string;
  readonly gitTmpdir: string;
  readonly forbiddenRoots: readonly string[];
}

/**
 * The smallest bootstrap configuration accepted by the Gateway PS-1
 * bootstrap profile: one surface, no `configurationIdentity` (the Gateway
 * derives it — pi-shuttle never fabricates it), operator overrides only.
 */
export function composeBootstrapConfig(input: BootstrapComposeInput): string {
  const surface = {
    surfaceId: input.surfaceId,
    locator: input.locator,
    forbiddenRoots: [...input.forbiddenRoots],
    configurationVersion: input.configurationVersion,
    limitProfile: {},
    workspaces: [{ workspaceId: input.workspaceId, root: input.canonicalRoot, artifactLocation: input.artifactsDir }],
    gitPath: input.gitPath,
    gitHome: input.gitHome,
    gitTmpdir: input.gitTmpdir,
  };
  return `${JSON.stringify({ surfaces: [surface] }, null, 2)}\n`;
}

// ─── resolved-output correlation (pure; fail closed on ANY mismatch) ─────

export interface BootstrapCorrelation extends BootstrapComposeInput {}

/** Verify the Gateway-resolved surface equals this project's expected facts. */
export function correlateResolvedSurface(surface: SurfaceConfig, expected: BootstrapCorrelation): string | null {
  if (surface.surfaceId !== expected.surfaceId) return `surfaceId mismatch: expected ${expected.surfaceId}, resolved ${surface.surfaceId}`;
  if (surface.locator !== expected.locator) return `locator mismatch: expected ${expected.locator}, resolved ${surface.locator}`;
  if (surface.configurationVersion !== expected.configurationVersion) return `configurationVersion mismatch: expected ${expected.configurationVersion}, resolved ${surface.configurationVersion}`;
  const workspaces = surface.workspaces ?? [];
  if (workspaces.length !== 1) return `resolved surface carries ${workspaces.length} workspace entries; expected exactly 1`;
  const workspace = workspaces[0]!;
  if (workspace.workspaceId !== expected.workspaceId) return `workspaceId mismatch: expected ${expected.workspaceId}, resolved ${workspace.workspaceId}`;
  if (workspace.root !== expected.canonicalRoot) return `workspace root mismatch: expected ${expected.canonicalRoot}, resolved ${workspace.root}`;
  // SIR-PS4-001: artifactLocation is operator-owned input (prepared by
  // pi-shuttle) and must correlate exactly with the path pi-shuttle
  // prepared for this project — never persisted verbatim unverified.
  if (workspace.artifactLocation !== expected.artifactsDir) {
    return `artifactLocation mismatch: expected ${expected.artifactsDir}, resolved ${workspace.artifactLocation ?? '<absent>'}`;
  }
  if (surface.gitPath !== expected.gitPath) return `gitPath mismatch: expected ${expected.gitPath}, resolved ${surface.gitPath ?? '<absent>'}`;
  if (surface.gitHome !== expected.gitHome) return `gitHome mismatch: expected ${expected.gitHome}, resolved ${surface.gitHome ?? '<absent>'}`;
  if (surface.gitTmpdir !== expected.gitTmpdir) return `gitTmpdir mismatch: expected ${expected.gitTmpdir}, resolved ${surface.gitTmpdir ?? '<absent>'}`;
  const expectedRoots = [...expected.forbiddenRoots].sort();
  const resolvedRoots = [...surface.forbiddenRoots].sort();
  if (expectedRoots.length !== resolvedRoots.length || expectedRoots.some((r, i) => r !== resolvedRoots[i])) {
    return `forbiddenRoots mismatch: expected [${expectedRoots.join(', ')}], resolved [${resolvedRoots.join(', ')}]`;
  }
  return null;
}

// ─── operator-owned directory preparation ────────────────────────────────

export interface PreparedDirs {
  readonly locator: string;
  readonly gitHome: string;
  readonly gitTmpdir: string;
  readonly artifactsDir: string;
}

/**
 * Create ONLY the required pi-shuttle/Gateway operator parent directories
 * (gate §5): the trusted store parent locator (Gateway PS-1 requires it to
 * pre-exist as an operator-owned 0700 directory — pi-shuttle owns creating
 * the PARENT, never the Gateway's internal store structure), the per-store
 * Git isolation dirs (empty, 0700, outside workspace roots), and the
 * version-2 `artifactLocation` directory inside the project root (approved
 * contract step; created only when absent, existing content untouched).
 * Fail closed on anything in the way; never chmods pre-existing state.
 */
export function prepareOperatorDirs(layout: { readonly storesDir: string; readonly gitHomeDir: string; readonly gitTmpDir: string }, storeId: string, canonicalRoot: string): { readonly ok: true; readonly dirs: PreparedDirs } | { readonly ok: false; readonly code: string; readonly message: string } {
  const locator = join(layout.storesDir, storeId);
  const gitHome = join(layout.gitHomeDir, storeId);
  const gitTmpdir = join(layout.gitTmpDir, storeId);
  const artifactsDir = join(canonicalRoot, 'artifacts');
  for (const [label, dir] of [['trusted store parent', locator], ['git isolation HOME', gitHome], ['git isolation TMPDIR', gitTmpdir]] as const) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      return { ok: false, code: 'ERR-PS4-STATE-MKDIR', message: `${label} directory could not be created at ${dir} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
    }
    if (!isDirectory(dir)) return { ok: false, code: 'ERR-PS4-STATE-NOT-DIR', message: `${label} path exists but is not a directory: ${dir}` };
  }
  if (existsSync(artifactsDir)) {
    if (!isDirectory(artifactsDir)) {
      return { ok: false, code: 'ERR-PS4-STATE-ARTIFACTS', message: `artifact location exists but is not a directory: ${artifactsDir}` };
    }
  } else {
    try {
      mkdirSync(artifactsDir, { mode: 0o700 });
    } catch (err) {
      return { ok: false, code: 'ERR-PS4-STATE-MKDIR', message: `artifact location could not be created at ${artifactsDir} (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
    }
  }
  return { ok: true, dirs: { locator, gitHome, gitTmpdir, artifactsDir } };
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Best-effort removal of a pi-shuttle-owned disposable probe artifact (never store state). */
function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // absent or unremovable — best effort only
  }
}

// ─── `project add` ───────────────────────────────────────────────────────

export interface AddOutcome extends CommandOutcome {
  readonly ok: boolean;
  readonly code?: string;
  /** Filled on success for tests/inspection. */
  readonly surface?: SurfaceConfig;
}

/** The complete project-add workflow (gate §5–§7). */
export async function addProject(ctx: OperatorContext, inputPath: string): Promise<AddOutcome> {
  // 1. Platform + node preflight (doctor subset; operator-cli-contract §3.2).
  const platform = checkPlatformLane(ctx.env);
  if (!platform.ok) return { ok: false, ...fail('ERR-PS4-PREFLIGHT-PLATFORM', `project add: ${platform.message}`, 2) };
  const node = checkNodeLane();
  if (!node.ok) return { ok: false, ...fail('ERR-PS4-PREFLIGHT-NODE', `project add: ${node.message}`, 1) };

  // 2. Installation receipt gate: a usable, verified Gateway is required.
  const gateway = resolveGatewayInstallation(ctx.layout);
  if (!gateway.ok) return { ok: false, ...fail(gateway.code, `project add: ${gateway.message}`, gateway.exitCode) };

  // 3. Canonicalize the project root (symlink-resolved; fail closed).
  const canonicalRoot = canonicalizePath(inputPath);
  if (canonicalRoot === null) {
    return { ok: false, ...fail('ERR-PS4-ROOT-UNRESOLVABLE', `project add: project path does not resolve: ${inputPath}`, 1) };
  }
  if (!isDirectory(canonicalRoot)) {
    return { ok: false, ...fail('ERR-PS4-ROOT-NOT-DIRECTORY', `project add: project path is not a directory: ${canonicalRoot}`, 1) };
  }

  // 4. Git executable discovery (PATH, never hard-coded) + read-only repo probe.
  const gitPath = resolveExecutable('git', ctx.pathEnv);
  if (gitPath === null) {
    return { ok: false, ...fail('ERR-PS4-PREFLIGHT-GIT', 'project add: git executable not found on PATH; git is required for project composition', 1) };
  }
  const probe = await runProcess(gitPath, ['-C', canonicalRoot, 'rev-parse', '--git-dir'], { env: ctx.pathEnv, timeoutMs: 15_000 });
  if (probe.exitCode !== 0 || probe.signal !== null) {
    return { ok: false, ...fail('ERR-PS4-ROOT-NOT-GIT', `project add: ${canonicalRoot} is not a Git repository (read-only git probe failed)`, 1) };
  }

  // 5. Deterministic identity (PS-2 formula; unchanged — gate §5).
  const storeId = deriveStoreId(canonicalRoot);
  const workspaceId = deriveWorkspaceId(canonicalRoot);
  const surfaceId = deriveSurfaceId(canonicalRoot);
  const locator = deriveStoreLocator(ctx.layout.shareDir, canonicalRoot);

  // 6. Operation-wide lock: everything below spans Gateway bootstrap +
  //    runtime-config regeneration + registry mutation (gate §18).
  const lock = acquireProjectLock(ctx.layout);
  if (!lock.ok) return { ok: false, ...fail('ERR-PS4-BUSY', `project add: ${lock.message}`, 1) };
  try {
    // 7. Operator-owned directories.
    const prepared = prepareOperatorDirs(ctx.layout, storeId, canonicalRoot);
    if (!prepared.ok) return { ok: false, ...fail(prepared.code, `project add: ${prepared.message}`, 1) };
    const dirs = prepared.dirs;

    // 8. Compose + write the bootstrap input (pi-shuttle disposable probe
    //    artifact under the state dir; 0600; the Gateway owns the output).
    const expected: BootstrapCorrelation = {
      surfaceId,
      locator,
      configurationVersion: CONFIGURATION_VERSION,
      canonicalRoot,
      workspaceId,
      artifactsDir: dirs.artifactsDir,
      gitPath,
      gitHome: dirs.gitHome,
      gitTmpdir: dirs.gitTmpdir,
      forbiddenRoots: [canonicalRoot],
    };
    const configText = composeBootstrapConfig(expected);
    const inputFile = join(ctx.layout.stateDir, `ps4-bootstrap-${storeId}.json`);
    const outputFile = join(ctx.layout.stateDir, `ps4-bootstrap-${storeId}.resolved.json`);
    // These files are pi-shuttle-owned probe artifacts (never Gateway store
    // state); remove any prior-run leftovers so the Gateway's atomic
    // no-clobber output publish always sees an absent target.
    unlinkIfPresent(inputFile);
    unlinkIfPresent(outputFile);
    const written = writeFileAtomic(inputFile, configText);
    if (!written.ok) return { ok: false, ...fail(written.code, `project add: ${written.message}`, 1) };

    // 9. Invoke the installed Gateway PS-1 operator bootstrap verb
    //    (argv arrays only; bounded output; never through MCP).
    const storeWasPresent = pathExists(join(locator, 'store-v1'));
    const boot = await runProcess(ctx.nodeExecutable, [gateway.value.binPath, 'bootstrap', '--config', inputFile, '--output', outputFile], { env: ctx.pathEnv, timeoutMs: 60_000 });
    if (boot.exitCode !== 0 || boot.signal !== null) {
      unlinkIfPresent(inputFile);
      const reason = boot.timedOut ? 'timed out' : boot.signal !== null ? `killed by ${boot.signal}` : `exit ${boot.exitCode ?? 'unknown'}`;
      const detail = boot.stderr.trim().slice(0, 400) || boot.stdout.trim().slice(0, 400);
      return { ok: false, ...fail('ERR-PS4-BOOTSTRAP-FAILED', `project add: Gateway bootstrap failed (${reason}): ${detail}`, 1) };
    }

    // 10. Result validation: the resolved runtime config must exist, parse
    //     through the closed PS-2 model, and correlate exactly.
    const resolved = readRuntimeDocument(outputFile);
    if (!resolved.ok) {
      unlinkIfPresent(inputFile);
      const residual = storeWasPresent
        ? `the trusted store at ${locator} was replay-verified and is preserved`
        : `a trusted store may have been initialized at ${locator}; it is preserved and will be replay-verified on re-run`;
      return {
        ok: false,
        ...fail('ERR-PS4-BOOTSTRAP-OUTPUT', `project add: Gateway bootstrap reported success but produced no valid resolved runtime configuration (${resolved.code}: ${resolved.message}); residual: ${residual}; re-run \`pi-shuttle project add ${inputPath}\` to verify and register`, 1),
      };
    }
    if (resolved.document.surfaces.length !== 1) {
      unlinkIfPresent(inputFile);
      return {
        ok: false,
        ...fail('ERR-PS4-BOOTSTRAP-OUTPUT', `project add: Gateway bootstrap resolved ${resolved.document.surfaces.length} surfaces; expected exactly 1; refusing to register`, 1),
      };
    }
    const surface = resolved.document.surfaces[0]!;
    const mismatch = correlateResolvedSurface(surface, expected);
    if (mismatch !== null) {
      unlinkIfPresent(inputFile);
      return {
        ok: false,
        ...fail('ERR-PS4-BOOTSTRAP-MISMATCH', `project add: the Gateway-resolved configuration does not correlate with this project: ${mismatch}; residual: the trusted store at ${locator} is preserved (Gateway state is never deleted); re-run \`pi-shuttle project add ${inputPath}\``, 1),
      };
    }

    // 11. Register transactionally (PS-2 discipline: decode under the
    //     runtime-document lock; stale snapshots cannot report success).
    const registered = mutateDocumentAtomically<RuntimeDocument>(ctx.layout.runtimeConfigPath, {
      decode: (text) => {
        const parsed = parseRuntimeDocument(text);
        return parsed.ok ? parsed.document : null;
      },
      transition: (current) => {
        const result = registerSurface(current ?? { surfaces: [] }, surface);
        return result.ok ? { ok: true as const, next: result.value, changed: result.changed } : { ok: false, code: result.code, message: result.message };
      },
      serialize: serializeRuntimeDocument,
    });
    unlinkIfPresent(inputFile);
    unlinkIfPresent(outputFile);
    if (!registered.ok) {
      return {
        ok: false,
        ...fail('ERR-PS4-REGISTER-FAILED', `project add: registration failed (${registered.code}: ${registered.message}); residual: the trusted store at ${locator} was ${storeWasPresent ? 'replay-verified' : 'initialized'} by the Gateway and is PRESERVED (Gateway store state is never deleted to roll back pi-shuttle metadata); re-run \`pi-shuttle project add ${inputPath}\` to verify and register`, 1),
      };
    }

    // 12. Truthful report (idempotent exact replay = no registry change).
    const state = storeWasPresent ? 'verification-replay' : 'initialized';
    const already = !registered.changed;
    const lines = [
      already ? 'project already registered (exact replay; no registry change)' : 'registered project',
      `  workspace: ${workspaceId}`,
      `  surface:   ${surfaceId}`,
      `  root:      ${canonicalRoot}`,
      `  store:     ${locator}`,
      `  state:     ${state}`,
    ];
    return { ok: true, ...ok(lines.join('\n') + '\n'), surface };
  } finally {
    releaseProjectLock(lock.fd, ctx.layout);
  }
}

// ─── `project list` ──────────────────────────────────────────────────────

/**
 * Deterministic listing from the authoritative runtime document. Read-only;
 * never requires a Gateway subprocess. Empty registry is a successful valid
 * state. Registry membership never implies operational health (that is
 * doctor's job).
 */
export function listProjects(ctx: OperatorContext): CommandOutcome {
  const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
  if (!read.ok) {
    if (read.code === 'absent') return ok('no registered projects\n');
    return fail('ERR-PS4-LIST-INVALID', `project list: runtime configuration is invalid: ${read.message}`, 1);
  }
  if (read.document.surfaces.length === 0) return ok('no registered projects\n');
  const lines = listSurfaces(read.document).map((surface) => {
    const workspace = surface.workspaces?.[0];
    const workspaceId = workspace?.workspaceId ?? '<no workspace>';
    const root = workspace?.root ?? '<no root>';
    return `${workspaceId}  ${root}  surface ${surface.surfaceId}  store ${surface.locator}`;
  });
  return ok(lines.join('\n') + '\n');
}

// ─── `project remove` ────────────────────────────────────────────────────

/**
 * DEREGISTER ONLY (product decision; operator-cli-contract §5): removes
 * the registration from the runtime document transactionally. Never deletes
 * the project directory, `.git`, the Gateway trusted store, audit/history,
 * lifecycle records, artifact data, or pi-guard state. The preserved store
 * remains at its locator and re-add derives the same identity and
 * replay-verifies it. Unknown targets fail closed with the typed registry
 * error.
 */
export function removeProject(ctx: OperatorContext, target: string): CommandOutcome {
  // A path-shaped target is canonicalized first; a workspaceId/surfaceId
  // is matched as the opaque identifier. When the path no longer resolves,
  // the canonical string still matches an exact registered root.
  const canonicalTarget = target.startsWith('/') ? (canonicalizePath(target) ?? target) : target;

  const lock = acquireProjectLock(ctx.layout);
  if (!lock.ok) {
    // No pi-shuttle state at all (lock parent absent) ⇒ nothing is
    // registered: the truthful failure is the typed not-found result.
    if (!pathExists(ctx.layout.runtimeConfigPath)) {
      return fail('ERR-PS2-REG-NOT-FOUND', `project remove: no registered project matches: ${target} (nothing is registered; use \`pi-shuttle project list\`)`, 1);
    }
    return fail('ERR-PS4-BUSY', `project remove: ${lock.message}`, 1);
  }
  try {
    const result = mutateDocumentAtomically<RuntimeDocument>(ctx.layout.runtimeConfigPath, {
      decode: (text) => {
        const parsed = parseRuntimeDocument(text);
        return parsed.ok ? parsed.document : null;
      },
      transition: (current) => {
        if (current === null) {
          return { ok: false, code: 'ERR-PS2-REG-NOT-FOUND', message: `no registered project matches: ${target} (nothing is registered; use \`pi-shuttle project list\`)` };
        }
        const removed = deregisterSurface(current, canonicalTarget);
        return removed.ok ? { ok: true as const, next: removed.value, changed: removed.changed } : { ok: false, code: removed.code, message: removed.message };
      },
      serialize: serializeRuntimeDocument,
    });
    if (!result.ok) {
      return fail(result.code, `project remove: ${result.message}`, 1);
    }
    const previous = result.previous ?? { surfaces: [] };
    const removedSurface = previous.surfaces.find((surface) =>
      surface.surfaceId === canonicalTarget ||
      surface.workspaces?.some((workspace) => workspace.workspaceId === canonicalTarget || workspace.root === canonicalTarget),
    );
    const workspaceId = removedSurface?.workspaces?.[0]?.workspaceId ?? '<unknown>';
    const locator = removedSurface?.locator ?? '<unknown>';
    const lines = [
      `deregistered ${workspaceId}`,
      `  trusted store preserved at ${locator} (immutable historical evidence; never deleted)`,
      '  project directory and Git history untouched',
    ];
    return ok(lines.join('\n') + '\n');
  } finally {
    releaseProjectLock(lock.fd, ctx.layout);
  }
}

// (the bootstrap input is published through the single authoritative atomic
// 0600 writer; the Gateway owns its own resolved-output write discipline).
