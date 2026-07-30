import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: ({ mode }) => {
    const base: Record<string, unknown> = {
      name: 'Twenty CRM — LinkedIn Capture',
      description: 'Capture LinkedIn profiles and companies to your Twenty CRM instance',
      version: '1.0.0',
      permissions: ['storage', 'activeTab', 'scripting'],
      host_permissions: ['*://*.linkedin.com/*', '*://*/*'],
      icons: {
        16: '/icon/16.png',
        32: '/icon/32.png',
        48: '/icon/48.png',
        96: '/icon/96.png',
        128: '/icon/128.png',
      },
      content_scripts: [
        {
          matches: ['*://*/*'],
          run_at: 'document_idle' as const,
          js: ['twenty-content.js'],
        },
      ],
    };
    return base;
  },
});
