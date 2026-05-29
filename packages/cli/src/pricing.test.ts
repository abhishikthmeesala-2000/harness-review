import { describe, expect, it } from 'vitest';
import {
  estimateCostPerPR,
  estimateMonthly,
  formatCost,
} from './pricing.js';

describe('estimateCostPerPR', () => {
  it('returns a positive number for anthropic + known model', () => {
    const cost = estimateCostPerPR('anthropic', 'claude-sonnet-4-20250514', 2);
    expect(cost).toBeGreaterThan(0);
  });

  it('returns 0 for mock provider', () => {
    expect(estimateCostPerPR('mock', 'claude-sonnet-4-20250514', 5)).toBe(0);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCostPerPR('anthropic', 'unknown-model-xyz', 3)).toBe(0);
  });

  it('scales linearly with agent count', () => {
    const one = estimateCostPerPR('anthropic', 'claude-sonnet-4-20250514', 1);
    const two = estimateCostPerPR('anthropic', 'claude-sonnet-4-20250514', 2);
    expect(two).toBeCloseTo(one * 2, 10);
  });

  it('returns a positive number for openai + known model', () => {
    const cost = estimateCostPerPR('openai', 'gpt-4-turbo', 1);
    expect(cost).toBeGreaterThan(0);
  });
});

describe('estimateMonthly', () => {
  it('approximates cost × weeklyPRs × 52/12', () => {
    const result = estimateMonthly(0.10, 10);
    expect(result).toBeCloseTo(0.10 * 10 * (52 / 12), 6);
  });

  it('returns 0 when costPerPR is 0', () => {
    expect(estimateMonthly(0, 20)).toBe(0);
  });
});

describe('formatCost', () => {
  it('formats small amounts with 3 decimal places', () => {
    expect(formatCost(0.00234)).toBe('$0.002');
  });

  it('formats larger amounts with 2 decimal places', () => {
    expect(formatCost(1.2567)).toBe('$1.26');
  });

  it('formats sub-cent amounts correctly', () => {
    const s = formatCost(0.005);
    expect(s.startsWith('$')).toBe(true);
  });

  it('formats zero', () => {
    expect(formatCost(0)).toBe('$0.000');
  });
});
