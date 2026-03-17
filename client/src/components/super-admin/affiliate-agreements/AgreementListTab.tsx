import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, Plus } from 'lucide-react';
import { AgreementEditorDialog } from './AgreementEditorDialog';

interface Agreement {
  id: string;
  version: string;
  terms_text: string;
  created_at: string;
  accepted_count: number;
}

export function AgreementListTab() {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);

  const fetchAgreements = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ agreements: Agreement[] }>('/affiliate/admin/agreements');
      setAgreements(data.agreements);
    } catch {
      toast.error('Failed to load agreements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgreements();
  }, [fetchAgreements]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Affiliate Agreements</h2>
        </div>
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Create New Version
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-64" />
      ) : agreements.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No agreement versions created yet.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Accepted By</TableHead>
                <TableHead>Preview</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agreements.map((agreement) => (
                <TableRow key={agreement.id}>
                  <TableCell className="font-medium">{agreement.version}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(agreement.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{agreement.accepted_count}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                    {agreement.terms_text.slice(0, 100)}
                    {agreement.terms_text.length > 100 ? '...' : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AgreementEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onCreated={fetchAgreements}
      />
    </div>
  );
}
