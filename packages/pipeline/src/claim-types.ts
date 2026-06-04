import type { CandidateFinding } from '@engagement-harness/core';

export type ClaimType =
  | 'bug'
  | 'security'
  | 'missing-test'
  | 'intent-gap'
  | 'quality'
  | 'architecture'
  | 'performance'
  | 'unknown';

export function detectClaimType(finding: Pick<CandidateFinding, 'title' | 'sourceAgent' | 'dimension'>): ClaimType {
  const title = finding.title.toLowerCase();
  const agent = finding.sourceAgent.toLowerCase();
  const dimension = finding.dimension.toLowerCase();

  if (dimension === 'security' || agent === 'security') {
    return 'security';
  }

  if (
    title.includes('bug') ||
    title.includes('boundary') ||
    title.includes('off-by-one') ||
    title.includes('incorrect') ||
    title.includes('wrong') ||
    title.includes('fails') ||
    title.includes('never') ||
    title.includes('always') ||
    title.includes('race condition') ||
    title.includes('null') ||
    title.includes('undefined')
  ) {
    return 'bug';
  }

  if (
    title.includes('no test') ||
    title.includes('missing test') ||
    title.includes('untested') ||
    title.includes('no coverage') ||
    dimension === 'testing' ||
    agent === 'testing'
  ) {
    return 'missing-test';
  }

  if (
    title.includes('pr claim') ||
    title.includes('pr description') ||
    title.includes('intent') ||
    agent === 'pr-intent-gap'
  ) {
    return 'intent-gap';
  }

  if (
    title.includes('violation') ||
    title.includes('pattern') ||
    title.includes('architecture') ||
    title.includes('coupling') ||
    title.includes('solid') ||
    dimension === 'design'
  ) {
    return 'architecture';
  }

  if (
    title.includes('performance') ||
    title.includes('slow') ||
    title.includes('o(n') ||
    title.includes('memory leak')
  ) {
    return 'performance';
  }

  if (dimension === 'correctness' || agent === 'reviewer') {
    return 'quality';
  }

  return 'unknown';
}
