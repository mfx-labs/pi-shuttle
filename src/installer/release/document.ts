/** Shared closed-document primitives for release metadata schemas. */

export const RELEASE_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export type ReleaseUnknownRecord = Readonly<Record<string, unknown>>;

/** A JSON object with no unknown fields. Required-field checks stay schema-local. */
export function closedObject(value: unknown, allowedKeys: readonly string[], _label: string): ReleaseUnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as ReleaseUnknownRecord;
  return Object.keys(record).every((key) => allowedKeys.includes(key)) ? record : null;
}
