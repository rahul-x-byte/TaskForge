export function resolveBackendUrl(): string {
  const raw = process.env.BACKEND_URL || 'http://localhost:3001';
  let normalized = raw;
  if (!/^https?:\/\//i.test(raw)) {
    const hostPart = raw.split(':')[0];
    if (hostPart === 'localhost' || !hostPart.includes('.')) {
      normalized = `http://${raw}`;
    } else {
      normalized = `https://${raw}`;
    }
  }
  try {
    new URL(normalized); // throws if still invalid
  } catch {
    console.error(
      `[Worker Fatal] BACKEND_URL is invalid: "${raw}". ` +
      `It must be a full URL, e.g. ` +
      `https://taskforge-bd.onrender.com`
    );
    process.exit(1);
  }
  return normalized.replace(/\/$/, ''); // strip trailing slash
}
