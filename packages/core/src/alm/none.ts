import type { AlmAdapter } from './interface.js';

export class NoneAlm implements AlmAdapter {
  readonly platform = 'none';
  async postSummary() {}
  async postInlineComment() {}
  async updateCheckStatus() {}
}
