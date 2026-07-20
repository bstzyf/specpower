/**
 * Lightweight SemVer comparison for specpower's own version strings.
 *
 * We avoid adding the `semver` package as a runtime dependency: the only
 * versions ever compared here are this package's own `package.json` version
 * (which we author), so a small, well-tested implementation covering
 * `MAJOR.MINOR.PATCH` plus an optional prerelease is sufficient and keeps the
 * dependency footprint unchanged. Build metadata (`+...`) is ignored, matching
 * SemVer precedence rules.
 */

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Prerelease identifiers, or `null` when the version is a release. */
  readonly pre: readonly string[] | null;
}

const VERSION_PATTERN =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Parses a SemVer string into its components. Returns `null` for anything that
 * is not strictly `MAJOR.MINOR.PATCH` with optional prerelease/build.
 */
export function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(VERSION_PATTERN);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : null,
  };
}

/**
 * Compares two prerelease identifier arrays per SemVer precedence:
 * - A release (no prerelease) is greater than any prerelease of the same core.
 * - Prerelease identifiers are compared left to right; numeric identifiers are
 *   compared numerically and are lower than alphanumeric ones; missing
 *   identifier on one side means that side is the smaller.
 */
function comparePrerelease(
  a: readonly string[],
  b: readonly string[],
): number {
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined) return -1; // shorter prerelease is smaller
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (aNum) {
      return -1; // numeric < alphanumeric
    } else if (bNum) {
      return 1;
    } else if (ai < bi) {
      return -1;
    } else if (ai > bi) {
      return 1;
    }
  }
  return 0;
}

/**
 * Compares two SemVer version strings.
 *
 * @returns `-1` if `a < b`, `0` if equal, `1` if `a > b`. Returns `0` when
 *   both strings are identical but neither parses as strict SemVer, so that
 *   malformed-but-equal versions do not trigger a false "newer" result.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    return a === b ? 0 : a < b ? -1 : 1;
  }

  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;

  // Core equal: release > prerelease.
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return comparePrerelease(pa.pre, pb.pre);
}
