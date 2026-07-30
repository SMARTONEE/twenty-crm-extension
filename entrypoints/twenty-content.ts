export default defineContentScript({
  matches: ['https://crm.southconnect.io/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Twenty Content] Loaded on', window.location.href);

    const TWENTY_TOKEN_KEY = '***';

    // Read token from localStorage
    const getTokenFromLocalStorage = (): string | null => {
      try {
        const raw = localStorage.getItem(TWENTY_TOKEN_KEY);
        if (!raw) return null;
        const tokenPair = JSON.parse(raw);
        const token = tokenPair?.accessOrWorkspaceAgnosticToken?.token || null;
        if (token && tokenPair?.accessOrWorkspaceAgnosticToken?.expiresAt) {
          const expiresAt = new Date(tokenPair.accessOrWorkspaceAgnosticToken.expiresAt).getTime();
          if (Date.now() > expiresAt) {
            console.log('[Twenty Content] Token expired');
            return null;
          }
        }
        return token;
      } catch {
        return null;
      }
    };

    // Send token to background on page load
    const token = getTokenFromLocalStorage();
    if (token) {
      console.log('[Twenty Content] Token found, sending to background');
      browser.runtime.sendMessage({
        type: 'STORE_TOKEN',
        payload: { token },
      }).catch(() => {
        // Background might not be ready yet — that's OK
      });
    }

    // Listen for token requests from background
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'GET_TOKEN_FROM_PAGE') {
        const freshToken = getTokenFromLocalStorage();
        console.log('[Twenty Content] Token requested, found:', !!freshToken);
        sendResponse({ success: true, data: { token: freshToken } });
        return false;
      }
    });
  },
});
