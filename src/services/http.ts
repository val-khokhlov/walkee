import { Capacitor } from '@capacitor/core';

/**
 * OpenStreetMap services (Nominatim, Overpass) ask apps to identify themselves.
 * Replace the contact part before you publish.
 */
export const USER_AGENT = 'WanderAudio/1.0 (contact: you@example.com)';

export const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * fetch with a timeout. A timeout throws a plain Error, while a caller abort keeps
 * its AbortError name, so "user cancelled" and "server too slow" stay distinguishable.
 */
export async function fetchWithTimeout(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, signal, headers = {}, method, body } = opts;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  // Browsers forbid overriding User-Agent; the native HTTP layer allows it.
  const finalHeaders = Capacitor.isNativePlatform() ? { 'User-Agent': USER_AGENT, ...headers } : headers;
  try {
    return await fetch(url, { method, body, headers: finalHeaders, signal: ctrl.signal });
  } catch (e) {
    if (timedOut) throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s (${new URL(url).host})`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function isAbortError(e: unknown): boolean {
  return (e as { name?: string } | null)?.name === 'AbortError';
}

/** Runs at most `max` tasks at once; the rest wait in arrival order. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next(); // hand the slot over
      else active--;
    }
  };
}

/** Sliding-window requests-per-minute gate, first come first served. The limit is read on every call. */
export function createRpmGate(getMax: () => number) {
  const stamps: number[] = [];
  let gate: Promise<void> = Promise.resolve();
  return function acquire(): Promise<void> {
    const ticket = gate.then(async () => {
      for (;;) {
        const now = Date.now();
        while (stamps.length && now - stamps[0] >= 60_000) stamps.shift();
        if (stamps.length < Math.max(1, getMax())) {
          stamps.push(now);
          return;
        }
        await sleepMs(stamps[0] + 60_000 - now + 25);
      }
    });
    gate = ticket;
    return ticket;
  };
}
