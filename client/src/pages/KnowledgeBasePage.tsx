import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useCompanyKB } from '@/hooks/useCompanyKB';
import KnowledgeBase from '@/components/settings/KnowledgeBase';

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromChannelId = searchParams.get('from') === 'channel' ? searchParams.get('channelId') : null;
  const backPath = fromChannelId ? `/channels/${fromChannelId}?tab=knowledge-base` : null;
  const shouldOpenAdd = searchParams.get('action') === 'add';

  const { kbEntries, loading, addKBEntry, uploadKBFile, updateKBEntry, deleteKBEntry } =
    useCompanyKB();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        {backPath && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(backPath)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage information that your AI agent can reference across all channels.
          </p>
        </div>
      </div>

      <KnowledgeBase
        entries={kbEntries}
        onAdd={addKBEntry}
        onUpload={uploadKBFile}
        onUpdate={updateKBEntry}
        onDelete={deleteKBEntry}
        loading={loading}
        initialOpen={shouldOpenAdd}
      />
    </div>
  );
}
