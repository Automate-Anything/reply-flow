import { useState, useEffect } from 'react';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import PhoneInput from '@/components/ui/phone-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UnsavedChangesDialog } from '@/components/ui/unsaved-changes-dialog';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { Contact } from '@/hooks/useContacts';
import type { ContactTag } from '@/hooks/useContactTags';
import type { CustomFieldDefinition, CustomFieldValue } from '@/hooks/useCustomFields';
import TagInput from './TagInput';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useFormDirtyGuard } from '@/contexts/FormGuardContext';

interface ContactFormProps {
  contact?: Contact | null;
  onSave: () => void;
  onCancel: () => void;
  availableTags?: ContactTag[];
  customFieldDefinitions?: CustomFieldDefinition[];
  existingCustomFieldValues?: CustomFieldValue[];
  onCreateTag?: (name: string) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function ContactForm({
  contact,
  onSave,
  onCancel,
  availableTags = [],
  customFieldDefinitions = [],
  existingCustomFieldValues = [],
  onCreateTag,
  onDirtyChange,
}: ContactFormProps) {
  const [form, setForm] = useState({
    phone_number: '',
    first_name: '',
    last_name: '',
    email: '',
    company: '',
    tags: [] as string[],
    address_street: '',
    address_city: '',
    address_state: '',
    address_postal_code: '',
    address_country: '',
  });
  const [originalForm, setOriginalForm] = useState({
    phone_number: '',
    first_name: '',
    last_name: '',
    email: '',
    company: '',
    tags: [] as string[],
    address_street: '',
    address_city: '',
    address_state: '',
    address_postal_code: '',
    address_country: '',
  });
  const [customValues, setCustomValues] = useState<Record<string, string | string[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  const { isDirty, showDialog, guardedClose, handleKeepEditing, handleDiscard } = useUnsavedChanges(form, originalForm);

  useFormDirtyGuard(isDirty);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (contact) {
      const values = {
        phone_number: contact.phone_number || '',
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        email: contact.email || '',
        company: contact.company || '',
        tags: contact.tags || [],
        address_street: contact.address_street || '',
        address_city: contact.address_city || '',
        address_state: contact.address_state || '',
        address_postal_code: contact.address_postal_code || '',
        address_country: contact.address_country || '',
      };
      setForm(values);
      setOriginalForm(values);
    }
  }, [contact]);

  // Populate custom field values when editing
  useEffect(() => {
    if (existingCustomFieldValues.length > 0) {
      const values: Record<string, string | string[]> = {};
      for (const cfv of existingCustomFieldValues) {
        if (cfv.field_definition.field_type === 'multi_select') {
          values[cfv.field_definition_id] = cfv.value_json || [];
        } else {
          values[cfv.field_definition_id] = cfv.value || '';
        }
      }
      setCustomValues(values);
    }
  }, [existingCustomFieldValues]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPhoneError('');
    if (!form.phone_number.trim()) {
      setPhoneError('Phone number is required');
      return;
    }
    if (!isValidPhoneNumber(form.phone_number)) {
      setPhoneError('Invalid phone number for the selected country');
      return;
    }

    // Validate required custom fields
    for (const def of customFieldDefinitions) {
      if (def.is_required) {
        const val = customValues[def.id];
        if (!val || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && !val.trim())) {
          setError(`${def.name} is required`);
          return;
        }
      }
    }

