// Simple client-side speed test against Cloudflare's edge.
// Endpoints:
//   GET  https://speed.cloudflare.com/__down?bytes=N  -> returns N random bytes (CORS enabled)
//   POST https://speed.cloudflare.com/__up            -> accepts upload body (CORS enabled)

export interface PingResult {
  avg: number;
  min: number;
  max: number;
  jitter: number;
  samples: number[];
}

export interface ThroughputResult {
  mbps: number;
  bytes: number;
  seconds: number;
}

export type ProgressCallback = (loadedBytes: number, totalBytes: number | null, mbps: number) => void;

// Same-origin paths. In dev/preview Vite proxies these to
// https://speed.cloudflare.com (see vite.config.ts), so the browser
// only resolves localhost and never touches the blocked DNS.
const DOWN_URL = '/__down';
const UP_URL = '/__up';

function cacheBuster(): string {
  return `r=${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function formatMbps(mbps: number): string {
  if (!Number.isFinite(mbps)) return '—';
  if (mbps < 1) return `${(mbps * 1000).toFixed(0)} Kbps`;
  if (mbps < 100) return `${mbps.toFixed(2)} Mbps`;
  return `${mbps.toFixed(1)} Mbps`;
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

export async function measurePing(samples = 10, signal?: AbortSignal): Promise<PingResult> {
  const times: number[] = [];

  for (let i = 0; i < samples; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = `${DOWN_URL}?bytes=0&${cacheBuster()}`;
    const start = performance.now();
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
    // Drain body so timing is complete (0 bytes, but be safe)
    await res.arrayBuffer().catch(() => undefined);
    const end = performance.now();
    times.push(end - start);
  }

  const min = Math.min(...times);
  const max = Math.max(...times);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  // Jitter = mean absolute difference between consecutive samples
  let jitter = 0;
  if (times.length > 1) {
    let sum = 0;
    for (let i = 1; i < times.length; i++) sum += Math.abs(times[i] - times[i - 1]);
    jitter = sum / (times.length - 1);
  }

  return { avg, min, max, jitter, samples: times };
}

export async function measureDownload(
  bytes = 25_000_000,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ThroughputResult> {
  const url = `${DOWN_URL}?bytes=${bytes}&${cacheBuster()}`;
  const start = performance.now();

  const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
  if (!res.ok || !res.body) {
    // Fallback for environments without streaming body
    const buf = await res.arrayBuffer();
    const seconds = (performance.now() - start) / 1000;
    const mbps = (buf.byteLength * 8) / seconds / 1_000_000;
    onProgress?.(buf.byteLength, buf.byteLength, mbps);
    return { mbps, bytes: buf.byteLength, seconds };
  }

  const reader = res.body.getReader();
  let loaded = 0;

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException('Aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    const seconds = (performance.now() - start) / 1000;
    const mbps = seconds > 0 ? (loaded * 8) / seconds / 1_000_000 : 0;
    onProgress?.(loaded, bytes, mbps);
  }

  const seconds = (performance.now() - start) / 1000;
  const mbps = seconds > 0 ? (loaded * 8) / seconds / 1_000_000 : 0;
  return { mbps, bytes: loaded, seconds };
}

function makeUploadPayload(bytes: number): Blob {
  // Random payload that compresses poorly (so measured size is honest).
  // Note: getRandomValues max is 65536 bytes per call, so chunk it.
  const CHUNK = 65536;
  const parts: BlobPart[] = [];
  let remaining = bytes;
  while (remaining > 0) {
    const n = Math.min(remaining, CHUNK);
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    parts.push(buf);
    remaining -= n;
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function measureUpload(
  bytes = 10_000_000,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<ThroughputResult> {
  const payload = makeUploadPayload(bytes);
  const url = `${UP_URL}?${cacheBuster()}`;
  const start = performance.now();

  return new Promise<ThroughputResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      const seconds = (performance.now() - start) / 1000;
      const mbps = seconds > 0 ? (e.loaded * 8) / seconds / 1_000_000 : 0;
      onProgress?.(e.loaded, e.total || bytes, mbps);
    };

    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        const seconds = (performance.now() - start) / 1000;
        const mbps = seconds > 0 ? (bytes * 8) / seconds / 1_000_000 : 0;
        onProgress?.(bytes, bytes, mbps);
        resolve({ mbps, bytes, seconds });
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('Upload network error'));
    };

    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    xhr.send(payload);
  });
}
