import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';

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
  const [hasActivePlan, setHasActivePlan] = useState(true);
  const [planLoading, setPlanLoading] = useState(true);

  useEffect(() => {
    api.get('/billing/subscription')
      .then(({ data }) => {
        const sub = data.subscription;
        setHasActivePlan(!!sub && (sub.status === 'active' || sub.status === 'trialing'));
      })
      .catch(() => setHasActivePlan(false))
      .finally(() => setPlanLoading(false));
  }, []);

  // Redirect to /plans when no active subscription
  useEffect(() => {
    if (!planLoading && !hasActivePlan) {
      navigate('/plans', { replace: true });
    }
  }, [planLoading, hasActivePlan, navigate]);

  const openNoPlanModal = useCallback(() => {
    navigate('/plans');
  }, [navigate]);

  if (planLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <PlanContext.Provider value={{ hasActivePlan, planLoading, openNoPlanModal }}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}
