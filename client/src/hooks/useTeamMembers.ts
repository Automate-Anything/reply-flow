import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface TeamMember {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role_name: string;
}

export function useTeamMembers(enabled = true) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = useCallback(async () => {
    if (!enabled) {
      setMembers([]);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/team/members');
      setMembers(
        (data.members || []).map((m: Record<string, any>) => {
          const user = m.users || {};
          const role = m.roles || {};
          return {
            id: m.id,
            user_id: m.user_id,
            full_name: user.full_name || user.email || 'Unknown',
            email: user.email,
            avatar_url: user.avatar_url || null,
            role_name: role.name || 'staff',
          };
        })
      );
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchMembers();
  }, [enabled, fetchMembers]);

  return { members, loading, refetch: fetchMembers };
}
