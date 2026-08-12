/**
 * PS-3 structural archive scanner (SIR-PS3-001/003): pi-shuttle OWNS the
 * extraction policy. Before any extraction, every archive member is
 * parsed from the gzip/tar byte stream (Node core only — no external tar,
 * no locale dependence, no line-based parsing) and must satisfy the
 * closed v0.1.0 policy:
 *
 *   - regular files ('0', '\0', '7') and directories ('5') ONLY;
 *   - resolved member name (ustar name+prefix, GNU longname 'L', pax
 *     'path' override — the same resolution the extractor applies) must
 *     be relative, free of any `..` / `.` / empty component, non-empty;
 *   - absolute names, symlinks, hardlinks, FIFOs, devices, sockets, pax
 *     global headers ('g'), and every other special/meta type are
 *     REJECTED before extraction;
 *   - malformed headers (checksum mismatch), truncated archives (missing
 *     end-of-archive marker), malformed pax records, and scanner limits
 *     (member count / uncompressed bytes) fail closed.
 *
 * The real npm-pack Gateway artifact contains only regular-file members,
 * so no extra archive capability is preserved for generality.
 *
 * Defense in depth: `regularFileOrNull` / `readJsonFileIfRegular` refuse
 * to open (or read) non-regular paths — a FIFO/symlink/device can never
 * be synchronously opened by the installer (SIR-PS3-001 FIFO hang).
 */
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { createGunzip } from 'node:zlib';

export type ScanResult = { readonly ok: true; readonly memberCount: number } | { readonly ok: false; readonly code: string; readonly message: string };

/** Sanity bounds (npm-pack artifacts are ~1 MB / hundreds of members). */
export const MAX_ARCHIVE_MEMBERS = 100_000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 GiB

/** Allowed typeflags: '0'/'7'/NUL = regular, '5' = directory. */
const REGULAR_TYPES = new Set(['0', '\0', '7']);
const DIRECTORY_TYPE = '5';
/** Explicitly rejected special/meta types. */
const REJECTED_TYPES = new Set(['1', '2', '3', '4', '6', 'g', 'M', 'N']);

interface Header {
  readonly name: string;
  readonly typeflag: string;
  readonly size: number;
  readonly prefix: string;
}

/** Parse one 512-byte tar header block; null when malformed (checksum mismatch etc.). */
function parseHeader(block: Buffer): Header | null {
  if (block.length < 512) return null;
  const name = field(block, 0, 100);
  const size = parseOctal(block, 124, 12);
  const typeflag = String.fromCharCode(block[156] ?? 0);
  const prefix = field(block, 345, 155);
  const checksum = parseOctal(block, 148, 8);
  if (size === null || checksum === null) return null;
  if (!verifyChecksum(block, checksum)) return null;
  return { name, typeflag, size, prefix };
}

/** NUL-trimmed fixed-width header field. */
function field(block: Buffer, offset: number, length: number): string {
  const end = block.indexOf(0, offset);
  const slice = block.subarray(offset, end >= 0 && end < offset + length ? end : offset + length);
  return slice.toString('utf8');
}

/** Parse an octal (possibly base-256) size/checksum field. */
function parseOctal(block: Buffer, offset: number, length: number): number | null {
  const bytes = block.subarray(offset, offset + length);
  if (bytes.length === 0) return null;
  if ((bytes[0]! & 0x80) !== 0) {
    // base-256 encoding
    let value = bytes[0]! & 0x7f;
    for (let i = 1; i < bytes.length; i++) value = value * 256 + bytes[i]!;
    return value;
  }
  const text = bytes.toString('utf8').replace(/\0/g, '').trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) return null;
  return parseInt(text, 8);
}

/** Standard tar header checksum: sum of bytes with the checksum field as spaces. */
function verifyChecksum(block: Buffer, recorded: number): boolean {
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < 512; i++) {
    const byte = block[i] ?? 0;
    const value = i >= 148 && i < 156 ? 0x20 : byte;
    unsigned += value;
    signed += value > 127 ? value - 256 : value;
  }
  return recorded === unsigned || recorded === signed;
}

/**
 * Scan an artifact (gzip-compressed tar) member-by-member against the
 * closed extraction policy. Streaming and bounded: member payloads are
 * skipped without buffering; the scanner never opens or reads member
 * content. A truncated archive (no end-of-archive marker) always fails
 * closed.
 */
