/**
 * PS-3 installer process boundary — re-export shim for the PS-4 extracted
 * shared runner (`src/process/runner.ts`). Semantics unchanged (SIR-PS3-012
 * disposition unchanged); the installer imports keep resolving here so the
 * installer surface is byte-identical in behavior.
 */
export { MAX_PROCESS_OUTPUT_BYTES, DEFAULT_PROCESS_TIMEOUT_MS, runProcess, resolveExecutable } from '../process/runner.js';
export type { ProcessResult, RunOptions } from '../process/runner.js';
