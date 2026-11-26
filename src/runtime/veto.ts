/**
 * Defence in depth for board tools: a call whose figures lack sources is vetoed before the tool runs.
 * Board tools take `{ figures: [{ ..., sources: [...] }] }`.
 */
export function unsourcedVeto(toolName: string, args: string): string | undefined {
  if (toolName !== 'post_figures') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return undefined; // malformed JSON is rejected by the tool's own validation with a clear message
  }
  const figures = (parsed as { figures?: unknown }).figures;
  if (!Array.isArray(figures)) return undefined;
  const bad = figures.findIndex((f: unknown) => {
    const s = (f as { sources?: unknown } | null)?.sources;
    return !Array.isArray(s) || s.length === 0;
  });
  return bad >= 0 ? `figure ${bad} has no sources` : undefined;
}
