export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',

  main() {
    // Self-invoking async so WXT transform doesn't break
    (async () => {
      // Only run on the user's Twenty instance
      const settings = await browser.storage.sync.get('twentyUrl');
      const twentyUrl = settings.twentyUrl || '';
      if (!twentyUrl || !window.location.href.startsWith(twentyUrl)) {
        return;
      }

      console.log('[Twenty Content] Loaded on', window.location.href);

      const TWENTY_TOKEN_KEY='***';
      let lastSentToken: string | null = null;

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

      const sendTokenToBackground = (token: string) => {
        browser.runtime.sendMessage({
          type: 'STORE_TOKEN',
          payload: { token },
        }).then(() => {
          console.log('[Twenty Content] Token sent to background');
        }).catch(() => {
          console.log('[Twenty Content] Failed to send token');
        });
      };

      const checkAndSendToken = () => {
        const token = getTokenFromLocalStorage();
        if (token && token !== lastSentToken) {
          console.log('[Twenty Content] Token found, sending to background');
          lastSentToken = token;
          sendTokenToBackground(token);
        }
      };

      checkAndSendToken();
      const pollInterval = setInterval(checkAndSendToken, 2000);

      browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.type === 'GET_TOKEN_FROM_PAGE') {
          const freshToken = getTokenFromLocalStorage();
          console.log('[Twenty Content] Token requested, found:', !!freshToken);
          if (freshToken) lastSentToken = freshToken;
          sendResponse({ success: true, data: { token: freshToken } });
          return false;
        }
      });

      window.addEventListener('beforeunload', () => {
        clearInterval(pollInterval);
      });
    })();
  },
});
