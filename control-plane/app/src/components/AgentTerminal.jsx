import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../lib/api.js';

// Live terminal attached to an agent's tmux session via the control-plane API
// websocket endpoint (/v1/agent/:slug/terminal). The API resolves the slug to
// a tmux session server-side, so nothing here is deployment-specific.
export default function AgentTerminal({ slug }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('connecting…');

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#0a0b09',
        foreground: '#f1f3ee',
        cursor: '#c4ff3d',
        selectionBackground: 'rgba(196,255,61,0.25)',
        black: '#0a0b09',
        red: '#ff6b6b',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#5fc7ff',
        magenta: '#ff5fa2',
        cyan: '#7dffaa',
        white: '#f1f3ee',
      },
      allowProposedApi: true,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const ws = new WebSocket(api.terminalUrl(slug));
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('connected');
      const dims = fit.proposeDimensions();
      if (dims) {
        ws.send(`\x1bSZ${dims.cols},${dims.rows}`);
        term.resize(dims.cols, dims.rows);
      }
    };
    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('error');
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data));
      }
    };

    term.onData((data) => {
      if (ws.readyState === 1) ws.send(data);
    });

    const onResize = () => {
      try {
        fit.fit();
        const dims = fit.proposeDimensions();
        if (dims && ws.readyState === 1) {
          ws.send(`\x1bSZ${dims.cols},${dims.rows}`);
        }
      } catch { /* ignore */ }
    };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      try { ws.close(); } catch { /* ignore */ }
      try { term.dispose(); } catch { /* ignore */ }
    };
  }, [slug]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <span className="muted small mono">tmux: {slug}</span>
        <span className="muted small">{status}</span>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, background: '#0a0b09', padding: 6 }} />
    </div>
  );
}
