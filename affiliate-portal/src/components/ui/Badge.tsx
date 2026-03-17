import type { ReactNode } from 'react';

const variants = {
  default: 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]',
  success: 'bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
  warning: 'bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
  destructive: 'bg-[hsl(var(--destructive)/0.15)] text-[hsl(var(--destructive))]',
  info: 'bg-[hsl(var(--info)/0.15)] text-[hsl(var(--info))]',
  outline: 'border border-[hsl(var(--border))] text-[hsl(var(--foreground))]',
} as const;

interface BadgeProps {
  variant?: keyof typeof variants;
  children: ReactNode;
  className?: string;
}

function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeProps };
