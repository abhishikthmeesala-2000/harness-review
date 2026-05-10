import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Config, ContextBundle, ContextEntry, FileDiff, Finding, PolicyDecision } from '@engagement-harness/core';
import { parseUnifiedDiff } from '@engagement-harness/core';
import { AgentOrchestrator } from '@engagement-harness/agents';
import { FindingPipeline } from '@engagement-harness/pipeline';
import micromatch from 'micromatch';

import { EvalCaseSchema, type EvalCase, type ExpectedFinding } from './case-schema.js';

const EVAL_PROFILE = {
  language: 'typescript' as const,
  framework: null,
  packageManager: 'npm' as const,
  testFramework: null,
  ciProvider: null,
  isMonorepo: false,
  importantPaths: [],
  suggestedIgnoredPaths: [],
};

export interface EvalResult {
  /** Populated from EvalCase.name */
  caseId: string;
  passed: boolean;
  findings: Finding[];
  decision: PolicyDecision;
  falsePositiveCount: number;
  errors: string[];
}

export interface EvalReport {
  timestamp: string;
  totalCases: number;
  passed: number;
  failed: number;
  /** True positives: expected findings that were published. */
  truePositives: number;
  /** False positives: published findings matching no expected finding. */
  falsePositives: number;
  /** False negatives: expected findings that were never published. */
  falseNegatives: number;
  /** TP / (TP + FP), or null when no findings were published. */
  precision: number | null;
  /** TP / (TP + FN), or null when no findings were expected. */
  recall: number | null;
  results: EvalResult[];
}

export class EvalRunner {
  static async runAll(casesDir: string, config: Config): Promise<EvalReport> {
    const subdirs = readdirSync(casesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const results: EvalResult[] = [];
    const orchestrator = new AgentOrchestrator();

    for (const subdir of subdirs) {
      const caseDir = join(casesDir, subdir);
      const result = await EvalRunner.runCase(caseDir, orchestrator, config);
      results.push(result);
    }

    const passed = results.filter((r) => r.passed).length;

    // Aggregate TP/FP/FN across all cases for precision and recall.
    // TP = published findings matched to an expected finding = published - FP.
    // FN = expected findings that weren't published; tracked via per-case errors.
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    for (const r of results) {
      falsePositives += r.falsePositiveCount;
      truePositives += Math.max(0, r.findings.length - r.falsePositiveCount);
      falseNegatives += r.errors.filter((e) => e.startsWith('Expected finding')).length;
    }

    const precision =
      truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : null;
    const recall =
      truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : null;

    const report: EvalReport = {
      timestamp: new Date().toISOString(),
      totalCases: results.length,
      passed,
      failed: results.length - passed,
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      results,
    };

    const reportPath = join(casesDir, `../eval-report-${Date.now()}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

    return report;
  }

  private static async runCase(
    caseDir: string,
    orchestrator: AgentOrchestrator,
    config: Config,
  ): Promise<EvalResult> {
    const errors: string[] = [];

    let evalCase: EvalCase;
    try {
      const raw = readFileSync(join(caseDir, 'case.json'), 'utf8');
      evalCase = EvalCaseSchema.parse(JSON.parse(raw));
    } catch (err) {
      return {
        caseId: caseDir,
        passed: false,
        findings: [],
        decision: 'approved',
        falsePositiveCount: 0,
        errors: [`Failed to parse case.json: ${String(err)}`],
      };
    }

    // Resolve the fixture dir. fixtureRepoPath is relative to the case directory.
    const fixtureDir = join(caseDir, evalCase.fixtureRepoPath);

    let diff: FileDiff[];
    try {
      const patchText = readFileSync(join(fixtureDir, 'diff.patch'), 'utf8');
      diff = parseUnifiedDiff(patchText);
    } catch (err) {
      return {
        caseId: evalCase.name,
        passed: false,
        findings: [],
        decision: 'approved',
        falsePositiveCount: 0,
        errors: [`Failed to read diff.patch: ${String(err)}`],
      };
    }

    // Inject contextRules as rule entries (extension for diff.patch-based eval cases).
    const entries: ContextEntry[] = (evalCase.contextRules ?? []).map((r) => ({
      path: r.path,
      content: r.content,
      reason: 'eval-injected',
      priority: 100,
      kind: 'rule' as const,
    }));

    const bundle: ContextBundle = {
      entries,
      diff,
      repoProfile: EVAL_PROFILE,
      // Pass PR metadata from case fixture so pr-intent-gap agent can use it.
      prMetadata: {
        title: evalCase.prTitle || undefined,
        body: evalCase.prBody || undefined,
      },
    };

    let findings: Finding[] = [];
    let decision: PolicyDecision = 'approved';
    try {
      const candidates = await orchestrator.run(bundle, config);
      const pipelineResult = await FindingPipeline.process(candidates, bundle, config);
      findings = pipelineResult.published;
      decision = pipelineResult.decision;
    } catch (err) {
      errors.push(`Pipeline error: ${String(err)}`);
    }

    // Evaluate against expectations.
    const passed = EvalRunner.evaluate(evalCase, findings, decision, errors);

    return {
      caseId: evalCase.name,
      passed,
      findings,
      decision,
      falsePositiveCount: EvalRunner.countFalsePositives(evalCase, findings),
      errors,
    };
  }

  private static evaluate(
    evalCase: EvalCase,
    findings: Finding[],
    decision: PolicyDecision,
    errors: string[],
  ): boolean {
    let ok = true;

    // Check each expected finding by category, fileGlob, and mustMatchPhrases.
    for (const expected of evalCase.expectedFindings) {
      const found = findings.some((f) => EvalRunner.matchesFinding(f, expected));
      if (!found) {
        errors.push(
          `Expected finding with category="${expected.category}" (fileGlob="${expected.fileGlob}") not present`,
        );
        ok = false;
      }
    }

    // Check expected decision.
    if (decision !== evalCase.expectedDecision) {
      errors.push(`Expected decision "${evalCase.expectedDecision}" but got "${decision}"`);
      ok = false;
    }

    // Check max false positives.
    const fp = EvalRunner.countFalsePositives(evalCase, findings);
    if (fp > evalCase.maxFalsePositives) {
      errors.push(
        `False positive count ${fp} exceeds maxFalsePositives ${evalCase.maxFalsePositives}`,
      );
      ok = false;
    }

    return ok && errors.length === 0;
  }

  private static matchesFinding(finding: Finding, expected: ExpectedFinding): boolean {
    // Category must match (dimension mirrors category in canonical schema).
    if (finding.category !== expected.category) return false;

    // Optional severity filter.
    if (expected.severity !== undefined && finding.severity !== expected.severity) return false;

    // File must match the fileGlob.
    if (expected.fileGlob !== '**' && micromatch([finding.file], [expected.fileGlob]).length === 0) {
      return false;
    }

    // All mustMatchPhrases must appear in the finding title or any evidence content.
    if (expected.mustMatchPhrases.length > 0) {
      const haystack = [
        finding.title,
        ...finding.evidence.map((e) => e.content),
      ]
        .join(' ')
        .toLowerCase();
      const allMatch = expected.mustMatchPhrases.every((phrase) =>
        haystack.includes(phrase.toLowerCase()),
      );
      if (!allMatch) return false;
    }

    return true;
  }

  private static countFalsePositives(evalCase: EvalCase, findings: Finding[]): number {
    // Findings not covered by any expectedFinding are false positives.
    if (evalCase.expectedFindings.length === 0) return findings.length;
    return findings.filter(
      (f) => !evalCase.expectedFindings.some((e) => e.category === f.category),
    ).length;
  }
}
