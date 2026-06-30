import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// All deployment-specific values come from env (never hardcoded):
//   VITE_DEV_PORT      — dev server port (default 5173)
//   VITE_DASHBOARD_HOST — public host the dashboard is served from, e.g.
//                         dashboard.example.com. Used for allowedHosts + HMR.
//                         Leave unset for pure-local dev.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_DEV_PORT || 5173);
  const host = env.VITE_DASHBOARD_HOST || '';

  const server = {
    host: '127.0.0.1',
    port,
    strictPort: true,
  };

  // When served behind a public domain (nginx + TLS), allow it and route HMR
  // over the secure websocket on 443.
  if (host) {
    server.allowedHosts = [host, 'localhost', '127.0.0.1'];
    server.hmr = { host, protocol: 'wss', clientPort: 443 };
  }

  return {
    plugins: [react()],
    server,
  };
});
