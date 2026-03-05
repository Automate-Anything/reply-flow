import { useState, useEffect } from 'react';
import api from '@/lib/api';

interface Plan {
  id: string;
  name: string;
  price_monthly_cents: number;
  channels: number;
  agents: number;
  knowledge_bases: number;
  kb_pages: number;
  messages_per_month: number;
}

interface Subscription {
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  plan: Plan;
}

interface UseSubscriptionResult {
  subscription: Subscription | null;
  loading: boolean;
}

export function useSubscription(): UseSubscriptionResult {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/billing/subscription')
      .then(({ data }) => setSubscription(data.subscription ?? null))
      .catch(() => setSubscription(null))
      .finally(() => setLoading(false));
  }, []);

  return { subscription, loading };
}
