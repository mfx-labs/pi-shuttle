/**
 * PS-8A focused tests: release acquisition policy
 * (src/installer/release/acquire.ts) — HTTPS-only, redirect allowlist,
 * truncation detection, digest verification before use, and cleanup of
 * unverified bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { acquireVerifiedFile, downloadToFile, MAX_REDIRECTS, RELEASE_BASE_URL_PREFIX, RELEASE_REDIRECT_ALLOWLIST } from '../../src/installer/release/acquire.js';
import type { FetchResponse, ReleaseFetcher } from '../../src/installer/release/acquire.js';

const BASE = `${RELEASE_BASE_URL_PREFIX}/v0.1.0`;

function body(buffer: Buffer, status = 200, extra: Partial<FetchResponse> = {}): FetchResponse {
  return { status, body: Readable.from([buffer]), contentLength: buffer.length, ...extra };
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ps8a-acquire.XXXXXX'));
  return dir;
}

test('acquire: successful HTTPS download writes the exact bytes', async () => {
  const dir = tempDir();
  try {
    const bytes = Buffer.from('release-asset-bytes');
    const fetcher: ReleaseFetcher = async (url) => {
      assert.equal(url, `${BASE}/pi-shuttle-0.1.0.tgz`);
      return body(bytes);
    };
    const dest = join(dir, 'out.tgz');
    const result = await downloadToFile(`${BASE}/pi-shuttle-0.1.0.tgz`, dest, fetcher);
    assert.equal(result.ok, true);
    assert.deepEqual(readFileSync(dest), bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: truncated download (content-length mismatch) fails closed and removes the file', async () => {
  const dir = tempDir();
  try {
    const fetcher: ReleaseFetcher = async () => ({ status: 200, body: Readable.from([Buffer.from('short')]), contentLength: 1000 });
    const dest = join(dir, 'out.tgz');
    const result = await downloadToFile(`${BASE}/x.tgz`, dest, fetcher);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-REL-ACQUIRE-TRUNCATED');
    assert.equal(existsSync(dest), false, 'partial bytes must be removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: HTTP source is refused without calling the fetcher', async () => {
  const dir = tempDir();
  try {
    let called = false;
    const fetcher: ReleaseFetcher = async () => {
      called = true;
      return body(Buffer.from('x'));
    };
    const result = await downloadToFile('http://github.com/pi-shuttle/x.tgz', join(dir, 'x.tgz'), fetcher);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-REL-ACQUIRE-PROTOCOL');
    assert.equal(called, false, 'an HTTP source must be refused before any fetch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: two-hop redirect policy — allowed host accepted, disallowed and non-HTTPS refused', async () => {
  const dir = tempDir();
  try {
    const bytes = Buffer.from('final-bytes');
    const hops: Array<{ status: number; location?: string }> = [
      { status: 302, location: 'https://release-assets.githubusercontent.com/cdn/x.tgz' },
      { status: 200 },
    ];
    const fetcher: ReleaseFetcher = async (url, depth) => {
      const hop = hops[depth];
      if (hop === undefined) return body(Buffer.from('unexpected'));
      if (hop.status === 200) return body(bytes);
      return { status: hop.status, location: hop.location, body: Readable.from([]) };
    };
    const dest = join(dir, 'x.tgz');
    const result = await downloadToFile(`${BASE}/x.tgz`, dest, fetcher);
    assert.equal(result.ok, true);
    assert.deepEqual(readFileSync(dest), bytes);

    // Disallowed host.
    const evil: ReleaseFetcher = async (url, depth) => (depth === 0 ? { status: 302, location: 'https://evil.example/x.tgz', body: Readable.from([]) } : body(Buffer.from('x')));
    const result2 = await downloadToFile(`${BASE}/x.tgz`, join(dir, 'y.tgz'), evil);
    assert.equal(result2.ok, false);
    if (!result2.ok) assert.equal(result2.code, 'ERR-REL-ACQUIRE-REDIRECT');

    // Non-HTTPS redirect target.
    const downgrade: ReleaseFetcher = async (url, depth) => (depth === 0 ? { status: 302, location: 'http://release-assets.githubusercontent.com/x.tgz', body: Readable.from([]) } : body(Buffer.from('x')));
    const result3 = await downloadToFile(`${BASE}/x.tgz`, join(dir, 'z.tgz'), downgrade);
    assert.equal(result3.ok, false);
    if (!result3.ok) assert.equal(result3.code, 'ERR-REL-ACQUIRE-REDIRECT');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: redirect loops and excess redirects are refused', async () => {
  const dir = tempDir();
  try {
    const loop: ReleaseFetcher = async (url, depth) => ({ status: 302, location: `${BASE}/loop.tgz`, body: Readable.from([]) });
    const result = await downloadToFile(`${BASE}/loop.tgz`, join(dir, 'x.tgz'), loop);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-REL-ACQUIRE-REDIRECT');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: HTTP error statuses are refused', async () => {
  const dir = tempDir();
  try {
    for (const status of [404, 403, 500, 301]) {
      const fetcher: ReleaseFetcher = async () => ({ status, body: Readable.from([Buffer.from('nope')]) });
      const result = await downloadToFile(`${BASE}/x.tgz`, join(dir, 'x.tgz'), fetcher);
      if (status === 301) {
        // redirect without Location must be refused as a redirect error
        assert.equal(result.ok, false);
      } else {
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.code, 'ERR-REL-ACQUIRE-STATUS');
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: body stream failure mid-download removes the file', async () => {
  const dir = tempDir();
  try {
    const broken = new Readable({ read() {} });
    const fetcher: ReleaseFetcher = async () => ({ status: 200, body: broken, contentLength: 100 });
    const dest = join(dir, 'x.tgz');
    const promise = downloadToFile(`${BASE}/x.tgz`, dest, fetcher);
    setImmediate(() => broken.emit('error', new Error('socket hang up')));
    const result = await promise;
    assert.equal(result.ok, false);
    assert.equal(existsSync(dest), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireVerifiedFile: unsafe file names are refused before any fetch', async () => {
  const dir = tempDir();
  try {
    let called = false;
    const fetcher: ReleaseFetcher = async () => {
      called = true;
      return body(Buffer.from('x'));
    };
    const result = await acquireVerifiedFile(BASE, '../evil.tgz', sha256(Buffer.from('x')), dir, fetcher);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-REL-ACQUIRE-FILENAME');
    assert.equal(called, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireVerifiedFile: digest mismatch refuses and removes the unverified bytes', async () => {
  const dir = tempDir();
  try {
    const bytes = Buffer.from('payload');
    const fetcher: ReleaseFetcher = async () => body(bytes);
    const result = await acquireVerifiedFile(BASE, 'gateway.tgz', 'f'.repeat(64), dir, fetcher);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'ERR-REL-ACQUIRE-DIGEST-MISMATCH');
    assert.equal(existsSync(join(dir, 'gateway.tgz')), false, 'unverified bytes must never remain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquireVerifiedFile: success returns the verified path', async () => {
  const dir = tempDir();
  try {
    const bytes = Buffer.from('verified-payload');
    const fetcher: ReleaseFetcher = async (url) => {
      assert.equal(url, `${BASE}/gateway.tgz`);
      return body(bytes);
    };
    const result = await acquireVerifiedFile(BASE, 'gateway.tgz', sha256(bytes), dir, fetcher);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(readFileSync(result.path!), bytes);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: redirect response bodies are disposed before the next hop (F-08)', async () => {
  const dir = tempDir();
  try {
    let firstBodyDestroyed = false;
    const redirectBody = {
      destroy: () => {
        firstBodyDestroyed = true;
      },
      on: () => redirectBody,
    } as unknown as NodeJS.ReadableStream;
    const bytes = Buffer.from('final-bytes');
    const fetcher: ReleaseFetcher = async (url, depth) => (depth === 0 ? { status: 302, location: 'https://release-assets.githubusercontent.com/x.tgz', body: redirectBody } : body(bytes));
    const result = await downloadToFile(`${BASE}/x.tgz`, join(dir, 'x.tgz'), fetcher);
    assert.equal(result.ok, true, 'the followed redirect must still succeed');
    assert.equal(firstBodyDestroyed, true, 'the redirect response body must be disposed before continuing');

    // Error responses are disposed too.
    let errorBodyDestroyed = false;
    const errorBody = { destroy: () => { errorBodyDestroyed = true; }, on: () => errorBody } as unknown as NodeJS.ReadableStream;
    const failing: ReleaseFetcher = async () => ({ status: 404, body: errorBody });
    const result2 = await downloadToFile(`${BASE}/x.tgz`, join(dir, 'y.tgz'), failing);
    assert.equal(result2.ok, false);
    assert.equal(errorBodyDestroyed, true, 'the error response body must be disposed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('acquire: the redirect allowlist is minimal and GitHub-release-shaped (F-04)', () => {
  // Hosts observed as REQUIRED by the release-asset flow:
  // github.com (origin hop) and release-assets.githubusercontent.com
  // (actual release-asset delivery host).
  for (const host of ['github.com', 'release-assets.githubusercontent.com']) {
    assert.equal(RELEASE_REDIRECT_ALLOWLIST.has(host), true, host);
  }
  // Hosts explicitly NOT required by this flow and therefore refused:
  for (const host of ['www.github.com', 'objects.githubusercontent.com', 'codeload.github.com', 'evil.example', 'raw.githubusercontent.com']) {
    assert.equal(RELEASE_REDIRECT_ALLOWLIST.has(host), false, host);
  }
  assert.equal(MAX_REDIRECTS, 5);
});
