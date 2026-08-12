/**
 * PS-2 focused tests: single authoritative persistence — raw atomic
 * publisher guarantees (0600, 0700, complete-write loop, short-write,
 * zero-progress cleanup, idempotent no-op, no partial exposure) and the
 * transactional mutation primitive (SIR-PS2-001/002): lock-covered
 * read→decode→transition→publish→verify, incompatible-state fail-closed,
 * deterministic BUSY contention, and real multi-process serialization
 * (no lost updates).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync, chmodSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { mutateDocumentAtomically, writeFileAtomic } from '../../src/persistence/writer.js';
import { parseRuntimeDocument, serializeRuntimeDocument } from '../../src/config/document.js';
import type { RuntimeDocument, SurfaceConfig } from '../../src/config/document.js';
import { registerSurface } from '../../src/registry/model.js';

function makeEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps2-persist-'));
  chmodSync(dir, 0o700);
  return dir;
}

const IDENTITY = 'sha-256:' + 'a'.repeat(64);

function surface(surfaceId: string): SurfaceConfig {
  return {
    surfaceId,
    locator: `/store/${surfaceId}`,
    serviceUid: 1000,
    forbiddenRoots: [],
    configurationIdentity: IDENTITY,
    configurationVersion: '2',
    limitProfile: {},
  };
}

/** Decode existing text into a RuntimeDocument; null = incompatible. */
function decodeDocument(text: string): RuntimeDocument | null {
  const parsed = parseRuntimeDocument(text);
  return parsed.ok ? parsed.document : null;
}

/** Registry transition over the current (possibly absent) document. */
function addSurfaceTransition(surfaceToAdd: SurfaceConfig) {
  return (current: RuntimeDocument | null): { readonly ok: true; readonly next: RuntimeDocument; readonly changed: boolean } | { readonly ok: false; readonly code: string; readonly message: string } => {
    const base = current ?? { surfaces: [] };
    const result = registerSurface(base, surfaceToAdd);
    return result.ok
      ? { ok: true, next: result.value, changed: result.changed }
      : { ok: false, code: result.code, message: result.message };
  };
}

const TRANSACTION = (path: string, s: SurfaceConfig) => ({
  decode: decodeDocument,
  transition: addSurfaceTransition(s),
  serialize: serializeRuntimeDocument,
});

// ─── raw publisher guarantees (unchanged from PS-2, kept) ────────────────