export function scanArtifactMembers(artifactPath: string): Promise<ScanResult> {
  return new Promise((resolve) => {
    const gunzip = createGunzip();
    const stream = createReadStream(artifactPath);
    let carry: Buffer = Buffer.alloc(0);
    let memberCount = 0;
    let totalBytes = 0;
    let gnuLongName: string | null = null;
    let paxPath: string | null = null;
    let paxSize: number | null = null;
    let failed = false;
    let pendingChunks: Buffer[] = [];
    let chunkResolvers: Array<(c: Buffer | null) => void> = [];
    let gunzipEnded = false;

    const fail = (code: string, message: string): void => {
      if (failed) return;
      failed = true;
      stream.destroy();
      gunzip.destroy();
      resolve({ ok: false, code, message });
    };

    function nextChunk(): Promise<Buffer | null> {
      if (pendingChunks.length > 0) return Promise.resolve(pendingChunks.shift()!);
      if (gunzipEnded) return Promise.resolve(null);
      return new Promise((res) => chunkResolvers.push(res));
    }

    /** Take exactly `n` bytes, or null at end of the decompressed stream. */
    const take = async (n: number): Promise<Buffer | null> => {
      while (carry.length < n) {
        const chunk = await nextChunk();
        if (chunk === null) return null;
        carry = Buffer.concat([carry, chunk]);
      }
      const out = carry.subarray(0, n);
      carry = carry.subarray(n);
      return out;
    };

    stream.on('data', (d: Buffer) => gunzip.write(d));
    stream.on('error', (err: NodeJS.ErrnoException) => fail('ERR-PS3-ARTIFACT-SCAN', `artifact could not be read (${err.code ?? err.message})`));
    stream.on('end', () => gunzip.end());
    gunzip.on('data', (d: Buffer) => {
      if (failed) return;
      if (chunkResolvers.length > 0) chunkResolvers.shift()!(d);
      else pendingChunks.push(d);
    });
    gunzip.on('error', (err: Error) => {
      while (chunkResolvers.length > 0) chunkResolvers.shift()!(null);
      gunzipEnded = true;
      fail('ERR-PS3-ARTIFACT-SCAN', `artifact is not a valid gzip archive (${err.message})`);
    });
    gunzip.on('end', () => {
      gunzipEnded = true;
      while (chunkResolvers.length > 0) chunkResolvers.shift()!(null);
    });

    (async () => {
      let zeroBlocks = 0;
      for (;;) {
        const block = await take(512);
        if (block === null) {
          fail('ERR-PS3-ARTIFACT-SCAN', 'artifact is truncated (no end-of-archive marker)');
          return;
        }
        if (block.every((b) => b === 0)) {
          zeroBlocks += 1;
          if (zeroBlocks >= 2) {
            // end-of-archive; ignore trailing padding like the extractor does
            resolve({ ok: true, memberCount });
            return;
          }
          continue;
        }
        zeroBlocks = 0;
        if (memberCount >= MAX_ARCHIVE_MEMBERS) {
          fail('ERR-PS3-ARTIFACT-SCAN', `artifact exceeds the member limit (${MAX_ARCHIVE_MEMBERS})`);
          return;
        }
        const header = parseHeader(block);
        if (header === null) {
          fail('ERR-PS3-ARTIFACT-SCAN', 'artifact contains a malformed tar header (checksum mismatch)');
          return;
        }

        if (header.typeflag === 'L') {
          const data = await takePadded(header.size);
          if (data === null) {
            fail('ERR-PS3-ARTIFACT-SCAN', 'artifact is truncated inside a long-name header');
            return;
          }
          gnuLongName = field(data, 0, header.size);
          continue;
        }
        if (header.typeflag === 'x') {
          const data = await takePadded(header.size);
          if (data === null) {
            fail('ERR-PS3-ARTIFACT-SCAN', 'artifact is truncated inside a pax header');
            return;
          }
          const records = parsePaxRecords(data.subarray(0, header.size));
          if (records === null) {
            fail('ERR-PS3-ARTIFACT-SCAN', 'artifact contains a malformed pax header');
            return;
          }
          if (records.path !== undefined) {
            if (records.path.length === 0) {
              fail('ERR-PS3-ARTIFACT-SCAN', 'artifact contains an empty pax path override');
              return;
            }
            paxPath = records.path;
          }
          if (records.size !== undefined) paxSize = records.size;
          continue;
        }
        if (header.typeflag === 'K') {
          // GNU long linkname — irrelevant: link members are rejected regardless.
          await skip(header.size);
          continue;
        }
        if (REJECTED_TYPES.has(header.typeflag)) {
          fail('ERR-PS3-ARTIFACT-SCAN', `artifact contains an unsupported member type '${header.typeflag}' (${typeName(header.typeflag)}); only regular files and directories are accepted`);
          return;
        }
        if (!REGULAR_TYPES.has(header.typeflag) && header.typeflag !== DIRECTORY_TYPE) {
          fail('ERR-PS3-ARTIFACT-SCAN', `artifact contains an unknown member type '${header.typeflag}'; refusing the archive`);
          return;
        }

        const resolved = paxPath ?? gnuLongName ?? (header.prefix.length > 0 ? `${header.prefix}/${header.name}` : header.name);
        gnuLongName = null;
        paxPath = null;
        const sizeForSkip = paxSize ?? header.size;
        paxSize = null;
        totalBytes += sizeForSkip;
        if (totalBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
          fail('ERR-PS3-ARTIFACT-SCAN', `artifact exceeds the uncompressed size limit (${MAX_ARCHIVE_UNCOMPRESSED_BYTES} bytes)`);
          return;
        }

        const nameCheck = validateMemberName(resolved);
        if (!nameCheck.ok) {
          fail('ERR-PS3-ARTIFACT-SCAN', `artifact member ${JSON.stringify(resolved)} is rejected: ${nameCheck.message}`);
          return;
        }
        memberCount += 1;
        await skip(sizeForSkip);
      }

      async function skip(n: number): Promise<void> {
        // Tar payloads are block-padded (512-byte alignment): consume the
        // full padded extent so the next header stays aligned.
        let remaining = Math.ceil(n / 512) * 512;
        while (remaining > 0) {
          const chunk = await take(Math.min(remaining, 512));
          if (chunk === null) {
            fail('ERR-PS3-ARTIFACT-SCAN', 'artifact is truncated inside a member payload');
            return;
          }
          remaining -= chunk.length;
        }
      }

      /** Take a block-padded payload; returns the padded bytes (header data is the first `size` bytes). */
      async function takePadded(n: number): Promise<Buffer | null> {
        const padded = Math.ceil(n / 512) * 512;
        let out: Buffer = Buffer.alloc(0);
        let remaining = padded;
        while (remaining > 0) {
          const chunk = await take(Math.min(remaining, 512));
          if (chunk === null) return null;
          out = Buffer.concat([out, chunk]);
          remaining -= chunk.length;
        }
        return out;
      }
    })().catch((err: Error) => {
      if (!failed) fail('ERR-PS3-ARTIFACT-SCAN', `archive scan failed (${err.message})`);
    });
  });
}

