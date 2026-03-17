import type { ReactNode } from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="bg-[hsl(var(--card))] rounded-lg shadow p-8 text-center">
      <div className="flex justify-center mb-3 text-[hsl(var(--muted-foreground))]">
        {icon}
      </div>
      <p className="font-medium text-[hsl(var(--foreground))] mb-1">{title}</p>
      <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">{description}</p>
      {action && (
        <Button variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
