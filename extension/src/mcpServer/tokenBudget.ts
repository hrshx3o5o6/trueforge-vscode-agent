/** Rough token estimate: ~4 chars/token, zero-dependency, good enough for a budget check. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokenBudget(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) {return { text, truncated: false };}
  return { text: text.slice(0, maxChars) + "\n... (truncated to fit the context budget)", truncated: true };
}
