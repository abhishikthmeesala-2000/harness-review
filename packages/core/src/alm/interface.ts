export interface PrRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface AlmAdapter {
  readonly platform: string;
  postSummary(prRef: PrRef, markdown: string): Promise<void>;
  postInlineComment(prRef: PrRef, file: string, line: number, body: string): Promise<void>;
  updateCheckStatus(prRef: PrRef, status: 'success' | 'failure' | 'pending', summary: string): Promise<void>;
}
