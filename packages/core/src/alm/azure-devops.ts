import type { AlmAdapter, PrRef } from './interface.js';

export class AzureDevOpsAlm implements AlmAdapter {
  readonly platform = 'azure-devops';

  async postSummary(_prRef: PrRef, _markdown: string): Promise<void> {}
  async postInlineComment(_prRef: PrRef, _file: string, _line: number, _body: string): Promise<void> {}
  async updateCheckStatus(_prRef: PrRef, _status: 'success' | 'failure' | 'pending', _summary: string): Promise<void> {}
}
