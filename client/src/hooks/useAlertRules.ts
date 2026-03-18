import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { GroupCriteria, AlertRule, GroupChat } from '@/types/groups';

function buildAlertRules(criteria: GroupCriteria[], groups: GroupChat[]): AlertRule[] {
  const groupMap = new Map(groups.map((g) => [g.id, g.group_name || g.group_jid]));
  const ruleMap = new Map<string, AlertRule>();

  for (const c of criteria) {
    const key = c.rule_group_id || c.id;

    if (ruleMap.has(key)) {
      const existing = ruleMap.get(key)!;
      if (c.group_chat_id && existing.scope) {
        existing.scope.push(c.group_chat_id);
        existing.scope_names = existing.scope.map((id) => groupMap.get(id) || id);
      }
    } else {
      ruleMap.set(key, {
        id: c.id,
        rule_group_id: c.rule_group_id,
        name: c.name,
        match_type: c.match_type,
        keyword_config: c.keyword_config,
        ai_description: c.ai_description,
        notify_user_ids: c.notify_user_ids,
        is_enabled: c.is_enabled,
        scope: c.group_chat_id ? [c.group_chat_id] : null,
        scope_names: c.group_chat_id
          ? [groupMap.get(c.group_chat_id) || c.group_chat_id]
          : undefined,
        created_at: c.created_at,
      });
    }
  }

  return Array.from(ruleMap.values());
}

export function useAlertRules(groups: GroupChat[]) {
  const [rawCriteria, setRawCriteria] = useState<GroupCriteria[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCriteria = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/groups/all-criteria');
      setRawCriteria(data.criteria || []);
    } catch (err) {
      console.error('Failed to fetch alert rules:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCriteria();
  }, [fetchCriteria]);

  const rules = buildAlertRules(rawCriteria, groups);

  const createRule = useCallback(
    async (values: {
      name: string;
      match_type: 'keyword' | 'ai';
      keyword_config?: { keywords: string[]; operator: 'and' | 'or' };
      ai_description?: string;
      notify_user_ids: string[];
      scope: string[] | null;
    }) => {
      const groupIds = values.scope || [null];
      const ruleGroupId = groupIds.length > 1 ? crypto.randomUUID() : null;

      const rows = groupIds.map((gid) => ({
        group_chat_id: gid,
        rule_group_id: ruleGroupId,
        name: values.name,
        match_type: values.match_type,
        keyword_config: values.keyword_config || {},
        ai_description: values.ai_description || null,
        notify_user_ids: values.notify_user_ids,
        is_enabled: true,
      }));

      for (const row of rows) {
        await api.post('/groups/criteria', row);
      }

      await fetchCriteria();
      toast.success('Alert rule created');
    },
    [fetchCriteria]
  );

  const updateRule = useCallback(
    async (
      rule: AlertRule,
      values: {
        name?: string;
        match_type?: 'keyword' | 'ai';
        keyword_config?: { keywords: string[]; operator: 'and' | 'or' };
        ai_description?: string;
        notify_user_ids?: string[];
        is_enabled?: boolean;
        scope?: string[] | null;
      }
    ) => {
      if (values.scope !== undefined) {
        const existingRows = rawCriteria.filter(
          (c) =>
            c.id === rule.id ||
            (rule.rule_group_id && c.rule_group_id === rule.rule_group_id)
        );
        for (const row of existingRows) {
          await api.delete(`/groups/criteria/${row.id}`);
        }

        await createRule({
          name: values.name || rule.name,
          match_type: values.match_type || rule.match_type,
          keyword_config: values.keyword_config || rule.keyword_config,
          ai_description: values.ai_description ?? rule.ai_description,
          notify_user_ids: values.notify_user_ids || rule.notify_user_ids,
          scope: values.scope,
        });
        return;
      }

      const rowIds = rule.rule_group_id
        ? rawCriteria
            .filter((c) => c.rule_group_id === rule.rule_group_id)
            .map((c) => c.id)
        : [rule.id];

      const updatePayload: Record<string, unknown> = {};
      if (values.name !== undefined) updatePayload.name = values.name;
      if (values.match_type !== undefined) updatePayload.match_type = values.match_type;
      if (values.keyword_config !== undefined) updatePayload.keyword_config = values.keyword_config;
      if (values.ai_description !== undefined) updatePayload.ai_description = values.ai_description;
      if (values.notify_user_ids !== undefined) updatePayload.notify_user_ids = values.notify_user_ids;
      if (values.is_enabled !== undefined) updatePayload.is_enabled = values.is_enabled;

      for (const id of rowIds) {
        await api.patch(`/groups/criteria/${id}`, updatePayload);
      }

      await fetchCriteria();
    },
    [rawCriteria, fetchCriteria, createRule]
  );

  const deleteRule = useCallback(
    async (rule: AlertRule) => {
      const rowIds = rule.rule_group_id
        ? rawCriteria
            .filter((c) => c.rule_group_id === rule.rule_group_id)
            .map((c) => c.id)
        : [rule.id];

      for (const id of rowIds) {
        await api.delete(`/groups/criteria/${id}`);
      }

      await fetchCriteria();
      toast.success('Alert rule deleted');
    },
    [rawCriteria, fetchCriteria]
  );

  const toggleRule = useCallback(
    async (rule: AlertRule, enabled: boolean) => {
      const rowIds = rule.rule_group_id
        ? rawCriteria
            .filter((c) => c.rule_group_id === rule.rule_group_id)
            .map((c) => c.id)
        : [rule.id];

      for (const id of rowIds) {
        await api.patch(`/groups/criteria/${id}`, { is_enabled: enabled });
      }

      setRawCriteria((prev) =>
        prev.map((c) =>
          rowIds.includes(c.id) ? { ...c, is_enabled: enabled } : c
        )
      );
    },
    [rawCriteria]
  );

  return { rules, rawCriteria, loading, refetch: fetchCriteria, createRule, updateRule, deleteRule, toggleRule };
}
