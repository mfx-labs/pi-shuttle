/**
 * Bounded JSON intake for pi-shuttle-owned configuration/state documents
 * (PS-2). Mirrors the Gateway startup-config discipline without copying any
 * Gateway code: fd-bound read with a byte ceiling, then a raw duplicate-key
 * scan, then JSON.parse. Ordinary local config/state persistence — NOT
 * trusted Gateway storage; the two authority classes stay visibly separate.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** Byte ceiling for pi-shuttle-owned documents (same ceiling as the Gateway startup document). */
export const MAX_CONFIG_BYTES = 1024 * 1024;

export type TextReadResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: string; readonly message: string };

/** Read a text file with a hard byte ceiling (fd-bound; never unbounded). */
export function readBoundedTextFile(path: string): TextReadResult {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (stat.size > MAX_CONFIG_BYTES) {
      return { ok: false, code: 'ERR-PS2-READ-TOO-LARGE', message: `${path} exceeds the byte ceiling (${MAX_CONFIG_BYTES} bytes)` };
    }
    const buffer = Buffer.allocUnsafe(MAX_CONFIG_BYTES + 1);
    let total = 0;
    while (total <= MAX_CONFIG_BYTES) {
      const n = readSync(fd, buffer, total, MAX_CONFIG_BYTES + 1 - total, total);
      if (n <= 0) break;
      total += n;
    }
    if (total > MAX_CONFIG_BYTES) {
      return { ok: false, code: 'ERR-PS2-READ-TOO-LARGE', message: `${path} exceeds the byte ceiling (${MAX_CONFIG_BYTES} bytes)` };
    }
    return { ok: true, text: buffer.subarray(0, total).toString('utf8') };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, code: code === 'ENOENT' ? 'absent' : 'ERR-PS2-READ-FAILED', message: `${path} could not be read (${code ?? 'unknown error'})` };
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort close; the result stands
      }
    }
  }
}

export type JsonParseResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

/**
 * Raw duplicate-key scan (correct on any JSON text): tokenizes just enough
 * to find object keys at every nesting level, with full string-escape
 * handling, so `{"a":1,"a":2}` AND `{"a":1,"\u0061":2}` are both rejected.
 * JSON.parse alone would silently keep the last duplicate; this scan runs
 * first. Unbalanced/truncated text returns null here and JSON.parse rejects
 * it below (fail closed either way).
 */
export function findDuplicateKey(json: string): string | null {
  try {
    let i = 0;
    const n = json.length;
    // Stack of object key sets; null entry = array level (indices are not keys).
    const stack: (Set<string> | null)[] = [new Set<string>()];
    while (i < n) {
      const ch = json[i];
      if (ch === '"') {
        const { key, end } = readJsonString(json, i);
        i = end;
        let j = i;
        while (j < n && (json[j] === ' ' || json[j] === '\t' || json[j] === '\n' || json[j] === '\r')) j++;
        if (json[j] === ':') {
          const top = stack[stack.length - 1]!;
          if (top !== null) {
            if (top.has(key)) return key;
            top.add(key);
          }
        }
        continue;
      }
      if (ch === '{') {
        stack.push(new Set<string>());
        i++;
        continue;
      }
      if (ch === '[') {
        stack.push(null);
        i++;
        continue;
      }
      if (ch === '}' || ch === ']') {
        stack.pop();
        i++;
        continue;
      }
      i++;
    }
    return null;
  } catch {
    return null; // malformed text; JSON.parse rejects it below
  }
}

/** Read one JSON string starting at `start` (the opening quote). Decodes escapes. */
function readJsonString(json: string, start: number): { readonly key: string; readonly end: number } {
  let i = start + 1;
  let out = '';
  while (i < json.length) {
    const ch = json[i];
    if (ch === '"') return { key: out, end: i + 1 };
    if (ch === '\\') {
      const esc = json[i + 1];
      switch (esc) {
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '/': out += '/'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'u': out += String.fromCharCode(parseInt(json.slice(i + 2, i + 6), 16)); i += 4; break;
        default: out += esc; break;
      }
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return { key: out, end: i };
}

export type ParsedJsonResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

/** Duplicate-key-rejecting JSON parse (scan first, then parse). */
export function parseJsonRejectingDuplicates(text: string): ParsedJsonResult {
  const duplicate = findDuplicateKey(text);
  if (duplicate !== null) {
    return { ok: false, message: `duplicate object key: ${duplicate}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, message: `document is not valid JSON: ${(err as Error).message}` };
  }
}
