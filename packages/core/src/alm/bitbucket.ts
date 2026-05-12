import type { AlmAdapter, PrRef } from './interface.js';

export class BitbucketAlm implements AlmAdapter {
  readonly platform = 'bitbucket';

  async postSummary(_prRef: PrRef, _markdown: string): Promise<void> {}
  async postInlineComment(_prRef: PrRef, _commitSha: string, _file: string, _line: number, _body: string): Promise<void> {}
  async updateCheckStatus(_prRef: PrRef, _status: 'success' | 'failure' | 'pending', _summary: string): Promise<void> {}
}
