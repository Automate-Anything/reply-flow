import { useEffect, useState } from 'react';
import { useSession } from '@/contexts/SessionContext';
import { useDebugMode } from '@/hooks/useDebugMode';

interface HoveredInfo {
  rect: DOMRect;
  componentName: string;
  dimensions: string;
}

export default function DebugOverlay() {
  const { isSuperAdmin } = useSession();
  const { debugMode } = useDebugMode();
  const [hovered, setHovered] = useState<HoveredInfo | null>(null);

  useEffect(() => {
    if (!isSuperAdmin || !debugMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el) return;

      // Find nearest data-component ancestor
      const componentEl = el.closest('[data-component]') as HTMLElement | null;
      const target = componentEl || el;
      const rect = target.getBoundingClientRect();

      setHovered({
        rect,
        componentName:
          target.getAttribute('data-component') ||
          target.tagName.toLowerCase(),
        dimensions: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
      });
    };

    const handleMouseLeave = () => setHovered(null);

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.body.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.body.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [isSuperAdmin, debugMode]);

  if (!isSuperAdmin || !debugMode || !hovered) return null;

  return (
    <>
      {/* Border overlay */}
      <div
        style={{
          position: 'fixed',
          top: hovered.rect.top,
          left: hovered.rect.left,
          width: hovered.rect.width,
          height: hovered.rect.height,
          border: '1px solid rgba(139, 92, 246, 0.6)',
          backgroundColor: 'rgba(139, 92, 246, 0.04)',
          pointerEvents: 'none',
          zIndex: 9999,
        }}
      />
      {/* Label tooltip */}
      <div
        style={{
          position: 'fixed',
          top: Math.max(0, hovered.rect.top - 24),
          left: hovered.rect.left,
          background: 'rgba(139, 92, 246, 0.9)',
          color: 'white',
          fontSize: '10px',
          fontFamily: 'monospace',
          padding: '2px 6px',
          borderRadius: '3px',
          pointerEvents: 'none',
          zIndex: 10000,
          whiteSpace: 'nowrap',
        }}
      >
        {hovered.componentName} {hovered.dimensions}
      </div>
    </>
  );
}
