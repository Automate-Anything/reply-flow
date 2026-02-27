import { useCompanyKB } from '@/hooks/useCompanyKB';
import KnowledgeBase from '@/components/settings/KnowledgeBase';

export default function KnowledgeBasePage() {
  const { kbEntries, loading, addKBEntry, uploadKBFile, updateKBEntry, deleteKBEntry } =
    useCompanyKB();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage information that your AI agent can reference across all workspaces.
        </p>
      </div>

      <KnowledgeBase
        entries={kbEntries}
        onAdd={addKBEntry}
        onUpload={uploadKBFile}
        onUpdate={updateKBEntry}
        onDelete={deleteKBEntry}
        loading={loading}
      />
    </div>
  );
}
