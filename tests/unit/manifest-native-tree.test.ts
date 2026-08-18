/** NEW-STATE Slice A — package-tree SHA-256 v1 hardening tests (deterministic, bounded, no-follow). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, linkSync, mkdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPackageTree, PACKAGE_TREE_MAX_ENTRIES, PACKAGE_TREE_MAX_FILE_BYTES } from '../../src/installer/artifact.js';

function freshRoot(): string {
  const dir = join(tmpdir(), `pi-shuttle-tree-${process.pid}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Reference framing per the v1 contract, computed independently in the test. */
function referenceTreeDigest(entries: Array<{ rel: string; kind: 'directory' | 'file'; sha256?: string }>): string {
  const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.rel, 'utf8'), Buffer.from(b.rel, 'utf8')));
  const digest = createHash('sha256');
  for (const entry of sorted) {
    digest.update(entry.kind);
    digest.update('\0');
    digest.update(entry.rel);
    digest.update('\0');
    if (entry.kind === 'file') {
      digest.update(entry.sha256!);
      digest.update('\0');
    }
  }
  return digest.digest('hex');
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

test('tree: deterministic same tree -> same digest, matching the independent v1 reference framing', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'a.txt'), 'alpha');
    writeFileSync(join(root, 'b.txt'), 'beta');
    const first = await hashPackageTree(root);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const second = await hashPackageTree(root);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value, first.value);
    // Reference framing: root "." directory + two files in UTF-8 byte order.
    const expected = referenceTreeDigest([
      { rel: '.', kind: 'directory' },
      { rel: 'a.txt', kind: 'file', sha256: sha256Hex('alpha') },
      { rel: 'b.txt', kind: 'file', sha256: sha256Hex('beta') },
    ]);
    assert.equal(first.value, expected);
  } finally {
    cleanup(root);
  }
});

test('tree: traversal order is unsigned UTF-8 byte order (not UTF-16 code-unit order)', async () => {
  const root = freshRoot();
  try {
    // U+10000 (surrogate pair in UTF-16: 0xD800 0xDC00) vs U+E000:
    // UTF-16 sorts U+10000 first; UTF-8 byte order sorts U+E000 first.
    writeFileSync(join(root, '\u{10000}.txt'), 'astral');
    writeFileSync(join(root, '\uE000.txt'), 'pua');
    const result = await hashPackageTree(root);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const expected = referenceTreeDigest([
      { rel: '.', kind: 'directory' },
      { rel: '\uE000.txt', kind: 'file', sha256: sha256Hex('pua') },
      { rel: '\u{10000}.txt', kind: 'file', sha256: sha256Hex('astral') },
    ]);
    assert.equal(result.value, expected);
  } finally {
    cleanup(root);
  }
});

test('tree: regular-file content mutation and path changes change the digest', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'a.txt'), 'one');
    writeFileSync(join(root, 'b.txt'), 'two');
    const before = await hashPackageTree(root);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    writeFileSync(join(root, 'a.txt'), 'one!');
    const mutated = await hashPackageTree(root);
    assert.equal(mutated.ok, true);
    if (!mutated.ok) return;
    assert.notEqual(mutated.value, before.value);
    writeFileSync(join(root, 'a.txt'), 'one');
    // Rename via rewrite: same bytes, different path.
    writeFileSync(join(root, 'c.txt'), 'two');
    rmSync(join(root, 'b.txt'));
    const repathed = await hashPackageTree(root);
    assert.equal(repathed.ok, true);
    if (!repathed.ok) return;
    assert.notEqual(repathed.value, before.value);
  } finally {
    cleanup(root);
  }
});

test('tree: symlinks reject', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'real.txt'), 'x');
    symlinkSync(join(root, 'real.txt'), join(root, 'link.txt'));
    const result = await hashPackageTree(root);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /symbolic link rejected/);
    // Symlinked directory also rejects.
    const second = freshRoot();
    try {
      mkdirSync(join(second, 'real-dir'));
      symlinkSync(join(second, 'real-dir'), join(second, 'link-dir'));
      const dirResult = await hashPackageTree(second);
      assert.equal(dirResult.ok, false);
    } finally {
      cleanup(second);
    }
  } finally {
    cleanup(root);
  }
});

