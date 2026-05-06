import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Config, ContextBundle, ContextEntry, FileDiff, Finding, PolicyDecision } from '@engagement-harness/core';
import { parseUnifiedDiff } from '@engagement-harness/core';
import { AgentOrchestrator } from '@engagement-harness/agents';
import { FindingPipeline } from '@engagement-harness/pipeline';
import micromatch from 'micromatch';

import { EvalCaseSchema, type EvalCase } from './case-schema.js';

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
    const report: EvalReport = {
      timestamp: new Date().toISOString(),
      totalCases: results.length,
      passed,
      failed: results.length - passed,
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

    let diff: FileDiff[];
    try {
      const patchText = readFileSync(join(caseDir, 'diff.patch'), 'utf8');
      diff = parseUnifiedDiff(patchText);
    } catch (err) {
      return {
        caseId: evalCase.id,
        passed: false,
        findings: [],
        decision: 'approved',
        falsePositiveCount: 0,
        errors: [`Failed to read diff.patch: ${String(err)}`],
      };
    }

    // Apply optional file glob filter.
    if (evalCase.fileGlob) {
      diff = diff.filter((f) => micromatch([f.path], evalCase.fileGlob!).length > 0);
    }

    // Inject contextRules as rule entries.
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
      caseId: evalCase.id,
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

    // Check expected findings by dimension.
    for (const expected of evalCase.expectedFindings ?? []) {
      const found = findings.some(
        (f) =>
          f.dimension === expected.dimension &&
          (expected.file === undefined || f.file === expected.file) &&
          (expected.severity === undefined || f.severity === expected.severity),
      );
      if (!found) {
        errors.push(`Expected finding with dimension="${expected.dimension}" not present`);
        ok = false;
      }
    }

    // Check expected decision.
    if (evalCase.expectedDecision !== undefined && decision !== evalCase.expectedDecision) {
      errors.push(`Expected decision "${evalCase.expectedDecision}" but got "${decision}"`);
      ok = false;
    }

    // Check max false positives.
    if (evalCase.maxFalsePositives !== undefined) {
      const fp = EvalRunner.countFalsePositives(evalCase, findings);
      if (fp > evalCase.maxFalsePositives) {
        errors.push(
          `False positive count ${fp} exceeds maxFalsePositives ${evalCase.maxFalsePositives}`,
        );
        ok = false;
      }
    }

    return ok && errors.length === 0;
  }

  private static countFalsePositives(evalCase: EvalCase, findings: Finding[]): number {
    // Findings not covered by any expectedFinding are considered false positives.
    const expected = evalCase.expectedFindings ?? [];
    if (expected.length === 0) return findings.length;
    return findings.filter(
      (f) => !expected.some((e) => e.dimension === f.dimension),
    ).length;
  }
}
