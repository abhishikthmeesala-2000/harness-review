import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface FalsePositivePattern {
  id: string;
  agentId: string;
  category: string;
  titleKeywords: string[];
  fileExtensions: string[];
  seenCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface FpMatchResult {
  matched: boolean;
  pattern?: FalsePositivePattern;
}

function getFileExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]!}` : '';
}

export class FpPatternStore {
  private readonly storePath: string;

  constructor(repoRoot: string = process.cwd()) {
    this.storePath = join(repoRoot, '.engagement-harness/feedback/fp-patterns.json');
  }

  load(): FalsePositivePattern[] {
    if (!existsSync(this.storePath)) return [];
    try {
      const raw = readFileSync(this.storePath, 'utf8');
      return JSON.parse(raw) as FalsePositivePattern[];
    } catch {
      return [];
    }
  }

  save(patterns: FalsePositivePattern[]): void {
    const dir = dirname(this.storePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.storePath, JSON.stringify(patterns, null, 2) + '\n', 'utf8');
  }

  learnFromFalsePositive(item: {
    sourceAgent?: string;
    category?: string;
    title?: string;
    file?: string;
    timestamp?: string;
  }): void {
    const patterns = this.load();
    const agentId = item.sourceAgent ?? 'unknown';
    const category = item.category ?? 'unknown';
    const titleKeywords = item.title
      ? item.title
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3)
      : [];
    const fileExt = item.file ? getFileExtension(item.file) : '';
    const fileExtensions = fileExt ? [fileExt] : [];
    const now = item.timestamp ?? new Date().toISOString();

    const patternKey = `${agentId}:${category}`;
    const existing = patterns.find((p) => `${p.agentId}:${p.category}` === patternKey);

    if (existing) {
      existing.seenCount++;
      existing.lastSeen = now;
      for (const kw of titleKeywords) {
        if (!existing.titleKeywords.includes(kw)) {
          existing.titleKeywords.push(kw);
        }
      }
    } else {
      patterns.push({
        id: `fp-${Date.now().toString(36)}`,
        agentId,
        category,
        titleKeywords,
        fileExtensions,
        seenCount: 1,
        firstSeen: now,
        lastSeen: now,
      });
    }

    this.save(patterns);
    console.log(`[fp-learning] Learned pattern from false positive (agent=${agentId}, category=${category}, seenCount=${existing ? existing.seenCount : 1})`);
  }

  checkPattern(finding: {
    sourceAgent?: string;
    category?: string;
    title?: string;
    file?: string;
  }): FpMatchResult {
    const patterns = this.load();
    const agentId = finding.sourceAgent ?? '';
    const category = finding.category ?? '';
    const titleWords = finding.title
      ? finding.title
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3)
      : [];
    const fileExt = finding.file ? getFileExtension(finding.file) : '';

    for (const pattern of patterns) {
      if (pattern.seenCount < 2) continue;
      if (pattern.agentId !== agentId) continue;

      const categoryMatch = pattern.category === category;
      const keywordMatches = pattern.titleKeywords.filter((kw) => titleWords.includes(kw));
      const extensionMatch =
        pattern.fileExtensions.length === 0 || pattern.fileExtensions.includes(fileExt);

      if (categoryMatch && extensionMatch && keywordMatches.length >= 2) {
        return { matched: true, pattern };
      }

      // Strong signal: same agent+category seen 3+ times
      if (categoryMatch && pattern.seenCount >= 3) {
        return { matched: true, pattern };
      }
    }

    return { matched: false };
  }
}
