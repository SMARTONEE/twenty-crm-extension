export default defineContentScript({
  matches: ['https://crm.southconnect.io/*'],
  runAt: 'document_idle',

  main() {
    console.log('[Twenty Content] Loaded on', window.location.href);

    const TWENTY_TOKEN_KEY = 'tokenPairState';
    let lastSentToken: string | null = null;

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

    // Send token to background
    const sendTokenToBackground = (token: string) => {
      browser.runtime.sendMessage({
        type: 'STORE_TOKEN',
        payload: { token },
      }).then(() => {
        console.log('[Twenty Content] Token sent to background');
      }).catch(() => {
        // Background might not be ready — that's OK, we'll retry
        console.log('[Twenty Content] Failed to send token, will retry');
      });
    };

    // Check and send token if found/changed
    const checkAndSendToken = () => {
      const token = getTokenFromLocalStorage();
      if (token && token !== lastSentToken) {
        console.log('[Twenty Content] Token found (new or changed), sending to background');
        lastSentToken = token;
        sendTokenToBackground(token);
      }
    };

    // Initial check
    checkAndSendToken();

    // Poll for token changes every 2 seconds (handles login after page load)
    const pollInterval = setInterval(checkAndSendToken, 2000);

    // Listen for token requests from background
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'GET_TOKEN_FROM_PAGE') {
        const freshToken = getTokenFromLocalStorage();
        console.log('[Twenty Content] Token requested, found:', !!freshToken);
        if (freshToken) {
          lastSentToken = freshToken;
        }
        sendResponse({ success: true, data: { token: freshToken } });
        return false;
      }
    });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      clearInterval(pollInterval);
    });
  },
});