test('tree: hard links reject where deterministically detectable', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'first.txt'), 'same bytes');
    linkSync(join(root, 'first.txt'), join(root, 'second.txt'));
    const result = await hashPackageTree(root);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /hard link rejected/);
  } finally {
    cleanup(root);
  }
});

test('tree: FIFO (special file) rejects', async (t) => {
  const root = freshRoot();
  try {
    try {
      execFileSync('mkfifo', [join(root, 'pipe')]);
    } catch {
      t.skip('mkfifo unavailable on this host');
      return;
    }
    const result = await hashPackageTree(root);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /unsupported package entry type/);
  } finally {
    cleanup(root);
  }
});

test('tree: entry-count and total-bytes bounds reject', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'a.txt'), 'x');
    // Entry ceiling (injected seam; 100k real entries would be slow).
    const entriesResult = await hashPackageTree(root, { maxEntries: 1 });
    assert.equal(entriesResult.ok, false);
    assert.match(entriesResult.ok ? '' : entriesResult.message, /entry ceiling/);
    // Byte ceiling (injected seam for the 1 GiB contract).
    writeFileSync(join(root, 'big.bin'), 'y'.repeat(256));
    const bytesResult = await hashPackageTree(root, { maxFileBytes: 128 });
    assert.equal(bytesResult.ok, false);
    assert.match(bytesResult.ok ? '' : bytesResult.message, /byte ceiling/);
    // Defaults remain the compiled contract.
    assert.equal(PACKAGE_TREE_MAX_ENTRIES, 100_000);
    assert.equal(PACKAGE_TREE_MAX_FILE_BYTES, 1024 * 1024 * 1024);
  } finally {
    cleanup(root);
  }
});

test('tree: minimal tree (root only) succeeds at the entry limit', async () => {
  const root = freshRoot();
  try {
    const result = await hashPackageTree(root, { maxEntries: 1 });
    assert.equal(result.ok, true, 'a root-only tree is exactly one entry and must succeed');
    if (!result.ok) return;
    // Root "." participates in the count and in the framing.
    assert.equal(result.value, referenceTreeDigest([{ rel: '.', kind: 'directory' }]));
  } finally {
    cleanup(root);
  }
});

test('tree: exactly at the entry limit succeeds', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'a.txt'), 'alpha');
    writeFileSync(join(root, 'b.txt'), 'beta');
    const result = await hashPackageTree(root, { maxEntries: 3 });
    assert.equal(result.ok, true, 'root + 2 files is exactly 3 entries and must succeed');
    if (!result.ok) return;
    const expected = referenceTreeDigest([
      { rel: '.', kind: 'directory' },
      { rel: 'a.txt', kind: 'file', sha256: sha256Hex('alpha') },
      { rel: 'b.txt', kind: 'file', sha256: sha256Hex('beta') },
    ]);
    assert.equal(result.value, expected);
  } finally {
    cleanup(root);
  }
});

test('tree: limit + 1 fails during traversal, before the remaining subtree is walked', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'b.txt'), 'b');
    writeFileSync(join(root, 'c.txt'), 'c');
    // A symlink deep in the tree would throw "symbolic link rejected" if
    // traversal ever reached it. Failing with the ENTRY CEILING error
    // proves the walk stopped as soon as the next accepted entry would
    // exceed the limit (root + a + b = 3; c is the 4th) and never reached
    // the symlink.
    mkdirSync(join(root, 'deep'));
    symlinkSync(join(root, 'a.txt'), join(root, 'deep', 'link.txt'));
    const result = await hashPackageTree(root, { maxEntries: 3 });
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /entry ceiling/);
  } finally {
    cleanup(root);
  }
});

test('tree: mode, mtime, and inode-independent framing (identity excludes metadata)', async () => {
  const root = freshRoot();
  try {
    writeFileSync(join(root, 'run.js'), '#!/usr/bin/env node\n');
    writeFileSync(join(root, 'data.txt'), 'payload');
    const before = await hashPackageTree(root);
    assert.equal(before.ok, true);
    if (!before.ok) return;
    // Executable bit and other modes are excluded from the identity.
    chmodSync(join(root, 'run.js'), 0o755);
    chmodSync(join(root, 'data.txt'), 0o600);
    // mtime is excluded.
    utimesSync(join(root, 'data.txt'), new Date('2001-01-01'), new Date('2001-01-01'));
    const after = await hashPackageTree(root);
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.value, before.value);
  } finally {
    cleanup(root);
  }
});
