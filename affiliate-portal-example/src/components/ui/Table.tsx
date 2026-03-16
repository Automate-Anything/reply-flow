import type { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

function Table({ children, className = '' }: TableProps) {
  return (
    <div className={`bg-[hsl(var(--card))] rounded-lg shadow overflow-x-auto ${className}`}>
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
        {children}
      </tr>
    </thead>
  );
}

function TableHead({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 font-medium text-[hsl(var(--muted-foreground))] ${className}`}>
      {children}
    </th>
  );
}

function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

function TableRow({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-[hsl(var(--border)/0.5)] hover:bg-[hsl(var(--muted)/0.5)]">
      {children}
    </tr>
  );
}

function TableCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

export { Table, TableHeader, TableHead, TableBody, TableRow, TableCell };
