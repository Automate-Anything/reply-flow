import { useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function AgreementEditorDialog({ open, onOpenChange, onCreated }: Props) {
  const [version, setVersion] = useState('');
  const [termsText, setTermsText] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setVersion('');
    setTermsText('');
  };

  const handleClose = (open: boolean) => {
    if (!open) resetForm();
    onOpenChange(open);
  };

  const handleSubmit = async () => {
    if (!version.trim()) {
      toast.error('Version is required');
      return;
    }
    if (!termsText.trim()) {
      toast.error('Terms text is required');
      return;
    }

    setSaving(true);
    try {
      await api.post('/affiliate/admin/agreements', {
        version: version.trim(),
        terms_text: termsText.trim(),
      });
      toast.success('Agreement version created');
      onCreated();
      handleClose(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create agreement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Agreement Version</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="agreement-version">Version</Label>
            <Input
              id="agreement-version"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 1.0, 2.0"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agreement-terms">Terms Text</Label>
            <Textarea
              id="agreement-terms"
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              placeholder="Enter the full agreement terms..."
              rows={12}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Creating...' : 'Create Version'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
