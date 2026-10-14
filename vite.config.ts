import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No system DNS change needed.
// Your router DNS blocks speed.cloudflare.com, and Node's proxy
// uses OS DNS, so we proxy to Cloudflare's IP directly (no lookup)
// and send Host/SNI manually. Browser only talks to localhost.
const CF_IP = '162.159.140.220';
const CF_HOST = 'speed.cloudflare.com';

const cfProxy = {
  target: `https://${CF_IP}:443`,
  changeOrigin: false,
  secure: false, // Cloudflare IP cert won't match hostname; Host header still routes correctly
  headers: {
    Host: CF_HOST,
    Origin: 'https://speed.cloudflare.com',
    Referer: 'https://speed.cloudflare.com/',
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/__down': cfProxy,
      '/__up': cfProxy,
    },
  },
  preview: {
    proxy: {
      '/__down': cfProxy,
      '/__up': cfProxy,
    },
  },
});
