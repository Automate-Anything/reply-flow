import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '@/lib/api';
import { useSession } from './SessionContext';

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  channel_count: number;
  ai_enabled: boolean;
}

interface WorkspaceContextType {
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  loading: boolean;
  setActiveWorkspaceId: (id: string | null) => void;
  refetch: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

const STORAGE_KEY = 'reply-flow:activeWorkspaceId';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceIdRaw] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY)
  );
  const [loading, setLoading] = useState(true);

  const setActiveWorkspaceId = useCallback((id: string | null) => {
    setActiveWorkspaceIdRaw(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const { data } = await api.get('/workspaces');
      const ws: Workspace[] = data.workspaces || [];
      setWorkspaces(ws);

      // Auto-select first workspace if none selected or selection invalid
      if (ws.length > 0) {
        const currentValid = ws.some((w) => w.id === activeWorkspaceId);
        if (!activeWorkspaceId || !currentValid) {
          setActiveWorkspaceId(ws[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, setActiveWorkspaceId]);

  useEffect(() => {
    if (session) {
      fetchWorkspaces();
    }
  }, [session, fetchWorkspaces]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;

  return (
    <WorkspaceContext.Provider
      value={{
        activeWorkspaceId,
        activeWorkspace,
        workspaces,
        loading,
        setActiveWorkspaceId,
        refetch: fetchWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
}
