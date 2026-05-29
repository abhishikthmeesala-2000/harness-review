export const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
};

export const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4o': { input: 5, output: 15 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
};

export const AVG_TOKENS_PER_AGENT = { input: 3500, output: 800 };

export function estimateCostPerPR(
  provider: string,
  model: string,
  agentCount: number,
): number {
  if (provider === 'mock') return 0;
  const table = provider === 'anthropic' ? ANTHROPIC_PRICING : OPENAI_PRICING;
  const pricing = table[model];
  if (!pricing) return 0;
  const inputCost = (AVG_TOKENS_PER_AGENT.input / 1_000_000) * pricing.input;
  const outputCost = (AVG_TOKENS_PER_AGENT.output / 1_000_000) * pricing.output;
  return agentCount * (inputCost + outputCost);
}

export function estimateMonthly(costPerPR: number, weeklyPRs: number): number {
  return costPerPR * weeklyPRs * (52 / 12);
}

export function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}
