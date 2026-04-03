export function safeObject<T extends object>(obj: unknown): T {
  return obj && typeof obj === 'object' ? (obj as T) : ({} as T);
}

export function safeArray<T>(arr: unknown): T[] {
  return Array.isArray(arr) ? (arr as T[]) : [];
}

