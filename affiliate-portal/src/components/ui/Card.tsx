import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

function Card({ title, children, className = '' }: CardProps) {
  return (
    <div
      className={`bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))] rounded-lg shadow p-6 ${className}`}
    >
      {title && (
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
      )}
      {children}
    </div>
  );
}

export { Card };
export type { CardProps };
