import { useState, useEffect } from 'react';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PhoneInput from '@/components/ui/phone-input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { Contact } from '@/hooks/useContacts';

interface ContactFormProps {
  contact?: Contact | null;
  onSave: () => void;
  onCancel: () => void;
}

export default function ContactForm({ contact, onSave, onCancel }: ContactFormProps) {
  const [form, setForm] = useState({
    phone_number: '',
    first_name: '',
    last_name: '',
    email: '',
    company: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  useEffect(() => {
    if (contact) {
      setForm({
        phone_number: contact.phone_number || '',
        first_name: contact.first_name || '',
        last_name: contact.last_name || '',
        email: contact.email || '',
        company: contact.company || '',
      });
    }
  }, [contact]);

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
    setSaving(true);
    try {
      if (contact) {
        await api.put(`/contacts/${contact.id}`, form);
        toast.success('Contact updated');
      } else {
        await api.post('/contacts', form);
        toast.success('Contact created');
      }
      onSave();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save contact';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>{contact ? 'Edit Contact' : 'New Contact'}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Label>Company</Label>
            <Input
              value={form.company}
              onChange={(e) => update('company', e.target.value)}
              placeholder="Acme Inc."
            />
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : contact ? 'Update' : 'Create'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
