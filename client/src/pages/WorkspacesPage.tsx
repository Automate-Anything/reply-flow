import { useState } from 'react';
import { useWorkspaces, type Workspace } from '@/hooks/useWorkspaces';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Bot, Plus, Smartphone, Loader2, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';

export default function WorkspacesPage() {
  const { workspaces, loading, createWorkspace, updateWorkspace, deleteWorkspace } = useWorkspaces();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createWorkspace({ name: newName.trim(), description: newDesc.trim() || undefined });
      toast.success('Workspace created');
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create workspace';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (ws: Workspace) => {
    setEditingId(ws.id);
    setEditName(ws.name);
    setEditDesc(ws.description || '');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    try {
      await updateWorkspace(editingId, { name: editName.trim(), description: editDesc.trim() || undefined });
      toast.success('Workspace updated');
      setEditingId(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update workspace';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await deleteWorkspace(id);
      toast.success('Workspace deleted');
      setDeletingId(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete workspace';
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Manage your workspaces. Use the sidebar dropdown to switch between workspaces.
        </p>
        <Button onClick={() => setShowCreate(true)} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" /> New Workspace
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      ) : workspaces.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Bot className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No workspaces yet</p>
              <p className="text-xs text-muted-foreground">
                Create a workspace to set up AI profiles and knowledge bases for your channels.
              </p>
            </div>
            <Button onClick={() => setShowCreate(true)} variant="outline" className="mt-2 gap-2">
              <Plus className="h-4 w-4" /> Create Workspace
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {workspaces.map((ws) => (
            <Card key={ws.id}>
              <CardContent className="flex items-center gap-4 py-4 px-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Bot className="h-5 w-5 text-primary" />
                </div>

                {editingId === ws.id ? (
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Workspace name"
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                      autoFocus
                    />
                    <Input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit} disabled={!editName.trim() || saving}>
                        {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{ws.name}</p>
                        {ws.ai_enabled && (
                          <Badge variant="outline" className="shrink-0 text-xs bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                            AI Active
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Smartphone className="h-3 w-3" />
                          {ws.channel_count} {ws.channel_count === 1 ? 'channel' : 'channels'}
                        </span>
                        {ws.description && (
                          <span className="truncate">{ws.description}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {deletingId === ws.id ? (
                        <>
                          <span className="mr-1 text-xs text-muted-foreground">Delete?</span>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(ws.id)}
                            disabled={deleting}
                          >
                            {deleting && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                            Confirm
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeletingId(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => startEditing(ws)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeletingId(ws.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create workspace dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
            <DialogDescription>
              A workspace groups channels with a shared AI profile and knowledge base.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="e.g., Customer Support"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                placeholder="Brief description of this workspace"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
