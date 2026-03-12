import { useState, useEffect } from 'react';
import api from '@/lib/api';

export interface LinkPreview {
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
  url: string;
}

// Simple in-memory cache so we don't re-fetch the same URL
const cache = new Map<string, LinkPreview>();

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;

export function extractFirstUrl(text: string): string | null {
  const match = text.match(URL_REGEX);
  return match?.[0] || null;
}

export function useLinkPreview(text: string | null): { preview: LinkPreview | null; loading: boolean } {
  const url = text ? extractFirstUrl(text) : null;
  const [preview, setPreview] = useState<LinkPreview | null>(url ? cache.get(url) || null : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url) { setPreview(null); return; }

    const cached = cache.get(url);
    if (cached) { setPreview(cached); return; }

    let cancelled = false;
    setLoading(true);

    api.get('/messages/link-preview', { params: { url } })
      .then((res) => {
        if (cancelled) return;
        const data = res.data as LinkPreview;
        // Only cache if we got meaningful data
        if (data.title || data.description || data.image) {
          cache.set(url, data);
          setPreview(data);
        } else {
          setPreview(null);
        }
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [url]);

  return { preview, loading };
}
