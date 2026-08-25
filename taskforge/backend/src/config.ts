export function resolveBackendUrl(): string {
  const port = process.env.PORT || '3001';
  const defaultLocal = `http://127.0.0.1:${port}`;
  const raw = process.env.BACKEND_URL || defaultLocal;
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    new URL(normalized);
  } catch {
    return defaultLocal;
  }
  return normalized.replace(/\/$/, '');
}
