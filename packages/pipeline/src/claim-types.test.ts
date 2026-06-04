import { describe, expect, it } from 'vitest';

import { detectClaimType } from './claim-types.js';

function makeFinding(
  overrides: Partial<{ title: string; sourceAgent: string; dimension: string }> = {},
) {
  return {
    title: 'Some generic finding',
    sourceAgent: 'reviewer',
    dimension: 'correctness',
    ...overrides,
  };
}

describe('detectClaimType', () => {
  it('returns "security" when dimension is security', () => {
    expect(detectClaimType(makeFinding({ dimension: 'security' }))).toBe('security');
  });

  it('returns "security" when sourceAgent is security', () => {
    expect(detectClaimType(makeFinding({ sourceAgent: 'security', dimension: 'correctness' }))).toBe('security');
  });

  it('returns "bug" for off-by-one in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Off-by-one error in loop', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('bug');
  });

  it('returns "bug" for null dereference in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Potential null dereference', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('bug');
  });

  it('returns "bug" for race condition in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Race condition in async handler', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('bug');
  });

  it('returns "bug" for incorrect logic in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Incorrect boundary check', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('bug');
  });

  it('returns "missing-test" when sourceAgent is testing', () => {
    expect(detectClaimType(makeFinding({ sourceAgent: 'testing', dimension: 'testing', title: 'No coverage for new function' }))).toBe('missing-test');
  });

  it('returns "missing-test" when dimension is testing', () => {
    expect(detectClaimType(makeFinding({ dimension: 'testing', sourceAgent: 'reviewer', title: 'Untested edge case' }))).toBe('missing-test');
  });

  it('returns "missing-test" for "no test" in title', () => {
    expect(detectClaimType(makeFinding({ title: 'No test for parseConfig', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('missing-test');
  });

  it('returns "missing-test" for "untested" in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Untested async rejection path', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('missing-test');
  });

  it('returns "intent-gap" for pr-intent-gap agent', () => {
    expect(detectClaimType(makeFinding({ sourceAgent: 'pr-intent-gap', title: 'PR description mismatch', dimension: 'correctness' }))).toBe('intent-gap');
  });

  it('returns "intent-gap" for "intent" in title', () => {
    expect(detectClaimType(makeFinding({ title: 'PR intent not reflected in code', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('intent-gap');
  });

  it('returns "architecture" for "violation" in title', () => {
    expect(detectClaimType(makeFinding({ title: 'SOLID violation in service layer', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('architecture');
  });

  it('returns "architecture" for dimension design', () => {
    expect(detectClaimType(makeFinding({ dimension: 'design', sourceAgent: 'reviewer', title: 'Tight coupling between modules' }))).toBe('architecture');
  });

  it('returns "performance" for "slow" in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Slow linear scan on each request', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('performance');
  });

  it('returns "performance" for "memory leak" in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Memory leak in event listener', sourceAgent: 'reviewer', dimension: 'correctness' }))).toBe('performance');
  });

  it('returns "quality" for reviewer agent with correctness dimension', () => {
    expect(detectClaimType(makeFinding({ sourceAgent: 'reviewer', dimension: 'correctness', title: 'Confusing variable name' }))).toBe('quality');
  });

  it('returns "unknown" when nothing matches', () => {
    expect(detectClaimType(makeFinding({ title: 'Something else entirely', sourceAgent: 'custom-agent', dimension: 'observability' }))).toBe('unknown');
  });

  it('security dimension takes priority over bug keywords in title', () => {
    expect(detectClaimType(makeFinding({ title: 'Incorrect auth check', dimension: 'security', sourceAgent: 'reviewer' }))).toBe('security');
  });
});
