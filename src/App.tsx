import { useRef, useState } from 'react';
import './App.css';
import {
  formatMbps,
  formatMs,
  measureDownload,
  measurePing,
  measureUpload,
  type PingResult,
  type ThroughputResult,
} from './lib/speedtest';

type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'done' | 'error';

interface LiveState {
  pingMs: number | null;
  downMbps: number | null;
  downProgress: number; // 0..1
  upMbps: number | null;
  upProgress: number; // 0..1
}

const initialLive: LiveState = {
  pingMs: null,
  downMbps: null,
  downProgress: 0,
  upMbps: null,
  upProgress: 0,
};

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [live, setLive] = useState<LiveState>(initialLive);
  const [ping, setPing] = useState<PingResult | null>(null);
  const [down, setDown] = useState<ThroughputResult | null>(null);
  const [up, setUp] = useState<ThroughputResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const running = phase === 'ping' || phase === 'download' || phase === 'upload';

  async function handleStart() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setPhase('ping');
    setPing(null);
    setDown(null);
    setUp(null);
    setError(null);
    setLive({ ...initialLive });

    try {
      // 1. Ping (10 small requests)
      const pingRes = await measurePing(10, ctrl.signal);
      setPing(pingRes);
      setLive((s) => ({ ...s, pingMs: pingRes.avg }));

      // 2. Download (25 MB stream with live speed)
      setPhase('download');
      const downRes = await measureDownload(
        25_000_000,
        (loaded, total, mbps) => {
          setLive((s) => ({
            ...s,
            downMbps: mbps,
            downProgress: total ? loaded / total : 0,
          }));
        },
        ctrl.signal,
      );
      setDown(downRes);

      // 3. Upload (10 MB POST with live speed)
      setPhase('upload');
      const upRes = await measureUpload(
        10_000_000,
        (loaded, total, mbps) => {
          setLive((s) => ({
            ...s,
            upMbps: mbps,
            upProgress: total ? loaded / total : 0,
          }));
        },
        ctrl.signal,
      );
      setUp(upRes);

      setPhase('done');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setPhase('idle');
      } else {
        setError(e instanceof Error ? e.message : 'Speed test failed');
        setPhase('error');
      }
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setPhase('idle');
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Speedtest</h1>
        
      </header>

      <main className="card">
        <div className="controls">
          {!running ? (
            <button className="primary" onClick={handleStart}>
              {phase === 'done' || phase === 'error' ? 'Run again' : 'Start test'}
            </button>
          ) : (
            <button className="secondary" onClick={handleStop}>
              Stop
            </button>
          )}
          <span className="status" data-phase={phase}>
            {phase === 'idle' && 'Ready'}
            {phase === 'ping' && 'Measuring ping…'}
            {phase === 'download' && 'Measuring download…'}
            {phase === 'upload' && 'Measuring upload…'}
            {phase === 'done' && 'Done'}
            {phase === 'error' && 'Error'}
          </span>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="grid">
          <section className="metric">
            <h2>Ping</h2>
            <div className="value">{ping ? formatMs(ping.avg) : live.pingMs != null ? formatMs(live.pingMs) : '—'}</div>
            <div className="sub">
              {ping
                ? `min ${formatMs(ping.min)} · max ${formatMs(ping.max)} · jitter ${formatMs(ping.jitter)}`
                : '10 × tiny requests'}
            </div>
          </section>

          <section className="metric">
            <h2>Download</h2>
            <div className="value">
              {down ? formatMbps(down.mbps) : live.downMbps != null ? formatMbps(live.downMbps) : '—'}
            </div>
            <div className="bar">
              <div className="fill down" style={{ width: `${Math.round(live.downProgress * 100)}%` }} />
            </div>
            <div className="sub">
              {down ? `${(down.bytes / 1_000_000).toFixed(1)} MB in ${down.seconds.toFixed(1)}s` : '25 MB download'}
            </div>
          </section>

          <section className="metric">
            <h2>Upload</h2>
            <div className="value">
              {up ? formatMbps(up.mbps) : live.upMbps != null ? formatMbps(live.upMbps) : '—'}
            </div>
            <div className="bar">
              <div className="fill up" style={{ width: `${Math.round(live.upProgress * 100)}%` }} />
            </div>
            <div className="sub">
              {up ? `${(up.bytes / 1_000_000).toFixed(1)} MB in ${up.seconds.toFixed(1)}s` : '10 MB upload'}
            </div>
          </section>
        </div>

        
      </main>
    </div>
  );
}
