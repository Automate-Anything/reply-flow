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

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = useCallback(async () => {
    try {
      const { data } = await api.get('/team/members');
      setMembers(
        (data.members || []).map((m: Record<string, unknown>) => ({
          id: m.id,
          user_id: m.user_id,
          full_name: m.full_name || m.email || 'Unknown',
          email: m.email,
          avatar_url: m.avatar_url || null,
          role_name: m.role_name || 'staff',
        }))
      );
    } catch (err) {
      console.error('Failed to fetch team members:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  return { members, loading, refetch: fetchMembers };
}
