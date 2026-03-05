import { type ReactNode } from 'react';
import { usePlan } from '@/contexts/PlanContext';

interface PlanGateProps {
  children: ReactNode;
  /**
   * When true, renders a block-level (div) wrapper instead of inline (span).
   * Use this when wrapping block/full-width elements.
   */
  asBlock?: boolean;
}

/**
 * Wraps children and intercepts clicks when no active plan exists,
 * showing the "select a plan" modal instead of firing the action.
 */
export function PlanGate({ children, asBlock = false }: PlanGateProps) {
  const { hasActivePlan, planLoading, openNoPlanModal } = usePlan();

  if (planLoading || hasActivePlan) {
    return <>{children}</>;
  }

  if (asBlock) {
    return (
      <div className="relative">
        {children}
        <div
          className="absolute inset-0 z-50 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            openNoPlanModal();
          }}
        />
      </div>
    );
  }

  return (
    <span className="relative inline-block">
      {children}
      <span
        className="absolute inset-0 z-50 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          openNoPlanModal();
        }}
      />
    </span>
  );
}
