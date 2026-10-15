import { useRef, useState } from 'react';
import './App.css';
import {
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
      <main className="card">
        <header className="header">
          <div className="logo" aria-hidden="true">
            <span className="logo-planet" />
            <span className="logo-orbit" />
          </div>
          <h1>
            Speed <span>Test</span>
          </h1>
          <p>Check your internet performance</p>
        </header>

        {error && <div className="error">{error}</div>}

        <div className="grid">
          <section className="metric down">
            <div className="icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v12" />
                <path d="m6 11 6 6 6-6" />
              </svg>
            </div>
            <h2>Download</h2>
            <div className="unit">Mbps</div>
            <div className="value">
              {down ? down.mbps.toFixed(1) : live.downMbps != null ? live.downMbps.toFixed(1) : '--'}
            </div>
            <div className="bar">
              <div className="fill" style={{ width: `${Math.round(live.downProgress * 100)}%` }} />
            </div>
            <div className="sub">
              {down ? `${(down.bytes / 1_000_000).toFixed(1)} MB in ${down.seconds.toFixed(1)}s` : '25 MB download'}
            </div>
          </section>

          <section className="metric up">
            <div className="icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20V8" />
                <path d="m6 13 6-6 6 6" />
              </svg>
            </div>
            <h2>Upload</h2>
            <div className="unit">Mbps</div>
            <div className="value">
              {up ? up.mbps.toFixed(1) : live.upMbps != null ? live.upMbps.toFixed(1) : '--'}
            </div>
            <div className="bar">
              <div className="fill" style={{ width: `${Math.round(live.upProgress * 100)}%` }} />
            </div>
            <div className="sub">
              {up ? `${(up.bytes / 1_000_000).toFixed(1)} MB in ${up.seconds.toFixed(1)}s` : '10 MB upload'}
            </div>
          </section>

          <section className="metric ping">
            <div className="icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
              </svg>
            </div>
            <h2>Ping</h2>
            <div className="unit">ms</div>
            <div className="value">
              {ping ? ping.avg.toFixed(0) : live.pingMs != null ? live.pingMs.toFixed(0) : '--'}
            </div>
            <div className="sub">
              {ping
                ? `min ${formatMs(ping.min)} · jitter ${formatMs(ping.jitter)}`
                : '10 × tiny requests'}
            </div>
          </section>
        </div>

        <div className="controls">
          {running ? (
            <button className="start stop" onClick={handleStop}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              <span>
                {phase === 'ping' && 'Ping…'}
                {phase === 'download' && 'Download…'}
                {phase === 'upload' && 'Upload…'}
              </span>
            </button>
          ) : (
            <button className="start" onClick={handleStart}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
              <span>{phase === 'done' || phase === 'error' ? 'Run Again' : 'Start Test'}</span>
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
