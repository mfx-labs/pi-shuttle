/**
 * PS-8A release acquisition: HTTPS-only download of release assets with
 * strict failure behavior, digest verification BEFORE any use, and no
 * activation on any failure. Used ONLY by the release installer
 * bootstrap — there is no generic arbitrary-download facility and no
 * operator command exposes this module.
 *
 * Policy:
 * - every hop (initial request and every redirect) must be HTTPS;
 * - redirect destinations are constrained to a fixed host allowlist
 *   (GitHub release hosting); the initial URL is constructed by the
 *   bootstrap from the code-constant release base URL (or an explicit
 *   operator QA override — never from untrusted manifest content, which
 *   carries file names only, never hosts);
 * - bounded redirect count; truncated bodies fail closed; mismatched
 *   digests fail closed and the unverified bytes are removed;
 * - downloads land in an owner-controlled staging directory with 0600
 *   permissions.
 */
import { createWriteStream, rmSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { join } from 'node:path';
import { hashFile } from '../artifact.js';
import { RELEASE_FILE_NAME_RE } from './envelope.js';

export const RELEASE_BASE_URL_PREFIX = 'https://github.com/mfx-labs/pi-shuttle/releases/download';
export const MAX_REDIRECTS = 5;
export const RELEASE_FETCH_TIMEOUT_MS = 60_000;
export const RELEASE_FETCH_MAX_BYTES = 1024 * 1024 * 1024; // 1 GiB hard cap per asset

/** The version-pinned release base URL (fixed prefix + validated version). */
export function releaseBaseUrlFor(version: string): string {
  return `${RELEASE_BASE_URL_PREFIX}/v${version}`;
}

/**
 * Fixed redirect destination allowlist (GitHub release hosting).
 * Minimal by observed necessity (F-04): the release flow only ever
 * requests `releases/download/<v>/<file>` URLs, whose redirects land on
 * the GitHub release-asset delivery host; github.com is retained as the
 * origin-host hop (e.g. the login redirect for an unauthenticated
 * private repo — still fail-closed at digest verification). Hosts not
 * observed in this flow (www.github.com, codeload.github.com,
 * objects.githubusercontent.com) are NOT retained.
 */
export const RELEASE_REDIRECT_ALLOWLIST: ReadonlySet<string> = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
]);

export type AcquireResult = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

export interface FetchResponse {
  readonly status: number;
  readonly location?: string;
  readonly body: NodeJS.ReadableStream;
  readonly contentLength?: number;
}

/** Injectable fetcher seam (unit tests only; production uses defaultFetcher). */
export type ReleaseFetcher = (url: string, redirectDepth: number) => Promise<FetchResponse>;

function fail(code: string, message: string): AcquireResult {
  return { ok: false, code, message };
}

/** Default HTTPS fetcher: one GET, no redirect following (the caller owns the policy). */
export async function defaultFetcher(url: string): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, { headers: { 'user-agent': 'pi-shuttle-release-installer/0.1.0' } }, (response) => {
      const lengthHeader = response.headers['content-length'];
      resolve({
        status: response.statusCode ?? 0,
        location: response.headers.location,
        body: response,
        contentLength: lengthHeader === undefined ? undefined : Number(lengthHeader),
      });
    });
    request.setTimeout(RELEASE_FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error(`release asset fetch timed out after ${RELEASE_FETCH_TIMEOUT_MS}ms`));
    });
    request.on('error', reject);
  });
}

/**
 * Download `url` to `dest` following the redirect policy. The caller
 * provides `dest` inside its own owner-controlled directory; the file is
 * created 0600 and removed on any failure (never leaves partial bytes).
 */
