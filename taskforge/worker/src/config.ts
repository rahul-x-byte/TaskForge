export function resolveBackendUrl(): string {
  const raw = process.env.BACKEND_URL || 'http://localhost:3001';
  // Auto-fix the common mistake: missing scheme
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    new URL(normalized); // throws if still invalid
  } catch {
    console.error(
      `[Worker Fatal] BACKEND_URL is invalid: "${raw}". ` +
      `It must be a full URL including https://, e.g. ` +
      `https://taskforge-backend-ta4i.onrender.com`
    );
    process.exit(1);
  }
  return normalized.replace(/\/$/, ''); // strip trailing slash
}
