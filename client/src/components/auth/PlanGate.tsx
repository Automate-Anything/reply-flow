import {
  cloneElement,
  forwardRef,
  isValidElement,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { usePlan } from '@/contexts/PlanContext';

interface PlanGateProps {
  children: ReactNode;
  /**
   * When true, renders a block-level (div) wrapper instead of inline (span).
   * Use this when wrapping block/full-width elements.
   */
  asBlock?: boolean;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (value: T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') {
        ref(value);
      } else {
        (ref as MutableRefObject<T | null>).current = value;
      }
    }
  };
}

function composeEventHandlers<E>(
  childHandler?: (event: E) => void,
  parentHandler?: (event: E) => void,
) {
  return (event: E) => {
    childHandler?.(event);
    parentHandler?.(event);
  };
}

/**
 * Wraps children and intercepts clicks when no active plan exists,
 * showing the "select a plan" modal instead of firing the action.
 */
export const PlanGate = forwardRef<HTMLElement, PlanGateProps & Record<string, unknown>>(function PlanGate(
  { children, asBlock = false, ...forwardedProps },
  forwardedRef,
) {
  const { hasActivePlan, planLoading, openNoPlanModal } = usePlan();

  const gateClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openNoPlanModal();
  };

  const gatePointerDown = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const gateKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      openNoPlanModal();
    }
  };

  if (isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown> & { ref?: Ref<HTMLElement> }>;
    const childProps = child.props || {};
    const injectedProps = {
      ...forwardedProps,
      ref: mergeRefs<HTMLElement>((child as unknown as { ref?: Ref<HTMLElement> }).ref, forwardedRef),
      className: [childProps.className, forwardedProps.className].filter(Boolean).join(' ') || undefined,
      style: { ...(childProps.style as object || {}), ...(forwardedProps.style as object || {}) },
      onClick: composeEventHandlers(
        childProps.onClick as ((event: MouseEvent<HTMLElement>) => void) | undefined,
        forwardedProps.onClick as ((event: MouseEvent<HTMLElement>) => void) | undefined,
      ),
      onPointerDown: composeEventHandlers(
        childProps.onPointerDown as ((event: MouseEvent<HTMLElement>) => void) | undefined,
        forwardedProps.onPointerDown as ((event: MouseEvent<HTMLElement>) => void) | undefined,
      ),
      onKeyDown: composeEventHandlers(
        childProps.onKeyDown as ((event: KeyboardEvent<HTMLElement>) => void) | undefined,
        forwardedProps.onKeyDown as ((event: KeyboardEvent<HTMLElement>) => void) | undefined,
      ),
    };

    if (planLoading || hasActivePlan) {
      return cloneElement(child, injectedProps);
    }

    return cloneElement(child, {
      ...injectedProps,
      onClickCapture: composeEventHandlers(
        childProps.onClickCapture as ((event: MouseEvent<HTMLElement>) => void) | undefined,
        gateClick,
      ),
      onPointerDownCapture: composeEventHandlers(
        childProps.onPointerDownCapture as ((event: MouseEvent<HTMLElement>) => void) | undefined,
        gatePointerDown,
      ),
      onKeyDownCapture: composeEventHandlers(
        childProps.onKeyDownCapture as ((event: KeyboardEvent<HTMLElement>) => void) | undefined,
        gateKeyDown,
      ),
    });
  }

  if (planLoading || hasActivePlan) {
    return <>{children}</>;
  }

  if (asBlock) {
    return (
      <div className="relative">
        {children as ReactNode}
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
      {children as ReactNode}
      <span
        className="absolute inset-0 z-50 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          openNoPlanModal();
        }}
      />
    </span>
  );
});
