/**
 * PS-6 darwin quarantine handling (platform-support-contract §3.7).
 *
 * The installer must strip the `com.apple.quarantine` attribute from
 * downloaded artifacts AFTER SHA-256 verification and BEFORE
 * extraction/activation — exactly this module's position in the component
 * flow (components call it between `verifyArtifactFile` and
 * `extractArtifact`). Scope is deliberately narrow: no Gatekeeper
 * framework, no code signing, no notarization, no quarantine handling on
 * any other platform.
 *
 * Process discipline: `xattr` is discovered through PATH and executed
 * argv-safe through the shared process boundary (never a shell). The
 * attribute name is a fixed product constant, never operator input.
 *
 * Truthfulness: the ABSENCE of the attribute is a normal
 * `no-quarantine` condition (browser-downloaded artifacts may carry it;
 * locally built/CI artifacts typically do not). Any other xattr failure
 * (missing utility, unreadable file, failed strip) fails closed with the
 * installer's typed error model.
 */
import { resolveExecutable, runProcess } from './process.js';

export const QUARANTINE_ATTRIBUTE = 'com.apple.quarantine';

export type QuarantineStripResult =
  | { readonly ok: true; readonly state: 'stripped' | 'no-quarantine' }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Read-only observation: does the artifact carry the quarantine attribute? */
export function quarantinePresent(xattrListOutput: string): boolean {
  return xattrListOutput.split('\n').some((line) => line.trim() === QUARANTINE_ATTRIBUTE);
}

/**
 * Strip the quarantine attribute from one digest-verified artifact file.
 * `platform` selects the behavior: anything other than `darwin` is a
 * no-op (`no-quarantine`) and xattr is never resolved or invoked.
 * `pathEnv` is the executable-search environment (test seam; defaults to
 * the real process environment).
 */
export async function stripQuarantineAttribute(
  artifactPath: string,
  platform: string,
  pathEnv?: NodeJS.ProcessEnv,
): Promise<QuarantineStripResult> {
  if (platform !== 'darwin') {
    return { ok: true, state: 'no-quarantine' };
  }
  const xattr = resolveExecutable('xattr', pathEnv);
  if (xattr === null) {
    return {
      ok: false,
      code: 'ERR-PS3-QUARANTINE',
      message: 'darwin artifact quarantine handling requires the xattr utility, which was not found on PATH',
    };
  }
  const list = await runProcess(xattr, [artifactPath], { env: pathEnv, timeoutMs: 10_000 });
  if (list.exitCode !== 0 || list.signal !== null || list.timedOut) {
    const reason = list.timedOut ? 'timed out' : list.signal !== null ? `killed by ${list.signal}` : `exit ${list.exitCode ?? 'unknown'}`;
    return { ok: false, code: 'ERR-PS3-QUARANTINE', message: `could not inspect quarantine attributes (${reason}): ${list.stderr.trim().slice(0, 300)}` };
  }
  if (!quarantinePresent(list.stdout)) {
    return { ok: true, state: 'no-quarantine' };
  }
  const strip = await runProcess(xattr, ['-d', QUARANTINE_ATTRIBUTE, artifactPath], { env: pathEnv, timeoutMs: 10_000 });
  if (strip.exitCode !== 0 || strip.signal !== null || strip.timedOut) {
    const reason = strip.timedOut ? 'timed out' : strip.signal !== null ? `killed by ${strip.signal}` : `exit ${strip.exitCode ?? 'unknown'}`;
    return { ok: false, code: 'ERR-PS3-QUARANTINE', message: `quarantine strip failed (${reason}): ${strip.stderr.trim().slice(0, 300)}` };
  }
  return { ok: true, state: 'stripped' };
}
