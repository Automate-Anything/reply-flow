import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface CustomFieldDefinition {
  id: string;
  name: string;
  field_type: 'short_text' | 'long_text' | 'number' | 'dropdown' | 'radio' | 'multi_select';
  options: string[];
  display_order: number;
  is_required: boolean;
  is_active: boolean;
}

export interface CustomFieldValue {
  id: string;
  contact_id: string;
  field_definition_id: string;
  value: string | null;
  value_json: string[] | null;
  field_definition: CustomFieldDefinition;
}

export function useCustomFieldDefinitions() {
  const [definitions, setDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDefinitions = useCallback(async () => {
    try {
      const { data } = await api.get('/custom-fields/definitions');
      setDefinitions(data.definitions || []);
    } catch {
      console.error('Failed to fetch custom field definitions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  const create = useCallback(async (def: {
    name: string;
    field_type: string;
    options?: string[];
    is_required?: boolean;
  }) => {
    const { data } = await api.post('/custom-fields/definitions', def);
    setDefinitions((prev) => [...prev, data.definition]);
    return data.definition as CustomFieldDefinition;
  }, []);

  const update = useCallback(async (defId: string, updates: Partial<CustomFieldDefinition>) => {
    const { data } = await api.put(`/custom-fields/definitions/${defId}`, updates);
    setDefinitions((prev) => prev.map((d) => (d.id === defId ? data.definition : d)));
  }, []);

  const remove = useCallback(async (defId: string) => {
    await api.delete(`/custom-fields/definitions/${defId}`);
    setDefinitions((prev) => prev.filter((d) => d.id !== defId));
  }, []);

  const reorder = useCallback(async (order: { id: string; display_order: number }[]) => {
    await api.put('/custom-fields/definitions/reorder', { order });
    setDefinitions((prev) => {
      const map = new Map(order.map((o) => [o.id, o.display_order]));
      return [...prev]
        .map((d) => ({ ...d, display_order: map.get(d.id) ?? d.display_order }))
        .sort((a, b) => a.display_order - b.display_order);
    });
  }, []);

  return { definitions, loading, refetch: fetchDefinitions, create, update, remove, reorder };
}
