#!/usr/bin/env bash
#
# PS-6 Lane B fixture-source validation (test/CI evidence only; SIR-PS6-002
# correction). The workflow passes the workflow_dispatch input through the
# workflow `env:` plumbing so it is DATA, never shell syntax; this script
# strictly validates the value BEFORE any curl invocation and fails closed
# on anything outside the closed URL policy:
#
#   - must start with exactly `https://`;
#   - characters limited to the closed URL-safe set
#     [A-Za-z0-9 . / : _ % ~ -] (no query strings, no fragments);
#   - no whitespace, quotes, `$()`, backticks, semicolons, newlines, or
#     any other shell metacharacter.
#
# Usage:
#   scripts/ci-validate-fixture-source.sh <value>   # exit 0 valid; 2 invalid
#   scripts/ci-validate-fixture-source.sh --selftest  # adversarial self-checks
set -euo pipefail

# (allowed set enforced via POSIX tr below — see validate_fixture_source)

validate_fixture_source() {
  local value="$1"
  if [ -z "$value" ]; then
    echo "fixture source: empty value is invalid" >&2
    return 2
  fi
  case "$value" in
    https://*) ;;
    *)
      echo "fixture source: must be an https:// URL (got: ${value:0:64})" >&2
      return 2
      ;;
  esac
  # Closed character set enforced over the WHOLE value (not line-based:
  # grep -E would let a second injected line pass). Any character outside
  # the allowed set — whitespace, newline, quotes, `$()`, backticks,
  # semicolons, pipes, redirects — survives `tr -d` and fails the check.
  local leftover
  leftover="$(printf '%s' "$value" | tr -d 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789./:_%~-')"
  if [ -n "$leftover" ]; then
    echo "fixture source: value contains characters outside the closed URL-safe set (no whitespace, quotes, substitution, metacharacters)" >&2
    return 2
  fi
  echo "fixture source: validated (argv-safe; will be fetched with 'curl --')"
  return 0
}

selftest() {
  local failures=0
  # Accepted: plain https URL within the closed set.
  if ! validate_fixture_source "https://example.org/fixtures/ps6-fixtures-0.1.0.tgz" >/dev/null 2>&1; then
    echo "selftest FAIL: plain https URL must be accepted" >&2; failures=$((failures + 1))
  fi
  # Rejected adversarial cases (quote, $(), backticks, semicolon, newline, whitespace, non-https).
  local bad
  for bad in \
    'http://example.org/x.tgz' \
    'https://example.org/x.tgz;' \
    'https://example.org/x.tgz;rm -rf /' \
    'https://example.org/x.tgz$(id)' \
    'https://example.org/x.tgz$(curl evil)' \
    'https://example.org/`id`.tgz' \
    'https://example.org/x.tgz" extra' \
    "'https://example.org/x.tgz'" \
    'https://example.org/x y.tgz' \
    'https://example.org/x.tgz?a=b&c=d' \
    'https://example.org/x.tgz#frag' \
    'ftp://example.org/x.tgz' \
    'file:///etc/passwd' \
    'https://example.org/x.tgz
touch /tmp/ps6-injected' \
    'https://example.org/x.tgz	' \
    ''; do
    if validate_fixture_source "$bad" >/dev/null 2>&1; then
      echo "selftest FAIL: adversarial value must be rejected: $(printf '%q' "$bad" | head -c 60)" >&2
      failures=$((failures + 1))
    fi
  done
  if [ "$failures" -ne 0 ]; then
    echo "selftest: $failures failure(s)" >&2
    return 1
  fi
  echo "selftest: all adversarial fixture-source cases behave as required"
  return 0
}

if [ "${1:-}" = "--selftest" ]; then
  selftest
  exit $?
fi
validate_fixture_source "${1:-}"