function typeName(typeflag: string): string {
  switch (typeflag) {
    case '1': return 'hard link';
    case '2': return 'symbolic link';
    case '3': return 'character device';
    case '4': return 'block device';
    case '6': return 'FIFO';
    case 'g': return 'pax global header';
    default: return `type ${typeflag}`;
  }
}

/** Parse pax records ("len key=value\n"). Null when malformed. */
function parsePaxRecords(data: Buffer): { readonly path?: string; readonly size?: number } | null {
  const out: { path?: string; size?: number } = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space < 0) return null;
    const lenText = data.subarray(offset, space).toString('utf8');
    if (!/^[0-9]+$/.test(lenText)) return null;
    const len = parseInt(lenText, 10);
    if (len <= 0 || offset + len > data.length) return null;
    const record = data.subarray(space + 1, offset + len - 1).toString('utf8'); // strip trailing newline
    const eq = record.indexOf('=');
    if (eq < 0) return null;
    const key = record.slice(0, eq);
    const value = record.slice(eq + 1);
    if (key === 'path') out.path = value;
    else if (key === 'size') {
      if (!/^[0-9]+$/.test(value)) return null;
      out.size = parseInt(value, 10);
    }
    offset += len;
  }
  return out;
}

export type NameCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Closed member-name policy: relative, no `..` / `.` / empty component,
 * non-empty. The same resolution the extractor applies to ustar/pax/GNU
 * names, so an accepted name can never escape the extraction root.
 */
export function validateMemberName(name: string): NameCheck {
  if (name.length === 0) return { ok: false, message: 'empty member name' };
  if (name.startsWith('/')) return { ok: false, message: 'absolute member names are not allowed' };
  const normalized = name.endsWith('/') ? name.slice(0, -1) : name;
  if (normalized.length === 0) return { ok: false, message: 'member name is only a slash' };
  if (normalized === '.' || normalized === '..') return { ok: false, message: 'dot members are not allowed' };
  for (const component of normalized.split('/')) {
    if (component.length === 0) return { ok: false, message: 'empty path component (repeated separators) is not allowed' };
    if (component === '..') return { ok: false, message: 'parent traversal is not allowed' };
    if (component === '.') return { ok: false, message: 'dot components are not allowed' };
  }
  return { ok: true };
}

/** lstat a path and report whether it is a regular file (never opens special files). */
export function regularFileOrNull(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** Read a JSON file only when it is a regular file; null otherwise (never blocks on special files). */
export function readJsonFileIfRegular(path: string): string | null {
  if (!regularFileOrNull(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
