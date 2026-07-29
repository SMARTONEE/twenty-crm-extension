import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Twenty CRM - South Connect',
    description: 'Capture LinkedIn profiles and companies to South Connect CRM (Twenty)',
    version: '1.0.0',
    permissions: ['storage', 'cookies', 'activeTab'],
    host_permissions: ['*://*.linkedin.com/*', 'https://crm.southconnect.io/*'],
    icons: {
      16: '/icon/16.png',
      32: '/icon/32.png',
      48: '/icon/48.png',
      96: '/icon/96.png',
      128: '/icon/128.png',
    },
  },
});
