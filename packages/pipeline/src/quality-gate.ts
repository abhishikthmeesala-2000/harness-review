import type { Config, Finding } from '@engagement-harness/core';

const SEVERITY_RANK: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface QualityGateFailure {
  finding: Finding;
  reason: string;
}

export interface QualityGateResult {
  passed: Finding[];
  failed: QualityGateFailure[];
}

function getFileType(file: string | undefined): string {
  if (!file) return 'unknown';
  if (/\.(json|yaml|yml|env|toml)$/.test(file)) return 'config';
  if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(file) || file.includes('__tests__')) return 'test';
  if (/\.(html|css|scss|sass|less|jsx|tsx|vue|svelte)$/.test(file)) return 'frontend';
  if (/\.(ts|js|py|go|java|rb|php|rs|cs)$/.test(file)) return 'backend';
  return 'other';
}

function getThreshold(finding: Finding, baseThreshold: number): number {
  const file = finding.file ?? '';

  // Config files — strict (may contain secrets)
  if (/\.(json|yaml|yml|env|toml)$/.test(file)) {
    return Math.min(baseThreshold + 0.1, 0.9);
  }

  // Test files — lenient (suggestions are ok)
  if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(file) || file.includes('__tests__')) {
    return Math.max(baseThreshold - 0.2, 0.2);
  }

  // Frontend files — lenient (fewer security risks)
  if (/\.(html|css|scss|sass|less|jsx|tsx|vue|svelte)$/.test(file)) {
    return Math.max(baseThreshold - 0.2, 0.3);
  }

  // Backend files — use base threshold
  if (/\.(ts|js|py|go|java|rb|php|rs|cs)$/.test(file)) {
    return baseThreshold;
  }

  // Default — slightly lenient
  return Math.max(baseThreshold - 0.1, 0.3);
}

export const QualityGate = {
  filter(findings: Finding[], config: Config): QualityGateResult {
    const { confidenceThreshold, severityThreshold } = config.review;
    const minRank = SEVERITY_RANK[severityThreshold] ?? 0;
    const requireVerifier = config.review.requireVerifierApproval ?? true;

    const passed: Finding[] = [];
    const failed: QualityGateFailure[] = [];
    let publishedCount = 0;
    let rejectedCount = 0;

    for (const f of findings) {
      if (requireVerifier && f.verification.status === 'rejected') {
        const reason = `verifier rejected: ${f.verification.reason}`;
        failed.push({ finding: f, reason });
        rejectedCount++;
        console.log(
          `  ✗ rejected: ${f.title} ` +
            `(verifier: ${f.verification.reason} · ${f.sourceAgent} · ${f.severity} · ${getFileType(f.file)})`,
        );
        continue;
      }

      // Critical findings always published regardless of confidence
      if (f.severity === 'critical') {
        passed.push(f);
        publishedCount++;
        console.log(
          `  ✓ published: ${f.title} ` +
            `(confidence ${f.confidence.toFixed(2)} · critical severity always published)`,
        );
        continue;
      }

      let threshold = getThreshold(f, confidenceThreshold);
      if (f.severity === 'high') {
        threshold = Math.max(threshold - 0.1, 0.2);
      }

      if (f.confidence < threshold) {
        const reason =
          `confidence ${f.confidence.toFixed(2)} below threshold ${threshold.toFixed(2)}` +
          ` (file type: ${getFileType(f.file)})`;
        failed.push({ finding: f, reason });
        rejectedCount++;
        console.log(
          `  ✗ rejected: ${f.title} ` +
            `(confidence ${f.confidence.toFixed(2)} < threshold ${threshold.toFixed(2)} · ` +
            `${f.sourceAgent} · ${f.severity} · ${getFileType(f.file)})`,
        );
        continue;
      }

      const rank = SEVERITY_RANK[f.severity] ?? 0;
      if (rank < minRank) {
        const reason = `severity "${f.severity}" below threshold "${severityThreshold}"`;
        failed.push({ finding: f, reason });
        rejectedCount++;
        console.log(
          `  ✗ rejected: ${f.title} ` +
            `(severity ${f.severity} below threshold ${severityThreshold} · ` +
            `${f.sourceAgent} · ${f.severity} · ${getFileType(f.file)})`,
        );
        continue;
      }

      passed.push(f);
      publishedCount++;
      console.log(
        `  ✓ published: ${f.title} ` +
          `(confidence ${f.confidence.toFixed(2)} >= threshold ${threshold.toFixed(2)})`,
      );
    }

    console.log(`\nVerifier: ${publishedCount} published · ${rejectedCount} rejected`);

    return { passed, failed };
  },
};
