/**
 * Stable string keys for React dependency arrays — avoids effect/memo loops
 * when parent recreates object/array references with identical content.
 */

export function stableRoutePathKey(path: [number, number][] | undefined | null): string {
  if (!path?.length) return '';
  try {
    return JSON.stringify(path);
  } catch {
    return String(path.length);
  }
}

export function stableHistoricalRangeKey(
  range: { startDate: string; endDate: string } | null | undefined
): string {
  if (!range) return '';
  return `${range.startDate ?? ''}|${range.endDate ?? ''}`;
}

export function stableJsonKey(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}
