import { describe, it, expect } from 'vitest';
import { caseToken, TOKEN_RE, findTokens } from '../../../src/core/parsers/test-plan-token.js';

describe('test-plan-token', () => {
  it('builds a change-prefixed token from change name + id [add-test-plan-artifact-T4]', () => {
    expect(caseToken('add-test-plan-artifact', 'T3')).toBe('[add-test-plan-artifact-T3]');
  });
  it('TOKEN_RE matches and captures change + id', () => {
    const m = TOKEN_RE.exec('it("foo [add-test-plan-artifact-T3]", ...)');
    expect(m?.groups).toEqual({ change: 'add-test-plan-artifact', n: '3' });
  });
  it('findTokens returns all tokens in a blob', () => {
    const out = findTokens('a [c1-T1] b [c2-T2] [c1-T1]');
    expect(out.map((t) => t.token)).toEqual(['[c1-T1]', '[c2-T2]', '[c1-T1]']);
  });
});
