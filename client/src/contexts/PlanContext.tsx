import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';

const PLAN_CACHE_KEY = 'reply-flow-plan';

function getCachedPlan(): boolean | null {
  try {
    const cached = localStorage.getItem(PLAN_CACHE_KEY);
    return cached !== null ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

interface PlanContextType {
  hasActivePlan: boolean;
  planLoading: boolean;
  openNoPlanModal: () => void;
}

const PlanContext = createContext<PlanContextType>({
  hasActivePlan: true,
  planLoading: false,
  openNoPlanModal: () => {},
});

export function PlanProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const cachedPlan = getCachedPlan();
  // Default to true so we never block rendering — worst case, PlanGate buttons
  // are briefly enabled then disabled if the user has no plan.
  const [hasActivePlan, setHasActivePlan] = useState(cachedPlan ?? true);
  const [planLoading, setPlanLoading] = useState(true);
  // Only redirect after a successful API response confirms no plan — never from
  // cache or after errors (network hiccup, server restart, etc.).
  const [checkedServer, setCheckedServer] = useState(false);

  useEffect(() => {
    api.get('/billing/subscription')
      .then(({ data }) => {
        const sub = data.subscription;
        const active = !!sub && (sub.status === 'active' || sub.status === 'trialing');
        setHasActivePlan(active);
        localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(active));
        setCheckedServer(true);
      })
      .catch(() => {
        // API error (network, auth race, server restart) — do NOT poison the
        // cache or flip hasActivePlan. Leave at current value (true / cached).
      })
      .finally(() => setPlanLoading(false));
  }, []);

  useEffect(() => {
    if (checkedServer && !hasActivePlan) {
      navigate('/plans', { replace: true });
    }
  }, [checkedServer, hasActivePlan, navigate]);

  const openNoPlanModal = useCallback(() => {
    navigate('/plans');
  }, [navigate]);

  return (
    <PlanContext.Provider value={{ hasActivePlan, planLoading, openNoPlanModal }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}
