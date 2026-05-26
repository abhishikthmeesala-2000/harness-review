import type { FeedbackItem, FeedbackState } from './types.js';

const STATE_PRIORITY: Record<FeedbackState, number> = {
  false_positive: 1,
  accepted: 2,
  fixed: 3,
  dismissed: 4,
  acknowledged: 5,
  ignored: 6,
};

export class FeedbackDeduplicator {
  deduplicate(items: FeedbackItem[]): FeedbackItem[] {
    const byFindingId = new Map<string, FeedbackItem>();

    for (const item of items) {
      const existing = byFindingId.get(item.findingId);

      if (!existing) {
        byFindingId.set(item.findingId, item);
        continue;
      }

      const existingPriority = STATE_PRIORITY[existing.state];
      const newPriority = STATE_PRIORITY[item.state];

      if (newPriority < existingPriority) {
        byFindingId.set(item.findingId, item);
      }
    }

    return Array.from(byFindingId.values());
  }

  merge(existing: FeedbackItem[], newItems: FeedbackItem[]): FeedbackItem[] {
    return this.deduplicate([...existing, ...newItems]);
  }
}
