import { useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft, Plus, ChevronDown, ChevronUp, Pencil, Trash2, Loader2, BookOpen, X,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { useCompanyKB } from '@/hooks/useCompanyKB';
import type { KBEntry, KBSearchResult } from '@/hooks/useCompanyKB';
import KnowledgeBase from '@/components/settings/KnowledgeBase';

export default function KnowledgeBasePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromChannelId = searchParams.get('from') === 'channel' ? searchParams.get('channelId') : null;
  const backPath = fromChannelId ? `/channels/${fromChannelId}?tab=knowledge-base` : null;

  const {
    knowledgeBases, loading,
    createKnowledgeBase, updateKnowledgeBase, deleteKnowledgeBase,
    fetchKBEntries, addKBEntry, uploadKBFile, updateKBEntry, deleteKBEntry,
    fetchEntryChunks, reembedEntry, searchKB,
  } = useCompanyKB();

  // Create KB form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Expanded KB
  const [expandedKbId, setExpandedKbId] = useState<string | null>(null);
  const [kbEntries, setKbEntries] = useState<Record<string, KBEntry[]>>({});
  const [loadingEntries, setLoadingEntries] = useState<string | null>(null);

  // Edit KB
  const [editingKbId, setEditingKbId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete KB
  const [deletingKbId, setDeletingKbId] = useState<string | null>(null);

  // Search test panel
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<KBSearchResult[]>([]);
  const [searchClassification, setSearchClassification] = useState<{ method: string; reasoning: string } | null>(null);
  const [searching, setSearching] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error('Name is required');
      return;
    }
    setCreating(true);
    try {
      const newKb = await createKnowledgeBase(newName.trim(), newDescription.trim() || undefined);
      setNewName('');
      setNewDescription('');
      setShowCreateForm(false);
      setExpandedKbId(newKb.id);
      setKbEntries((prev) => ({ ...prev, [newKb.id]: [] }));
      toast.success('Knowledge base created');
    } catch {
      toast.error('Failed to create knowledge base');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleExpand = useCallback(async (kbId: string) => {
    if (expandedKbId === kbId) {
      setExpandedKbId(null);
      return;
    }
    setExpandedKbId(kbId);
    if (!kbEntries[kbId]) {
      setLoadingEntries(kbId);
      try {
        const entries = await fetchKBEntries(kbId);
        setKbEntries((prev) => ({ ...prev, [kbId]: entries }));
      } catch {
        toast.error('Failed to load entries');
      } finally {
        setLoadingEntries(null);
      }
    }
  }, [expandedKbId, kbEntries, fetchKBEntries]);

  const handleStartEdit = (kb: { id: string; name: string; description: string | null }) => {
    setEditingKbId(kb.id);
    setEditName(kb.name);
    setEditDescription(kb.description || '');
  };

  const handleSaveEdit = async () => {
    if (!editingKbId || !editName.trim()) return;
    setSavingEdit(true);
    try {
      await updateKnowledgeBase(editingKbId, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      });
      setEditingKbId(null);
      toast.success('Knowledge base updated');
    } catch {
      toast.error('Failed to update knowledge base');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (kbId: string) => {
    setDeletingKbId(kbId);
    try {
      await deleteKnowledgeBase(kbId);
      if (expandedKbId === kbId) setExpandedKbId(null);
      // Clear stale search results — deleted KB entries may still be shown
      setSearchQuery('');
      setSearchResults([]);
      toast.success('Knowledge base deleted');
    } catch {
      toast.error('Failed to delete knowledge base');
    } finally {
      setDeletingKbId(null);
    }
  };

  // Scoped entry handlers
  const handleAddEntry = useCallback(
    (kbId: string) => async (entry: { title: string; content: string }) => {
      const newEntry = await addKBEntry(kbId, entry);
      setKbEntries((prev) => ({ ...prev, [kbId]: [newEntry, ...(prev[kbId] || [])] }));
      return newEntry;
    },
    [addKBEntry]
  );

  const handleUploadFile = useCallback(
    (kbId: string) => async (file: File, title?: string) => {
      const newEntry = await uploadKBFile(kbId, file, title);
      setKbEntries((prev) => ({ ...prev, [kbId]: [newEntry, ...(prev[kbId] || [])] }));
      return newEntry;
    },
    [uploadKBFile]
  );

  const handleUpdateEntry = useCallback(
    (kbId: string) => async (entryId: string, updates: { title?: string; content?: string }) => {
      const updated = await updateKBEntry(kbId, entryId, updates);
      setKbEntries((prev) => ({
        ...prev,
        [kbId]: (prev[kbId] || []).map((e) => (e.id === entryId ? updated : e)),
      }));
      return updated;
    },
    [updateKBEntry]
  );

  const handleDeleteEntry = useCallback(
    (kbId: string) => async (entryId: string) => {
      await deleteKBEntry(kbId, entryId);
      setKbEntries((prev) => ({
        ...prev,
        [kbId]: (prev[kbId] || []).filter((e) => e.id !== entryId),
      }));
    },
    [deleteKBEntry]
  );

  const handleFetchChunks = useCallback(
    (kbId: string) => async (entryId: string) => {
      return fetchEntryChunks(kbId, entryId);
    },
    [fetchEntryChunks]
  );

  const handleReembed = useCallback(
    (kbId: string) => async (entryId: string) => {
      await reembedEntry(kbId, entryId);
    },
    [reembedEntry]
  );

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchResults([]);
    setSearchClassification(null);
    try {
      const { results, queryClassification } = await searchKB(q);
      setSearchResults(results);
      setSearchClassification(queryClassification ?? null);
    } catch {
      toast.error('Search failed');
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        {backPath && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(backPath)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage information that your AI agent can reference across all channels.
          </p>
        </div>
        {!showCreateForm && (
          <Button size="sm" onClick={() => setShowCreateForm(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Create Knowledge Base
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">New Knowledge Base</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setShowCreateForm(false); setNewName(''); setNewDescription(''); }}
              className="h-7 w-7 p-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Product Info, Company Policies"
              className="h-8 text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Description (optional)</Label>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What kind of information is in this knowledge base?"
              className="h-8 text-sm"
            />
          </div>
          <Button size="sm" onClick={handleCreate} disabled={creating} className="h-8 text-xs">
            {creating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Plus className="mr-1.5 h-3 w-3" />}
            Create
          </Button>
        </div>
      )}

      {/* KB list */}
      {knowledgeBases.length > 0 ? (
        <div className="space-y-3">
          {knowledgeBases.map((kb) => {
            const isExpanded = expandedKbId === kb.id;
            const isEditing = editingKbId === kb.id;
            const isDeleting = deletingKbId === kb.id;
            const entries = kbEntries[kb.id] || [];
            const isLoadingEntries = loadingEntries === kb.id;

            return (
              <div key={kb.id} className="rounded-lg border">
                {/* KB header */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => !isEditing && handleToggleExpand(kb.id)}
                >
                  <BookOpen className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-7 text-sm"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); }}
                          autoFocus
                        />
                        <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit} className="h-7 text-xs shrink-0">
                          {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditingKbId(null)} className="h-7 text-xs shrink-0">
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="truncate text-sm font-medium">{kb.name}</p>
                        {kb.description && (
                          <p className="truncate text-xs text-muted-foreground">{kb.description}</p>
                        )}
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {kb.entry_count} {kb.entry_count === 1 ? 'entry' : 'entries'}
                      </span>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartEdit(kb)}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(kb.id)}
                          disabled={isDeleting}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        >
                          {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </>
                  )}
                </div>

                {/* Expanded entries */}
                {isExpanded && (
                  <div className="border-t px-4 py-3">
                    <KnowledgeBase
                      entries={entries}
                      onAdd={handleAddEntry(kb.id)}
                      onUpload={handleUploadFile(kb.id)}
                      onUpdate={handleUpdateEntry(kb.id)}
                      onDelete={handleDeleteEntry(kb.id)}
                      onFetchChunks={handleFetchChunks(kb.id)}
                      onReembed={handleReembed(kb.id)}
                      loading={isLoadingEntries}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !showCreateForm && (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              No knowledge bases yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a knowledge base to organize information for your AI agent.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCreateForm(true)}
              className="mt-4"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create Knowledge Base
            </Button>
          </div>
        )
      )}

      {/* Search test panel */}
      {knowledgeBases.length > 0 && (
        <div className="rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            onClick={() => setShowSearch(!showSearch)}
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">Test Search</span>
            <span className="text-xs text-muted-foreground">Query your knowledge bases</span>
            {showSearch ? (
              <ChevronUp className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
          </button>

          {showSearch && (
            <div className="border-t px-4 py-3 space-y-3">
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type a query to test knowledge base search..."
                  className="h-8 text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                />
                <Button
                  size="sm"
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  className="h-8 shrink-0 gap-1.5 text-xs"
                >
                  {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                  Search
                </Button>
              </div>

              {searching && (
                <div className="space-y-2">
                  <div className="h-16 animate-pulse rounded bg-muted" />
                  <div className="h-16 animate-pulse rounded bg-muted" />
                </div>
              )}

              {!searching && searchResults.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">{searchResults.length} results</p>
                    {searchClassification && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary" title={searchClassification.reasoning}>
                        {searchClassification.method.toUpperCase()}
                      </span>
                    )}
                  </div>
                  {searchResults.map((result, i) => (
                    <div key={result.id} className="rounded border bg-muted/30 p-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">#{i + 1}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {searchClassification?.method === 'vector' ? 'Sim' : searchClassification?.method === 'fts' ? 'FTS' : 'RRF'}: {result.rrfScore.toFixed(4)}
                        </span>
                        {result.vectorRank > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            Vector: #{result.vectorRank}
                          </span>
                        )}
                        {result.ftsRank > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            FTS: #{result.ftsRank}
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed">
                        {result.content.slice(0, 300)}{result.content.length > 300 ? '...' : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {!searching && searchResults.length === 0 && searchQuery.trim() && (
                <p className="text-xs text-muted-foreground">No results. Try a different query.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