test('persistence: new file is written atomically with exact 0600 and 0700 parents', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'deep', 'nested', 'runtime.json');
    const result = writeFileAtomic(path, '{"surfaces":[]}\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, true);
    assert.equal(readFileSync(path, 'utf8'), '{"surfaces":[]}\n');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(env, 'deep')).mode & 0o777, 0o700);
    assert.equal(statSync(join(env, 'deep', 'nested')).mode & 0o777, 0o700);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('persistence: identical existing content is an idempotent no-op (no rewrite)', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    assert.equal(writeFileAtomic(path, '{"surfaces":[]}\n').ok, true);
    const mtimeBefore = statSync(path).mtimeMs;
    const result = writeFileAtomic(path, '{"surfaces":[]}\n');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, false, 'identical content must not rewrite');
    assert.equal(statSync(path).mtimeMs, mtimeBefore, 'file must not be touched');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('persistence: raw writer replaces existing content (single-writer raw semantics)', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    writeFileSync(path, 'old', { mode: 0o600 });
    const result = writeFileAtomic(path, 'new');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(readFileSync(path, 'utf8'), 'new');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('persistence: failing write publishes nothing and cleans the temporary', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    let calls = 0;
    const failingWrite: (fd: number, buffer: Buffer, offset: number, length: number) => number = (fd, buffer, offset, length) => {
      calls += 1;
      if (calls >= 2) return 0;
      return writeSync(fd, buffer, offset, Math.min(1, length));
    };
    const result = writeFileAtomic(path, 'complete content', { write: failingWrite });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-PS2-WRITE-FAILED');
    assert.equal(existsSync(path), false, 'final path must never be published on an incomplete write');
    const leftovers = readdirSync(env).filter((e) => e.includes('.tmp-'));
    assert.deepEqual(leftovers, [], 'temporary files must be cleaned up on failure');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('persistence: short writes are looped until the complete buffer is written', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    const shortWrite: (fd: number, buffer: Buffer, offset: number, length: number) => number = (fd, buffer, offset, length) =>
      writeSync(fd, buffer, offset, Math.min(1, length));
    const result = writeFileAtomic(path, '{"surfaces":[]}\n', { write: shortWrite });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(readFileSync(path, 'utf8'), '{"surfaces":[]}\n', 'complete bytes must be published after short writes');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('persistence: unwritable parent fails closed with a typed error', () => {
  const env = makeEnv();
  try {
    const blocker = join(env, 'blocker');
    writeFileSync(blocker, 'file', { mode: 0o600 });
    const result = writeFileAtomic(join(blocker, 'runtime.json'), 'x');
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.code.startsWith('ERR-PS2-WRITE-'), result.code);
    const leftovers = readdirSync(env).filter((e) => e.includes('.tmp-'));
    assert.deepEqual(leftovers, [], 'no temporary leftovers on failure');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('persistence: target that is an existing directory fails closed without clobber', () => {
  const env = makeEnv();
  try {
    const dirTarget = join(env, 'runtime.json');
    mkdirSync(dirTarget, { mode: 0o700 });
    const result = writeFileAtomic(dirTarget, 'x');
    assert.equal(result.ok, false);
    assert.equal(statSync(dirTarget).isDirectory(), true, 'the directory must be untouched');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

// ─── transactional mutation (SIR-PS2-001/002) ────────────────────────────

test('transaction: absent state is created by the transition; lock is cleaned up', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    const result = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.changed, true);
    assert.equal(result.previous, null);
    assert.deepEqual(result.value.surfaces.map((s) => s.surfaceId), ['main']);
    const doc = parseRuntimeDocument(readFileSync(path, 'utf8'));
    assert.equal(doc.ok, true);
    if (doc.ok) assert.equal(doc.document.surfaces.length, 1);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(existsSync(`${path}.lock`), false, 'lock must be released');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('transaction: incompatible existing state fails closed and is preserved', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    writeFileSync(path, '{"foreign": true}', { mode: 0o600 });
    const result = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-PS2-CONFIG-INCOMPATIBLE');
    assert.equal(readFileSync(path, 'utf8'), '{"foreign": true}', 'foreign content must never be replaced');
    assert.equal(existsSync(`${path}.lock`), false, 'lock must be released on failure');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('transaction: transition failure writes nothing and releases the lock', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    const result = mutateDocumentAtomically(path, {
      decode: decodeDocument,
      transition: () => ({ ok: false as const, code: 'ERR-PS2-REG-NOT-FOUND', message: 'simulated transition failure' }),
      serialize: serializeRuntimeDocument,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-PS2-REG-NOT-FOUND');
    assert.equal(existsSync(path), false, 'nothing may be published on transition failure');
    // The lock was released: a follow-up transaction succeeds.
    const followUp = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
    assert.equal(followUp.ok, true, 'lock must be reusable after a failed transition');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('transaction: exact re-registration is an idempotent no-op (no rewrite)', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    const first = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const mtimeBefore = statSync(path).mtimeMs;
    const second = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.changed, false, 'exact re-registration must not rewrite');
    assert.equal(statSync(path).mtimeMs, mtimeBefore);
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('transaction: zero-progress write fails closed, cleans tmp, and releases the lock', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    let calls = 0;
    const failingWrite: (fd: number, buffer: Buffer, offset: number, length: number) => number = (fd, buffer, offset, length) => {
      calls += 1;
      if (calls >= 2) return 0;
      return writeSync(fd, buffer, offset, Math.min(1, length));
    };
    const result = mutateDocumentAtomically(path, { ...TRANSACTION(path, surface('main')), write: failingWrite });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-PS2-WRITE-FAILED');
    assert.equal(existsSync(path), false);
    assert.deepEqual(readdirSync(env).filter((e) => e.includes('.tmp-')), []);
    assert.equal(existsSync(`${path}.lock`), false, 'lock must be released on publish failure');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

test('transaction: a foreign file created while the lock is held cannot be silently overwritten', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    const lockPath = `${path}.lock`;
    // Simulate a live cooperating holder: the lock artifact exists.
    const lockFd = openSync(lockPath, 'wx', 0o600);
    try {
      writeFileSync(path, '{"foreign": true}', { mode: 0o600 });
      const busy = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
      assert.equal(busy.ok, false, 'a transaction against a held lock must fail closed');
      if (!busy.ok) assert.equal(busy.code, 'ERR-PS2-CONFIG-BUSY');
      assert.equal(readFileSync(path, 'utf8'), '{"foreign": true}', 'foreign target must survive the failed attempt');
      assert.equal(existsSync(lockPath), true, 'a lock we do not own must never be stolen or removed');
    } finally {
      unlinkSync(lockPath);
      closeFd(lockFd);
    }
    // After release, the foreign state is still never overwritten (decode
    // rejects it) — the check runs under the lock in every path.
    const incompatible = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
    assert.equal(incompatible.ok, false);
    if (!incompatible.ok) assert.equal(incompatible.code, 'ERR-PS2-CONFIG-INCOMPATIBLE');
    assert.equal(readFileSync(path, 'utf8'), '{"foreign": true}');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});

function closeFd(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // best-effort
  }
}

// ─── real multi-process concurrency (SIR-PS2-002) ────────────────────────

const REPO = join(import.meta.dirname, '..', '..', '..');

/** A real subprocess that transactionally registers one unique surface. */
function spawnMutator(path: string, surfaceId: string): Promise<{ readonly code: number | null; readonly stderr: string }> {
  const script = `
import { mutateDocumentAtomically } from ${JSON.stringify(pathToFileURL(join(REPO, 'dist', 'persistence', 'writer.js')).href)};
import { parseRuntimeDocument, serializeRuntimeDocument } from ${JSON.stringify(pathToFileURL(join(REPO, 'dist', 'config', 'document.js')).href)};
import { registerSurface } from ${JSON.stringify(pathToFileURL(join(REPO, 'dist', 'registry', 'model.js')).href)};
const [, , target, surfaceId] = process.argv;
const decode = (text) => { const p = parseRuntimeDocument(text); return p.ok ? p.document : null; };
const transition = (current) => {
  const doc = current ?? { surfaces: [] };
  const surface = { surfaceId, locator: '/store/' + surfaceId, serviceUid: 1000, forbiddenRoots: [], configurationIdentity: 'sha-256:' + 'a'.repeat(64), configurationVersion: '2', limitProfile: {} };
  const out = registerSurface(doc, surface);
  return out.ok ? { ok: true, next: out.value, changed: out.changed } : { ok: false, code: out.code, message: out.message };
};
const result = mutateDocumentAtomically(target, { decode, transition, serialize: serializeRuntimeDocument });
if (!result.ok) { process.stderr.write(result.code + ': ' + result.message + '\\n'); process.exit(3); }
process.exit(0);
`;
  const scriptPath = join(tmpdir(), `ps2-mutator-${process.pid}-${surfaceId}.mjs`);
  writeFileSync(scriptPath, script, { mode: 0o600 });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, path, surfaceId], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        rmSync(scriptPath, { force: true });
      } catch {
        // best-effort
      }
      resolve({ code, stderr });
    });
  });
}

test('transaction: concurrent real-process mutations serialize — every reported success survives (3 runs)', async () => {
  const N = 8;
  for (let run = 0; run < 3; run++) {
    const env = makeEnv();
    try {
      const path = join(env, 'runtime.json');
      const ids = Array.from({ length: N }, (_, i) => `pgw:w:${run}-${i}`);
      const results = await Promise.all(ids.map((id) => spawnMutator(path, id)));
      for (const r of results) {
        assert.equal(r.code, 0, `mutator must succeed (run ${run}): ${r.stderr}`);
      }
      const doc = parseRuntimeDocument(readFileSync(path, 'utf8'));
      assert.equal(doc.ok, true, 'final document must be valid');
      if (!doc.ok) return;
      const present = new Set(doc.document.surfaces.map((s) => s.surfaceId));
      assert.equal(doc.document.surfaces.length, N, `run ${run}: all ${N} reported-success surfaces must be present`);
      for (const id of ids) {
        assert.ok(present.has(id), `run ${run}: surface ${id} must be present`);
      }
      assert.equal(existsSync(`${path}.lock`), false, 'lock must be released after all transactions');
    } finally {
      rmSync(env, { recursive: true, force: true });
    }
  }
});

test('transaction: contention is bounded and deterministic — BUSY after retries, then success after release', () => {
  const env = makeEnv();
  try {
    const path = join(env, 'runtime.json');
    const lockPath = `${path}.lock`;
    const lockFd = openSync(lockPath, 'wx', 0o600);
    try {
      const started = Date.now();
      const busy = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
      const elapsed = Date.now() - started;
      assert.equal(busy.ok, false);
      if (!busy.ok) {
        assert.equal(busy.code, 'ERR-PS2-CONFIG-BUSY');
        assert.ok(busy.message.includes('stale lock'), 'BUSY must give truthful stale-lock recovery guidance');
      }
      assert.ok(elapsed >= 400, 'the bounded retry window must actually elapse before BUSY');
    } finally {
      unlinkSync(lockPath);
      closeFd(lockFd);
    }
    const after = mutateDocumentAtomically(path, TRANSACTION(path, surface('main')));
    assert.equal(after.ok, true, 'after release the transaction succeeds');
  } finally {
    rmSync(env, { recursive: true, force: true });
  }
});
