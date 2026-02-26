import { useSession } from '@/contexts/SessionContext';

export function usePermission(resource: string, action: string): boolean {
  const { hasPermission } = useSession();
  return hasPermission(resource, action);
}
