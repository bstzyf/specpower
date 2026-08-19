import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions } from '../../src/utils/version.js';

describe('parseVersion', () => {
  it('parses release versions', () => {
    expect(parseVersion('0.2.2')).toEqual({
      major: 0,
      minor: 2,
      patch: 2,
      pre: null,
    });
  });

  it('parses prerelease versions', () => {
    expect(parseVersion('0.2.3-0')).toEqual({
      major: 0,
      minor: 2,
      patch: 3,
      pre: ['0'],
    });
    expect(parseVersion('1.2.3-beta.4')?.pre).toEqual(['beta', '4']);
  });

  it('ignores build metadata', () => {
    expect(parseVersion('1.0.0+4')?.pre).toBeNull();
  });

  it('rejects non-semver strings', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compares core numerically', () => {
    expect(compareVersions('0.2.2', '0.2.3')).toBe(-1);
    expect(compareVersions('0.2.3', '0.2.2')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('returns 0 for equal releases', () => {
    expect(compareVersions('0.2.3', '0.2.3')).toBe(0);
  });

  it('treats prerelease as lower than the same release', () => {
    // the core case for the init-drift feature: 0.2.3-0 < 0.2.3
    expect(compareVersions('0.2.3-0', '0.2.3')).toBe(-1);
    expect(compareVersions('0.2.3', '0.2.3-0')).toBe(1);
  });

  it('orders prereleases of the same core', () => {
    expect(compareVersions('0.2.3-0', '0.2.3-1')).toBe(-1);
    expect(compareVersions('0.2.3-beta.1', '0.2.3-rc.1')).toBe(-1);
    expect(compareVersions('0.2.3-1', '0.2.3-0')).toBe(1);
  });

  it('prerelease of a higher core is still greater than lower core', () => {
    // 0.2.3-0 is newer than 0.2.2 (core dominates)
    expect(compareVersions('0.2.3-0', '0.2.2')).toBe(1);
    expect(compareVersions('0.2.2', '0.2.3-0')).toBe(-1);
  });

  it('falls back to string compare for non-semver inputs but equal-but-malformed is 0', () => {
    expect(compareVersions('foo', 'foo')).toBe(0);
  });
});
