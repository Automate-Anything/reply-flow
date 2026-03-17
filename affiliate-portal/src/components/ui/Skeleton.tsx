interface SkeletonProps {
  className?: string;
}

function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-[hsl(var(--muted))] rounded ${className}`}
    />
  );
}

export { Skeleton };
