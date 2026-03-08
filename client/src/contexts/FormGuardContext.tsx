import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface FormGuardContextType {
  /** Forms call this to register/unregister their dirty state */
  setFormDirty: (dirty: boolean) => void;
  /** Wrap any navigation action — shows confirm dialog if a form is dirty */
  guardNavigation: (proceed: () => void) => boolean;
}

const FormGuardContext = createContext<FormGuardContextType>({
  setFormDirty: () => {},
  guardNavigation: (proceed) => { proceed(); return false; },
});

export function useFormGuard() {
  return useContext(FormGuardContext);
}

/**
 * Hook for forms to register their dirty state with the global guard.
 * Also handles beforeunload for page refresh/tab close.
 */
export function useFormDirtyGuard(isDirty: boolean) {
  const { setFormDirty } = useFormGuard();

  useEffect(() => {
    setFormDirty(isDirty);
    return () => setFormDirty(false);
  }, [isDirty, setFormDirty]);

  // Block browser refresh / tab close when dirty
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}

export function FormGuardProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const setFormDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const guardNavigation = useCallback((proceed: () => void) => {
    if (dirtyRef.current) {
      setPendingAction(() => proceed);
      return true; // blocked
    }
    proceed();
    return false; // not blocked
  }, []);

  return (
    <FormGuardContext.Provider value={{ setFormDirty, guardNavigation }}>
      {children}
      <ConfirmDialog
        open={!!pendingAction}
        onOpenChange={(open) => !open && setPendingAction(null)}
        title="Unsaved changes"
        description="You have unsaved changes that will be lost if you navigate away."
        actionLabel="Discard"
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          dirtyRef.current = false;
          action?.();
        }}
      />
    </FormGuardContext.Provider>
  );
}
