/**
 * NEW-STATE Slice B — durable publication tests (deterministic
 * fault-injection only; no sleep-based or actual disk-failure tests).
 *
 * Proves the accepted POSIX durable sequence, the pre/post-rename typed
 * failure distinction, the post-rename no-destructive-cleanup invariant
 * (receipt AND cache), the immutable no-clobber cache contract, and
 * identical-target reuse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { resolveManifestNativeLayout } from '../../src/host/environment.js';
import { CACHE_SCHEMA_VERSION, serializeManifestNativeCache } from '../../src/manifest-native/cache.js';
import type { ManifestNativeCacheDocument } from '../../src/manifest-native/cache.js';
import { durablePublish, publishManifestNativeCache, publishManifestNativeReceipt, realDurableIo } from '../../src/manifest-native/write.js';
import type { DurableIo } from '../../src/manifest-native/write.js';
import {
  buildNativeChain,
  materializeNativeNamespace,
  nativeBaseDir,
  removeNativeBase,
} from '../helpers/manifest-native-fixtures.js';

/** An errno-shaped failure for deterministic fault injection. */
function ioError(code: string): NodeJS.ErrnoException {
  const err = new Error(`injected ${code}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** The real I/O implementation with selective injected failures. */
function ioWith(overrides: Partial<DurableIo>): DurableIo {
  return { ...realDurableIo, ...overrides };
}

function noTempLeftovers(dir: string): void {
  for (const name of readdirSync(dir)) {
    assert.equal(name.includes('.mn-tmp-'), false, `temporary file must be cleaned up: ${name}`);
  }
}

function cacheDocument(chain: ReturnType<typeof buildNativeChain>): ManifestNativeCacheDocument {
  return {
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    keyringText: chain.keyringText,
    channelText: chain.channelText,
    releaseManifestText: chain.releaseText,
  };
}

// ─── receipt durability (requirement 27 A–D) ─────────────────────────────

test('write: receipt temp write failure -> pre-rename error, no final receipt', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    const result = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ write: () => 0 }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.match(result.message, /write-temp/);
    assert.equal(statSafe(ns.layout.receiptPath), false, 'no final receipt may exist after a pre-rename failure');
    noTempLeftovers(ns.layout.authorityRoot);
  } finally {
    removeNativeBase(base);
  }
});

test('write: receipt temp fsync failure -> pre-rename error, no final receipt', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    const result = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ fsync: () => { throw ioError('EIO'); } }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.match(result.message, /fsync-temp/);
    assert.match(result.message, /EIO/);
    assert.equal(statSafe(ns.layout.receiptPath), false);
    noTempLeftovers(ns.layout.authorityRoot);
  } finally {
    removeNativeBase(base);
  }
});

test('write: receipt temp close failure -> pre-rename error, no final receipt', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    const result = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ close: () => { throw ioError('EIO'); } }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.match(result.message, /close-temp/);
    assert.equal(statSafe(ns.layout.receiptPath), false);
    noTempLeftovers(ns.layout.authorityRoot);
  } finally {
    removeNativeBase(base);
  }
});

test('write: receipt link failure -> pre-rename error, no final receipt', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    const result = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ link: () => { throw ioError('EACCES'); } }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.match(result.message, /link-final/);
    assert.match(result.message, /EACCES/);
    assert.equal(statSafe(ns.layout.receiptPath), false, 'link failure must leave no final receipt');
    noTempLeftovers(ns.layout.authorityRoot);
  } finally {
    removeNativeBase(base);
  }
});

test('write: receipt parent-dir fsync failure AFTER rename -> post-rename error; receipt visible; referenced state preserved; no rollback', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    // Republish the receipt with a failing parent-directory fsync.
    const originalReceiptBytes = readFileSync(ns.layout.receiptPath);
    rmSync(ns.layout.receiptPath);
    const result = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ fsyncDirectory: () => { throw ioError('EIO'); } }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.match(result.message, /fsync-parent-dir/);
    // The final authoritative receipt remains visible and byte-exact.
    assert.equal(statSafe(ns.layout.receiptPath), true, 'post-rename failure must leave the final receipt visible');
    assert.deepEqual(readFileSync(ns.layout.receiptPath), originalReceiptBytes, 'the published receipt bytes must be preserved exactly');
    // Referenced state (cache + package tree) is preserved — no rollback.
    assert.equal(statSafe(ns.cachePath), true, 'the referenced cache must be preserved after a post-rename receipt failure');
    assert.equal(statSafe(ns.packageRoot), true, 'the referenced package tree must be preserved after a post-rename receipt failure');
    assert.equal(statSafe(join(ns.packageRoot, 'bin', 'run.js')), true, 'the referenced bin must be preserved');
    noTempLeftovers(ns.layout.authorityRoot);
  } finally {
    removeNativeBase(base);
  }
});

// ─── cache durability (requirement 27 E–H) ───────────────────────────────

test('write: cache temp write failure -> pre-rename error, no final cache', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({ write: () => 0 }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.match(result.message, /write-temp/);
    assert.equal(statSafe(ns.cachePath), false, 'no final cache may exist after a pre-rename failure');
    noTempLeftovers(join(ns.layout.manifestsRoot, ns.chain.releaseId));
  } finally {
    removeNativeBase(base);
  }
});

test('write: cache temp fsync failure -> pre-rename error, no final cache', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({ fsync: () => { throw ioError('EIO'); } }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.equal(statSafe(ns.cachePath), false);
    noTempLeftovers(join(ns.layout.manifestsRoot, ns.chain.releaseId));
  } finally {
    removeNativeBase(base);
  }
});

test('write: cache link failure -> pre-rename error, no final cache', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({ link: () => { throw ioError('EACCES'); } }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.equal(statSafe(ns.cachePath), false);
    noTempLeftovers(join(ns.layout.manifestsRoot, ns.chain.releaseId));
  } finally {
    removeNativeBase(base);
  }
});

test('write: cache parent-dir fsync failure AFTER rename -> post-rename error; published cache preserved', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const originalBytes = readFileSync(ns.cachePath);
    rmSync(ns.cachePath);
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({ fsyncDirectory: () => { throw ioError('EIO'); } }), process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.match(result.message, /fsync-parent-dir/);
    assert.equal(statSafe(ns.cachePath), true, 'the published cache must remain visible after a post-rename failure');
    assert.deepEqual(readFileSync(ns.cachePath), originalBytes);
    noTempLeftovers(join(ns.layout.manifestsRoot, ns.chain.releaseId));
  } finally {
    removeNativeBase(base);
  }
});

// ─── cache no-clobber / reuse (requirement 27 I–J) ───────────────────────

test('write: conflicting immutable cache target fails closed and is never overwritten', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    // A different signed chain (different release identity) targeted at the
    // SAME cache identity must not overwrite the immutable object.
    const other = buildNativeChain({ releaseId: 'gateway-native-release-bbb' });
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(other), realDurableIo, process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-CACHE-CONFLICT');
    // Original object untouched.
    assert.deepEqual(readFileSync(ns.cachePath), readFileSync(ns.cachePath));
    const still = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), realDurableIo, process.getuid?.() ?? -1);
    assert.equal(still.ok, true);
    if (!still.ok) return;
    assert.equal(still.published, false, 'the identical object is reused, not rewritten');
  } finally {
    removeNativeBase(base);
  }
});

test('write: identical cache target is safely reverified and reused; identity grammar gates the path', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), realDurableIo, process.getuid?.() ?? -1);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.published, false, 'existing identical cache is reused');
    assert.equal(result.path, ns.cachePath);
    // Non-canonical identity cannot derive or publish anywhere.
    const bad = publishManifestNativeCache(ns.layout, 'BAD-ID', ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), realDurableIo, process.getuid?.() ?? -1);
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.equal(bad.code, 'ERR-MN-CACHE-IDENTITY');
  } finally {
    removeNativeBase(base);
  }
});

test('write: identical receipt target is reused; conflicting receipt fails closed', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const same = publishManifestNativeReceipt(ns.layout, ns.receipt, realDurableIo, process.getuid?.() ?? -1);
    assert.equal(same.ok, true);
    if (!same.ok) return;
    assert.equal(same.published, false, 'existing identical receipt is reused');
    // A different receipt (same layout, different release) fails closed:
    // replacement is future fresh-install orchestration.
    const other = await materializeNativeNamespace(nativeBaseDir(), { releaseId: 'gateway-native-release-bbb' });
    try {
      const conflict = publishManifestNativeReceipt(ns.layout, other.receipt, realDurableIo, process.getuid?.() ?? -1);
      assert.equal(conflict.ok, false);
      if (conflict.ok) return;
      assert.equal(conflict.code, 'ERR-MN-RECEIPT-CONFLICT');
      assert.deepEqual(readFileSync(ns.layout.receiptPath), readFileSync(ns.layout.receiptPath), 'the existing receipt must remain untouched');
    } finally {
      removeNativeBase(other.baseDir);
    }
  } finally {
    removeNativeBase(base);
  }
});

test('write: durablePublish byte-identity round-trip and temp cleanup on success; no-clobber on a second attempt', () => {
  const base = nativeBaseDir();
  try {
    const layout = resolveManifestNativeLayout(base);
    const target = join(layout.authorityRoot, 'probe.bin');
    const bytes = Buffer.from('durable payload\n', 'utf8');
    const result = durablePublish(target, bytes);
    assert.equal(result.ok, true);
    assert.deepEqual(readFileSync(target), bytes);
    // Final file is owner-private 0600; parents 0700.
    const mode = statSync(target).mode & 0o7777;
    assert.equal(mode, 0o600, `published file must be exactly 0600 (got ${mode.toString(8)})`);
    assert.equal(statSync(layout.authorityRoot).mode & 0o7777, 0o700, 'created parent must be exactly 0700');
    noTempLeftovers(layout.authorityRoot);
    // The generic primitive never clobbers: a second attempt on the same
    // target reports the typed EEXIST outcome (existing-object
    // verification is the callers' responsibility) and the bytes are
    // untouched.
    const again = durablePublish(target, bytes);
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.code, 'ERR-MN-DURABILITY-EEXIST');
    assert.deepEqual(readFileSync(target), bytes, 'the existing object must never be replaced');
    noTempLeftovers(layout.authorityRoot);
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-01 injected race — a competing target created before link() is never overwritten (cache)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const competing = Buffer.from('{"cacheSchemaVersion":1,"keyring":"{}","channel":"{}","releaseManifest":"{}"}\n');
    // Simulate the winner: link() first materializes the competing target,
    // then reports EEXIST exactly like a racing writer would observe.
    const racingIo = ioWith({
      link: (from, to) => {
        writeFileSync(to, competing, { mode: 0o600 });
        throw ioError('EEXIST');
      },
    });
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), racingIo, process.getuid?.() ?? -1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-CACHE-CONFLICT', 'the competing object differs; must fail closed');
    assert.deepEqual(readFileSync(ns.cachePath), competing, 'the winning target bytes must be preserved exactly');
    noTempLeftovers(join(ns.layout.manifestsRoot, ns.chain.releaseId));
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-01 injected race — identical competing target reuses through the durability barrier', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    let fsyncCount = 0;
    const racingIo = ioWith({
      link: (from, to) => {
        writeFileSync(to, serializeManifestNativeCache(cacheDocument(ns.chain)), { mode: 0o600 });
        throw ioError('EEXIST');
      },
      fsyncDirectory: (fd) => {
        fsyncCount++;
        fsyncSync(fd);
      },
    });
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), racingIo, process.getuid?.() ?? -1);
    assert.equal(result.ok, true, 'an identical winning target must be reused');
    if (!result.ok) return;
    assert.equal(result.published, false, 'the identical race winner is reused, not re-published');
    assert.equal(fsyncCount >= 1, true, 'reuse must establish the parent-directory durability barrier (at least one fsync)');
    assert.deepEqual(readFileSync(ns.cachePath), Buffer.from(serializeManifestNativeCache(cacheDocument(ns.chain)), 'utf8'), 'the winning target bytes are preserved');
    noTempLeftovers(join(ns.layout.manifestsRoot, ns.chain.releaseId));
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-02/02b attempt 1 post-error keeps the cache visible; attempt 2 reuse fsyncs the FILE and the parent and succeeds', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const uid = process.getuid?.() ?? -1;
    const expectedBytes = Buffer.from(serializeManifestNativeCache(cacheDocument(ns.chain)), 'utf8');
    // Attempt 1: final becomes visible, parent fsync fails -> fatal POST error.
    const first = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({ fsyncDirectory: () => { throw ioError('EIO'); } }), uid);
    assert.equal(first.ok, false);
    if (first.ok) return;
    assert.equal(first.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.equal(statSafe(ns.cachePath), true, 'the cache must remain visible after the fatal POST error');
    assert.deepEqual(readFileSync(ns.cachePath), expectedBytes);
    // Attempt 2: identical object; reuse MUST fsync the existing FILE
    // (content barrier) AND the cache parent (entry barrier).
    let fileFsyncCount = 0;
    let dirFsyncCount = 0;
    const second = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({
      fsync: (fd) => { fileFsyncCount++; fsyncSync(fd); },
      fsyncDirectory: (fd) => { dirFsyncCount++; fsyncSync(fd); },
    }), uid);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.published, false, 'attempt 2 reuses the visible object');
    assert.equal(fileFsyncCount >= 1, true, 'reuse must fsync the existing FILE (content durability)');
    assert.equal(dirFsyncCount >= 1, true, 'reuse must fsync the parent directory (entry durability)');
    // Attempt 2 variant: reuse barrier fails -> POST error, cache preserved.
    const third = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({ fsyncDirectory: () => { throw ioError('EIO'); } }), uid);
    assert.equal(third.ok, false);
    if (third.ok) return;
    assert.equal(third.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.equal(statSafe(ns.cachePath), true, 'a failed reuse barrier must never delete the visible object');
    assert.deepEqual(readFileSync(ns.cachePath), expectedBytes);
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-02/02b receipt reuse fsyncs the FILE and the parent; failing barrier preserves the receipt', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const uid = process.getuid?.() ?? -1;
    const expectedBytes = readFileSync(ns.layout.receiptPath);
    // Attempt 1: republish with a failing parent fsync -> POST error, receipt visible.
    rmSync(ns.layout.receiptPath);
    const first = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ fsyncDirectory: () => { throw ioError('EIO'); } }), uid);
    assert.equal(first.ok, false);
    if (first.ok) return;
    assert.equal(first.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.equal(statSafe(ns.layout.receiptPath), true);
    assert.deepEqual(readFileSync(ns.layout.receiptPath), expectedBytes);
    // Attempt 2: reuse with counting file + parent fsyncs -> success.
    let fileFsyncCount = 0;
    let dirFsyncCount = 0;
    const second = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({
      fsync: (fd) => { fileFsyncCount++; fsyncSync(fd); },
      fsyncDirectory: (fd) => { dirFsyncCount++; fsyncSync(fd); },
    }), uid);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.published, false);
    assert.equal(fileFsyncCount >= 1, true, 'receipt reuse must fsync the existing FILE (content durability)');
    assert.equal(dirFsyncCount >= 1, true, 'receipt reuse must fsync the parent directory (entry durability)');
    // Attempt 2 variant: failing barrier -> POST error, receipt preserved.
    const third = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ fsyncDirectory: () => { throw ioError('EIO'); } }), uid);
    assert.equal(third.ok, false);
    if (third.ok) return;
    assert.equal(third.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.equal(statSafe(ns.layout.receiptPath), true);
    assert.deepEqual(readFileSync(ns.layout.receiptPath), expectedBytes);
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-06 unsafe existing targets fail closed (symlink, wrong mode, malformed)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const uid = process.getuid?.() ?? -1;
    // Symlinked cache target -> conflict.
    rmSync(ns.cachePath);
    symlinkSync(join(ns.layout.receiptPath), ns.cachePath);
    let result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), realDurableIo, uid);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-CACHE-CONFLICT');
    assert.equal(lstatIsSymlink(ns.cachePath), true, 'the symlink must never be replaced');
    // Wrong-mode cache target -> conflict.
    rmSync(ns.cachePath);
    writeFileSync(ns.cachePath, serializeManifestNativeCache(cacheDocument(ns.chain)));
    chmodSync(ns.cachePath, 0o644);
    result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), realDurableIo, uid);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-CACHE-CONFLICT');
    assert.equal(statSync(ns.cachePath).mode & 0o7777, 0o644, 'the unsafe target must not be overwritten or repaired');
    // Malformed (byte-different) cache target -> conflict.
    rmSync(ns.cachePath);
    writeFileSync(ns.cachePath, '{"cacheSchemaVersion":1,"keyring":"{}","channel":"{}","releaseManifest":"{}"}', { mode: 0o600 });
    result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), realDurableIo, uid);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-CACHE-CONFLICT');
    // Symlinked receipt target -> conflict, symlink preserved.
    rmSync(ns.layout.receiptPath);
    symlinkSync(ns.cachePath, ns.layout.receiptPath);
    result = publishManifestNativeReceipt(ns.layout, ns.receipt, realDurableIo, uid);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-RECEIPT-CONFLICT');
    assert.equal(lstatIsSymlink(ns.layout.receiptPath), true, 'the receipt symlink must never be replaced');
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-05 cleanup failure never obscures the original failure; post-link temp-unlink failure is POST-class with the final preserved', async () => {
  const base = nativeBaseDir();
  try {
    const layout = resolveManifestNativeLayout(base);
    const target = join(layout.authorityRoot, 'probe.bin');
    const bytes = Buffer.from('payload\n', 'utf8');
    // Pre-publication: injected write failure AND injected unlink failure —
    // the original write error must still be reported.
    const failing = durablePublish(target, bytes, ioWith({ write: () => 0, unlink: () => { throw ioError('EIO'); } }));
    assert.equal(failing.ok, false);
    if (failing.ok) return;
    assert.equal(failing.code, 'ERR-MN-DURABILITY-PRE-RENAME');
    assert.match(failing.message, /write-temp/, 'the ORIGINAL failure must be preserved despite cleanup failure');
    assert.equal(statSafe(target), false);
    // Post-link: temp unlink failure -> POST-class error, final preserved.
    const postLink = durablePublish(target, bytes, ioWith({ unlink: () => { throw ioError('EIO'); } }));
    assert.equal(postLink.ok, false);
    if (postLink.ok) return;
    assert.equal(postLink.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.match(postLink.message, /unlink-temp/);
    assert.deepEqual(readFileSync(target), bytes, 'the final must stay visible and byte-exact after a temp-unlink failure');
  } finally {
    removeNativeBase(base);
  }
});

function lstatIsSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function statSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

// ─── MN-B-02b: existing-file content durability ──────────────────────────

/**
 * Directly materialize a canonical, valid, byte-identical existing target
 * WITHOUT going through durablePublish (writeFileSync only). The
 * publication wrapper must NOT merely trust visibility: it must perform
 * the existing-file fsync + parent fsync before reuse success.
 */
function materializeExistingTarget(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
}

test('write: MN-B-02b non-primitive existing cache still receives file + parent durability barriers', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const uid = process.getuid?.() ?? -1;
    const bytes = Buffer.from(serializeManifestNativeCache(cacheDocument(ns.chain)), 'utf8');
    // Direct materialization — the object never passed through durablePublish.
    materializeExistingTarget(ns.cachePath, bytes);
    let fileFsyncCount = 0;
    let dirFsyncCount = 0;
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({
      fsync: (fd) => { fileFsyncCount++; fsyncSync(fd); },
      fsyncDirectory: (fd) => { dirFsyncCount++; fsyncSync(fd); },
    }), uid);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.published, false, 'the non-primitive identical object is reused');
    assert.equal(fileFsyncCount >= 1, true, 'the existing FILE must be fsynced before reuse success');
    assert.equal(dirFsyncCount >= 1, true, 'the parent directory must be fsynced before reuse success');
    assert.deepEqual(readFileSync(ns.cachePath), bytes, 'the existing object bytes are preserved exactly');
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-02b non-primitive existing receipt still receives file + parent durability barriers', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    const uid = process.getuid?.() ?? -1;
    const bytes = Buffer.from(ns.receiptText, 'utf8');
    materializeExistingTarget(ns.layout.receiptPath, bytes);
    let fileFsyncCount = 0;
    let dirFsyncCount = 0;
    const result = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({
      fsync: (fd) => { fileFsyncCount++; fsyncSync(fd); },
      fsyncDirectory: (fd) => { dirFsyncCount++; fsyncSync(fd); },
    }), uid);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.published, false);
    assert.equal(fileFsyncCount >= 1, true, 'the existing FILE must be fsynced before receipt reuse success');
    assert.equal(dirFsyncCount >= 1, true, 'the parent directory must be fsynced before receipt reuse success');
    assert.deepEqual(readFileSync(ns.layout.receiptPath), bytes);
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-02b existing-file fsync failure is POST-class; the object is preserved (cache)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const uid = process.getuid?.() ?? -1;
    const bytes = Buffer.from(serializeManifestNativeCache(cacheDocument(ns.chain)), 'utf8');
    materializeExistingTarget(ns.cachePath, bytes);
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({ fsync: () => { throw ioError('EIO'); } }), uid);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.match(result.message, /fsync-existing-file/);
    assert.equal(statSafe(ns.cachePath), true, 'a file-fsync failure must never delete the existing object');
    assert.deepEqual(readFileSync(ns.cachePath), bytes, 'the existing bytes are preserved exactly — no overwrite, no republish');
    noTempLeftovers(join(ns.layout.manifestsRoot, ns.chain.releaseId));
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-02b existing-file fsync failure is POST-class; the object is preserved (receipt)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.layout.receiptPath);
    const uid = process.getuid?.() ?? -1;
    const bytes = Buffer.from(ns.receiptText, 'utf8');
    materializeExistingTarget(ns.layout.receiptPath, bytes);
    const result = publishManifestNativeReceipt(ns.layout, ns.receipt, ioWith({ fsync: () => { throw ioError('EIO'); } }), uid);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.match(result.message, /fsync-existing-file/);
    assert.equal(statSafe(ns.layout.receiptPath), true);
    assert.deepEqual(readFileSync(ns.layout.receiptPath), bytes);
    noTempLeftovers(ns.layout.authorityRoot);
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-02b existing-file fsync succeeds but parent fsync fails -> POST; object preserved (cache)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const uid = process.getuid?.() ?? -1;
    const bytes = Buffer.from(serializeManifestNativeCache(cacheDocument(ns.chain)), 'utf8');
    materializeExistingTarget(ns.cachePath, bytes);
    let fileFsyncCount = 0;
    const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({
      fsync: (fd) => { fileFsyncCount++; fsyncSync(fd); },
      fsyncDirectory: () => { throw ioError('EIO'); },
    }), uid);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'ERR-MN-DURABILITY-POST-RENAME');
    assert.match(result.message, /fsync-parent-dir/);
    assert.equal(fileFsyncCount >= 1, true, 'the file fsync occurred before the parent barrier failed');
    assert.equal(statSafe(ns.cachePath), true);
    assert.deepEqual(readFileSync(ns.cachePath), bytes);
  } finally {
    removeNativeBase(base);
  }
});

test('write: MN-B-02b substituted existing file fails the dev/ino identity binding (POST, preserved)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    rmSync(ns.cachePath);
    const uid = process.getuid?.() ?? -1;
    const bytes = Buffer.from(serializeManifestNativeCache(cacheDocument(ns.chain)), 'utf8');
    materializeExistingTarget(ns.cachePath, bytes);
    // Simulate a same-UID substitution between safe verification and the
    // durability barrier: openExistingFile returns an fd of a DIFFERENT
    // file (different inode). The barrier must fail closed and never fsync
    // or accept the substituted object.
    const other = join(ns.baseDir, 'other-file.bin');
    writeFileSync(other, 'different inode', { mode: 0o600 });
    const otherFd = openSync(other, 'r');
    try {
      let fileFsyncCount = 0;
      // NOTE: the barrier closes the injected fd best-effort on failure.
      const result = publishManifestNativeCache(ns.layout, ns.chain.releaseId, ns.receipt.gateway.releaseManifestSha256, cacheDocument(ns.chain), ioWith({
        openExistingFile: () => otherFd,
        fsync: (fd) => { fileFsyncCount++; fsyncSync(fd); },
      }), uid);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, 'ERR-MN-DURABILITY-POST-RENAME');
      assert.match(result.message, /replaced/, 'the identity mismatch must be reported');
      assert.equal(fileFsyncCount, 0, 'a substituted object must never be fsynced');
    } finally {
      // The barrier already closed the injected fd best-effort; a second
      // close would raise EBADF. Nothing else to release here.
    }
    assert.deepEqual(readFileSync(ns.cachePath), bytes, 'the verified existing object is preserved');
  } finally {
    removeNativeBase(base);
  }
});
