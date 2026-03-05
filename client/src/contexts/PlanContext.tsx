import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

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
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    api.get('/billing/subscription')
      .then(({ data }) => {
        const sub = data.subscription;
        setHasActivePlan(!!sub && (sub.status === 'active' || sub.status === 'trialing'));
      })
      .catch(() => setHasActivePlan(false))
      .finally(() => setPlanLoading(false));
  }, []);

  return (
    <PlanContext.Provider value={{ hasActivePlan, planLoading, openNoPlanModal: () => setModalOpen(true) }}>
      {children}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No Active Plan</DialogTitle>
            <DialogDescription>
              You need an active subscription to use this feature. Choose a plan to get started.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setModalOpen(false);
                navigate('/settings?tab=billing');
              }}
            >
              View Plans
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlanContext.Provider>
  );
}

export function usePlan() {
  return useContext(PlanContext);
}
