// Authentication Synchronization Helper for TaskForge Extension

/**
 * Synchronize and obtain the fresh authentication token.
 * Searches open TaskForge dashboard tabs and reads localStorage.getItem('taskforge_auth_token').
 * Validates non-empty string, updates chrome.storage.local.authToken, and returns it.
 * Falls back to chrome.storage.local.authToken only when no dashboard token can be obtained.
 */
export async function getFreshAuthToken(options?: { forceTabSearch?: boolean }): Promise<string | null> {
  console.log('[TaskForge Auth] Searching dashboard tabs for fresh token');

  try {
    const tabs = await chrome.tabs.query({});
    const dashboardTabs = tabs.filter((t) => {
      if (!t.id || !t.url) return false;
      const url = t.url.toLowerCase();
      return (
        url.includes('task-forge-phi-six.vercel.app') ||
        url.includes('task-forge') ||
        url.includes('taskforge') ||
        url.includes('.vercel.app') ||
        (url.includes('localhost') && (url.includes('3000') || url.includes('3001') || url.includes('5173'))) ||
        (url.includes('127.0.0.1') && (url.includes('3000') || url.includes('3001') || url.includes('5173')))
      );
    });

    for (const tab of dashboardTabs) {
      if (!tab.id) continue;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try {
              const raw = localStorage.getItem('taskforge_auth_token');
              if (raw && typeof raw === 'string') {
                let cleaned = raw.trim();
                if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                  cleaned = cleaned.slice(1, -1).trim();
                }
                if (cleaned && cleaned !== 'null' && cleaned !== 'undefined' && cleaned.length > 10) {
                  return cleaned;
                }
              }

              // Fallback: check Supabase auth tokens in localStorage
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                  const sbRaw = localStorage.getItem(key);
                  if (sbRaw) {
                    try {
                      const parsed = JSON.parse(sbRaw);
                      const access = parsed?.access_token || parsed?.token;
                      if (access && typeof access === 'string' && access.length > 10) {
                        return access.trim();
                      }
                    } catch {}
                  }
                }
              }
              return null;
            } catch {
              return null;
            }
          },
        });

        const token = results?.[0]?.result;
        if (token && typeof token === 'string' && token.length > 10) {
          await chrome.storage.local.set({ authToken: token });
          console.log('[TaskForge Auth] Fresh token synchronized');
          return token;
        }
      } catch (err) {
        // Tab might be in restricted state or discarding script injection
      }
    }
  } catch (tabErr) {
    console.warn('[TaskForge Auth] Error querying tabs:', tabErr);
  }

  // Fallback to chrome.storage.local.authToken
  try {
    const storage = await chrome.storage.local.get(['authToken']);
    if (storage.authToken && typeof storage.authToken === 'string') {
      let stored = storage.authToken.trim();
      if (stored.startsWith('"') && stored.endsWith('"')) {
        stored = stored.slice(1, -1).trim();
      }
      if (stored && stored !== 'null' && stored !== 'undefined' && stored.length > 10) {
        console.log('[TaskForge Auth] Using stored token fallback');
        return stored;
      }
    }
  } catch {}

  return null;
}
