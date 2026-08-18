/** NEW-STATE Slice A — receipt Schema 1 tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManifestNativeReceipt,
  MAX_RECEIPT_BYTES,
  parseManifestNativeReceipt,
  serializeManifestNativeReceipt,
} from '../../src/manifest-native/receipt.js';
import { deriveBinPath, isStrictDescendant, MAX_PATH_BYTES } from '../../src/manifest-native/paths.js';
import {
  materializeNativeNamespace,
  nativeBaseDir,
  removeNativeBase,
  TEST_LANE,
} from '../helpers/manifest-native-fixtures.js';

function errorCode(result: { readonly ok: boolean; readonly code?: string }): string | undefined {
  assert.equal(result.ok, false);
  return result.ok ? undefined : result.code;
}

test('receipt: valid parse and deterministic serialization with exactly one trailing newline', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const parsed = parseManifestNativeReceipt(ns.receiptText);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.schemaVersion, 1);
    assert.equal(parsed.value.lifecycle, 'manifest-native');
    assert.equal(parsed.value.gateway.releaseId, ns.chain.releaseId);
    assert.equal(parsed.value.gateway.packageRoot, ns.packageRoot);
    assert.equal(parsed.value.gateway.binPath, ns.binPath);
    assert.equal(parsed.value.gateway.selectedLane, TEST_LANE);
    // Deterministic: re-serializing the parsed receipt reproduces the exact bytes.
    const serialized = serializeManifestNativeReceipt(parsed.value);
    assert.equal(serialized, ns.receiptText);
    assert.equal(serialized.endsWith('\n'), true);
    assert.equal(serialized.endsWith('\n\n'), false);
    assert.equal(serialized.includes('\r'), false);
    // JCS key ordering is deterministic.
    assert.equal(serializeManifestNativeReceipt(parsed.value), serialized);
  } finally {
    removeNativeBase(base);
  }
});

test('receipt: unknown root and nested gateway fields reject', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const doc = JSON.parse(ns.receiptText) as Record<string, unknown>;
    assert.equal(errorCode(parseManifestNativeReceipt(JSON.stringify({ ...doc, status: 'installed' }))), 'ERR-MN-RECEIPT-SCHEMA');
    const gateway = doc['gateway'] as Record<string, unknown>;
    assert.equal(errorCode(parseManifestNativeReceipt(JSON.stringify({ ...doc, gateway: { ...gateway, timestamp: '2027-01-01' } }))), 'ERR-MN-RECEIPT-SCHEMA');
  } finally {
    removeNativeBase(base);
  }
});

test('receipt: duplicate keys and escaped-equivalent duplicate keys reject', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const doc = JSON.parse(ns.receiptText) as Record<string, unknown>;
    // Duplicate top-level key.
    const duplicate = `{"schemaVersion":1,"schemaVersion":2,"lifecycle":"manifest-native","gateway":${JSON.stringify(doc['gateway'])}}`;
    assert.equal(errorCode(parseManifestNativeReceipt(duplicate)), 'ERR-MN-RECEIPT-DUPLICATE-KEY');
    // Escaped-equivalent duplicate key (\u0073chemaVersion == schemaVersion).
    const escaped = `{"schemaVersion":1,"\\u0073chemaVersion":2,"lifecycle":"manifest-native","gateway":${JSON.stringify(doc['gateway'])}}`;
    assert.equal(errorCode(parseManifestNativeReceipt(escaped)), 'ERR-MN-RECEIPT-DUPLICATE-KEY');
    // Duplicate nested gateway key.
    const dupNested = `{"schemaVersion":1,"lifecycle":"manifest-native","gateway":{"releaseId":"gateway-a-release-001","releaseId":"gateway-a-release-001","releaseManifestSha256":"${'a'.repeat(64)}","packageTreeSha256":"${'b'.repeat(64)}","selectedLane":"${TEST_LANE}","packageRoot":"/x/pkg","binPath":"/x/pkg/bin"}}`;
    assert.equal(errorCode(parseManifestNativeReceipt(dupNested)), 'ERR-MN-RECEIPT-DUPLICATE-KEY');
  } finally {
    removeNativeBase(base);
  }
});

test('receipt: malformed SHA, release ID, lane, and schema reject', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const doc = JSON.parse(ns.receiptText) as { gateway: Record<string, unknown> };
    const withGateway = (gateway: Record<string, unknown>): string => JSON.stringify({ schemaVersion: 1, lifecycle: 'manifest-native', gateway });
    const gateway = doc.gateway;
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, releaseManifestSha256: 'ABC'.repeat(21) + 'a' }))), 'ERR-MN-RECEIPT-SHA');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, releaseManifestSha256: 'A'.repeat(64) }))), 'ERR-MN-RECEIPT-SHA');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, packageTreeSha256: 'b'.repeat(63) }))), 'ERR-MN-RECEIPT-SHA');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, releaseId: 'Gateway-Release-001' }))), 'ERR-MN-RECEIPT-RELEASE-ID');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, releaseId: 'ab' }))), 'ERR-MN-RECEIPT-RELEASE-ID');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, selectedLane: 'linux-weird-lane' }))), 'ERR-MN-RECEIPT-LANE');
    assert.equal(errorCode(parseManifestNativeReceipt(JSON.stringify({ schemaVersion: 2, lifecycle: 'manifest-native', gateway }))), 'ERR-MN-RECEIPT-SCHEMA');
    assert.equal(errorCode(parseManifestNativeReceipt(JSON.stringify({ schemaVersion: 1, lifecycle: 'legacy', gateway }))), 'ERR-MN-RECEIPT-SCHEMA');
  } finally {
    removeNativeBase(base);
  }
});

test('receipt: invalid paths reject (relative, NUL, traversal, non-canonical, ceiling)', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const doc = JSON.parse(ns.receiptText) as { gateway: Record<string, unknown> };
    const gateway = doc.gateway;
    const withGateway = (g: Record<string, unknown>): string => JSON.stringify({ schemaVersion: 1, lifecycle: 'manifest-native', gateway: g });
    const pkg = gateway['packageRoot'] as string;
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, packageRoot: 'relative/path' }))), 'ERR-MN-RECEIPT-PATH');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, packageRoot: `${pkg}\0bad` }))), 'ERR-MN-RECEIPT-PATH');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, packageRoot: `${pkg}/..` }))), 'ERR-MN-RECEIPT-PATH');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, packageRoot: `${pkg}/` }))), 'ERR-MN-RECEIPT-PATH');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, binPath: `/x${'y'.repeat(MAX_PATH_BYTES)}` }))), 'ERR-MN-RECEIPT-PATH');
    // Non-canonical packageRoot with a lone surrogate (invalid Unicode scalar).
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, packageRoot: `/pkg/\u{d800}bad` }))), 'ERR-MN-RECEIPT-PATH');
    // binPath outside packageRoot, or equal to packageRoot.
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, binPath: '/other/place/bin' }))), 'ERR-MN-RECEIPT-PATH');
    assert.equal(errorCode(parseManifestNativeReceipt(withGateway({ ...gateway, binPath: pkg }))), 'ERR-MN-RECEIPT-PATH');
  } finally {
    removeNativeBase(base);
  }
});

test('receipt: oversized receipt rejects at the 16 KiB ceiling', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const doc = JSON.parse(ns.receiptText) as { gateway: Record<string, unknown> };
    const text = JSON.stringify({ schemaVersion: 1, lifecycle: 'manifest-native', gateway: doc.gateway });
    const padding = ' '.repeat(MAX_RECEIPT_BYTES + 1 - Buffer.byteLength(text, 'utf8'));
    const oversized = text.replace('{', `{${padding}`);
    assert.equal(Buffer.byteLength(oversized, 'utf8') > MAX_RECEIPT_BYTES, true);
    assert.equal(errorCode(parseManifestNativeReceipt(oversized)), 'ERR-MN-RECEIPT-SIZE');
  } finally {
    removeNativeBase(base);
  }
});

test('receipt: narrow builder derives canonical paths and refuses forged identity', async () => {
  const base = nativeBaseDir();
  try {
    const ns = await materializeNativeNamespace(base);
    const deps = {
      requireReleaseSelection: ns.requireReleaseSelection,
      requireInstalledEvidence: ns.requireInstalledEvidence,
    };
    // The builder reproduced the fixture receipt exactly (genuine
    // provenance + canonical derivation).
    const rebuilt = buildManifestNativeReceipt({
      selection: ns.selection,
      layout: ns.layout,
      hostLane: TEST_LANE,
      packageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
    }, deps);
    assert.equal(rebuilt.ok, true);
    if (!rebuilt.ok) return;
    assert.equal(serializeManifestNativeReceipt(rebuilt.receipt), ns.receiptText);
    // Tree digest that does not match the signed release declaration refuses.
    const wrongTree = buildManifestNativeReceipt({
      selection: ns.selection,
      layout: ns.layout,
      hostLane: TEST_LANE,
      packageTreeSha256: 'c'.repeat(64),
      packageIdentity: ns.packageIdentity,
    }, deps);
    assert.equal(wrongTree.ok, false);
    // Host lane outside the signed release supported lanes refuses.
    const wrongLane = buildManifestNativeReceipt({
      selection: ns.selection,
      layout: ns.layout,
      hostLane: 'darwin-arm64-posix-utf8-node22',
      packageTreeSha256: ns.packageTreeSha256,
      packageIdentity: ns.packageIdentity,
    }, deps);
    assert.equal(wrongLane.ok, false);
    // Forged package identity refuses.
    const forged = buildManifestNativeReceipt({
      selection: ns.selection,
      layout: ns.layout,
      hostLane: TEST_LANE,
      packageTreeSha256: ns.packageTreeSha256,
      packageIdentity: { name: 'forged-package', version: '0.1.1', bin: { [Object.keys(ns.packageIdentity.bin)[0]!]: 'bin/run.js' } },
    }, deps);
    assert.equal(forged.ok, false);
  } finally {
    removeNativeBase(base);
  }
});

test('receipt: bin derivation is canonical and cannot escape the package root', () => {
  assert.equal(deriveBinPath('/pkg', 'bin/run.js'), '/pkg/bin/run.js');
  assert.equal(deriveBinPath('/pkg', '../escape.js'), null);
  assert.equal(deriveBinPath('/pkg', '/abs/bin.js'), null);
  assert.equal(deriveBinPath('/pkg', ''), null);
  assert.equal(deriveBinPath('/pkg', 'bin/./x.js'), null);
  assert.equal(deriveBinPath('/pkg', 'bin/'), null);
});

test('paths: isStrictDescendant fails closed on non-canonical candidates (F-03)', () => {
  assert.equal(isStrictDescendant('/pkg', '/pkg/x'), true);
  assert.equal(isStrictDescendant('/pkg', '/pkg/'), false, 'trailing slash is non-canonical');
  assert.equal(isStrictDescendant('/pkg', '/pkg//x'), false, 'repeated separators are non-canonical');
  assert.equal(isStrictDescendant('/pkg', '/pkg/x/'), false);
  assert.equal(isStrictDescendant('/pkg', '/pkg/../x'), false);
  assert.equal(isStrictDescendant('/pkg', '/pkg2/bin'), false, 'separator boundary is enforced');
  assert.equal(isStrictDescendant('/pkg', '/pkg'), false, 'equal paths are never descendants');
  assert.equal(isStrictDescendant('pkg', '/pkg/x'), false, 'non-absolute parent fails closed');
  assert.equal(isStrictDescendant('/pkg', 'pkg/x'), false, 'non-absolute candidate fails closed');
});
