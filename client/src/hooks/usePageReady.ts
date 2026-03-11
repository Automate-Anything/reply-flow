import { useState, useEffect } from 'react';

/**
 * Delays page content reveal by `delay` ms so a skeleton is shown briefly,
 * giving the page a natural "loading → ready" feel even when data is cached.
 */
export function usePageReady(delay = 500) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return ready;
}