    setSaving(true);
    try {
      // Build custom_field_values array
      const cfvArray = customFieldDefinitions
        .map((def) => {
          const val = customValues[def.id];
          if (def.field_type === 'multi_select') {
            return { field_definition_id: def.id, value_json: val || [] };
          }
          return { field_definition_id: def.id, value: val || '' };
        });

      const payload = { ...form, custom_field_values: cfvArray };

      if (contact) {
        await api.put(`/contacts/${contact.id}`, payload);
        toast.success('Contact updated');
      } else {
        await api.post('/contacts', payload);
        toast.success('Contact created');
      }
      onSave();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; message?: string } } };
      const message = axiosErr.response?.data?.message
        || axiosErr.response?.data?.error
        || (err instanceof Error ? err.message : 'Failed to save contact');
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const setCustomValue = (defId: string, value: string | string[]) => {
    setCustomValues((prev) => ({ ...prev, [defId]: value }));
  };

  return (
    <>
    <Card className="w-full rounded-none border-0 shadow-none bg-transparent">
      <CardHeader>
        <CardTitle>{contact ? 'Edit Contact' : 'New Contact'}</CardTitle>
      </CardHeader>
      <CardContent className="max-w-xl">
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input
                value={form.first_name}
                onChange={(e) => update('first_name', e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input
                value={form.last_name}
                onChange={(e) => update('last_name', e.target.value)}
                placeholder="Doe"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone Number *</Label>
              <PhoneInput
                value={form.phone_number}
                onChange={(val) => {
                  update('phone_number', val);
                  if (phoneError) setPhoneError('');
                }}
                error={phoneError}
                disabled={saving}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Input
              value={form.company}
              onChange={(e) => update('company', e.target.value)}
              placeholder="Acme Inc."
            />
          </div>

          {/* Address */}
          <Separator />
          <h4 className="text-sm font-medium">Address</h4>
          <div className="space-y-2">
            <Input
              value={form.address_street}
              onChange={(e) => update('address_street', e.target.value)}
              placeholder="Street address"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              value={form.address_city}
              onChange={(e) => update('address_city', e.target.value)}
              placeholder="City"
            />
            <Input
              value={form.address_state}
              onChange={(e) => update('address_state', e.target.value)}
              placeholder="State / Province"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              value={form.address_postal_code}
              onChange={(e) => update('address_postal_code', e.target.value)}
              placeholder="Postal code"
            />
            <Input
              value={form.address_country}
              onChange={(e) => update('address_country', e.target.value)}
              placeholder="Country"
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label>Tags</Label>
            <TagInput
              value={form.tags}
              onChange={(tags) => setForm((prev) => ({ ...prev, tags }))}
              availableTags={availableTags}
              onCreateTag={onCreateTag}
              disabled={saving}
            />
          </div>

          {/* Custom Fields */}
          {customFieldDefinitions.length > 0 && (
            <>
              <Separator />
              <h4 className="text-sm font-medium">Additional Information</h4>
              {customFieldDefinitions.map((def) => (
                <div key={def.id} className="space-y-2">
                  <Label>
                    {def.name}
                    {def.is_required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  {renderCustomField(def, customValues[def.id], (val) => setCustomValue(def.id, val))}
                </div>
              ))}
            </>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : contact ? 'Update' : 'Create'}
            </Button>
            <Button type="button" variant="outline" onClick={() => guardedClose(onCancel)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <UnsavedChangesDialog
      open={showDialog}
      onKeepEditing={handleKeepEditing}
      onDiscard={handleDiscard}
      onSave={() => handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
      saving={saving}
    />
    </>
  );
}

function renderCustomField(
  def: CustomFieldDefinition,
  value: string | string[] | undefined,
  onChange: (val: string | string[]) => void
) {
  switch (def.field_type) {
    case 'short_text':
      return (
        <Input
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.name}
        />
      );
    case 'long_text':
      return (
        <textarea
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={3}
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.name}
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          value={(value as string) || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.name}
        />
      );
    case 'dropdown':
      return (
        <Select value={(value as string) || ''} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder={`Select ${def.name}`} />
          </SelectTrigger>
          <SelectContent>
            {def.options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'radio':
      return (
        <div className="flex flex-wrap gap-2">
          {def.options.map((opt) => (
            <Button
              key={opt}
              type="button"
              variant={(value as string) === opt ? 'default' : 'outline'}
              size="sm"
              onClick={() => onChange(opt)}
            >
              {opt}
            </Button>
          ))}
        </div>
      );
    case 'multi_select': {
      const selected = (value as string[]) || [];
      return (
        <div className="space-y-1">
          {def.options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(opt)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onChange([...selected, opt]);
                  } else {
                    onChange(selected.filter((s) => s !== opt));
                  }
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}