export async function downloadToFile(url: string, dest: string, fetcher: ReleaseFetcher = defaultFetcher): Promise<AcquireResult> {
  let current = url;
  for (let depth = 0; depth <= MAX_REDIRECTS; depth += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return fail('ERR-REL-ACQUIRE-URL', `release asset URL is malformed: ${current}`);
    }
    if (parsed.protocol !== 'https:') {
      return fail('ERR-REL-ACQUIRE-PROTOCOL', `release acquisition requires HTTPS (refused: ${parsed.protocol}//${parsed.host})`);
    }

    let response: FetchResponse;
    try {
      response = await fetcher(current, depth);
    } catch (err) {
      return fail('ERR-REL-ACQUIRE-NETWORK', `release asset fetch failed (${(err as Error).message})`);
    }

    if (response.status >= 300 && response.status < 400) {
      if (depth === MAX_REDIRECTS) {
        return fail('ERR-REL-ACQUIRE-REDIRECT', `release asset fetch exceeded ${MAX_REDIRECTS} redirects`);
      }
      if (response.location === undefined) {
        return fail('ERR-REL-ACQUIRE-REDIRECT', 'release asset redirect response carries no Location header');
      }
      let next: URL;
      try {
        next = new URL(response.location, current);
      } catch {
        return fail('ERR-REL-ACQUIRE-REDIRECT', `release asset redirect target is malformed: ${response.location}`);
      }
      if (next.protocol !== 'https:') {
        return fail('ERR-REL-ACQUIRE-REDIRECT', `release asset redirect to non-HTTPS destination refused: ${next.protocol}//${next.host}`);
      }
      if (!RELEASE_REDIRECT_ALLOWLIST.has(next.hostname)) {
        return fail('ERR-REL-ACQUIRE-REDIRECT', `release asset redirect to unexpected host refused: ${next.hostname}`);
      }
      // F-08: dispose the redirect response body before the next hop so the
      // socket is not left occupied (redirect bodies are never consumed).
      (response.body as unknown as { destroy?: () => void }).destroy?.();
      current = next.toString();
      continue;
    }

    if (response.status !== 200) {
      // F-08: dispose the error response body; it is never consumed.
      (response.body as unknown as { destroy?: () => void }).destroy?.();
      return fail('ERR-REL-ACQUIRE-STATUS', `release asset fetch failed (HTTP ${response.status})`);
    }

    return await writeBodyToFile(response, dest);
  }
  return fail('ERR-REL-ACQUIRE-REDIRECT', `release asset fetch exceeded ${MAX_REDIRECTS} redirects`);
}

/** Stream a 200 body to `dest` (0600, exclusive), enforcing size limits and truncation detection. */
function writeBodyToFile(response: FetchResponse, dest: string): Promise<AcquireResult> {
  return new Promise((resolve) => {
    let written = 0;
    let settled = false;
    const cleanup = (): void => {
      try {
        rmSync(dest, { force: true });
      } catch {
        // best-effort; the failure result stands
      }
    };
    const finish = (result: AcquireResult): void => {
      if (settled) return;
      settled = true;
      if (!result.ok) cleanup();
      resolve(result);
    };
    let stream;
    try {
      stream = createWriteStream(dest, { flags: 'wx', mode: 0o600 });
    } catch (err) {
      finish(fail('ERR-REL-ACQUIRE-WRITE', `release asset could not be written (${(err as Error).message})`));
      return;
    }
    stream.on('error', (err) => finish(fail('ERR-REL-ACQUIRE-WRITE', `release asset write failed (${err.message})`)));
    stream.on('finish', () => {
      const expected = response.contentLength;
      if (expected !== undefined && written !== expected) {
        finish(fail('ERR-REL-ACQUIRE-TRUNCATED', `release asset download was truncated (received ${written} of ${expected} bytes)`));
        return;
      }
      finish({ ok: true });
    });
    response.body.on('data', (chunk: Buffer) => {
      written += chunk.length;
      if (written > RELEASE_FETCH_MAX_BYTES) {
        (response.body as unknown as { destroy?: () => void }).destroy?.();
        stream.destroy();
        finish(fail('ERR-REL-ACQUIRE-SIZE', `release asset exceeds the ${RELEASE_FETCH_MAX_BYTES}-byte limit`));
        return;
      }
      if (!stream.write(chunk)) {
        response.body.pause?.();
        stream.once('drain', () => response.body.resume?.());
      }
    });
    response.body.on('error', (err) => finish(fail('ERR-REL-ACQUIRE-NETWORK', `release asset body failed mid-download (${err.message})`)));
    response.body.on('end', () => stream.end());
  });
}

/**
 * Download + digest-verify one release asset. The file is written only
 * after a successful download, verified against the expected SHA-256
 * before it is returned, and removed on ANY failure — unverified bytes
 * are never left in place and never reach the installer core.
 */
export async function acquireVerifiedFile(baseUrl: string, fileName: string, expectedSha256: string, destDir: string, fetcher?: ReleaseFetcher): Promise<AcquireResult & { readonly path?: string }> {
  if (!RELEASE_FILE_NAME_RE.test(fileName)) {
    return fail('ERR-REL-ACQUIRE-FILENAME', `release asset file name is not a single safe component: ${fileName}`);
  }
  try {
    mkdirSync(destDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    return fail('ERR-REL-ACQUIRE-WRITE', `release staging directory could not be created (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  const dest = join(destDir, fileName);
  const downloaded = await downloadToFile(`${baseUrl}/${fileName}`, dest, fetcher);
  if (!downloaded.ok) return downloaded;
  let sha256: string;
  try {
    sha256 = await hashFile(dest);
  } catch (err) {
    return fail('ERR-REL-ACQUIRE-WRITE', `downloaded release asset could not be read back (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  if (sha256 !== expectedSha256) {
    try {
      rmSync(dest, { force: true });
    } catch {
      // best-effort
    }
    return fail('ERR-REL-ACQUIRE-DIGEST-MISMATCH', `release asset ${fileName} digest mismatch: computed ${sha256}, expected ${expectedSha256}`);
  }
  return { ok: true, path: dest };
}
