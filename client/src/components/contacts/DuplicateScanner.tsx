import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, GitMerge, Mail, User } from 'lucide-react';
import { useContactDuplicates, type DuplicateGroup } from '@/hooks/useContactDuplicates';
import MergeContactDialog from './MergeContactDialog';
import type { Contact } from '@/hooks/useContacts';

interface DuplicateScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMergeComplete: () => void;
}

export default function DuplicateScanner({
  open,
  onOpenChange,
  onMergeComplete,
}: DuplicateScannerProps) {
  const { groups, loading, scan } = useContactDuplicates();
  const [scanned, setScanned] = useState(false);
  const [mergeGroup, setMergeGroup] = useState<DuplicateGroup | null>(null);

  const handleScan = async () => {
    await scan();
    setScanned(true);
  };

  const handleMergeComplete = () => {
    setMergeGroup(null);
    onMergeComplete();
    // Re-scan after merge
    scan().then(() => setScanned(true));
  };

  const contactName = (c: Contact) =>
    [c.first_name, c.last_name].filter(Boolean).join(' ') || c.phone_number;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5" />
              Find Duplicates
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {!scanned ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <p className="text-sm text-muted-foreground text-center">
                  Scan your contacts for potential duplicates based on email
                  addresses and name similarity.
                </p>
                <Button onClick={handleScan} disabled={loading}>
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Scan for Duplicates
                </Button>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <p className="text-sm font-medium">No duplicates found</p>
                <p className="text-xs text-muted-foreground">
                  All your contacts appear to be unique.
                </p>
                <Button variant="outline" size="sm" className="mt-2" onClick={handleScan}>
                  Scan Again
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Found {groups.length} potential duplicate group{groups.length !== 1 ? 's' : ''}
                  </p>
                  <Button variant="outline" size="sm" onClick={handleScan}>
                    Rescan
                  </Button>
                </div>

                {groups.map((group, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={group.matchType === 'email' ? 'default' : 'secondary'}
                          className="text-[10px] shrink-0"
                        >
                          {group.matchType === 'email' ? (
                            <><Mail className="mr-1 h-3 w-3" /> Email</>
                          ) : (
                            <><User className="mr-1 h-3 w-3" /> Name</>
                          )}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {Math.round(group.confidence * 100)}% match
                        </span>
                      </div>
                      <div className="mt-1.5 space-y-0.5">
                        {group.contacts.map((c) => (
                          <div key={c.id} className="flex items-center gap-2 text-sm">
                            <span className="font-medium truncate">
                              {contactName(c)}
                            </span>
                            {c.email && (
                              <span className="text-xs text-muted-foreground truncate">
                                {c.email}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {c.phone_number}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-3 shrink-0"
                      onClick={() => setMergeGroup(group)}
                      disabled={group.contacts.length < 2}
                    >
                      Merge
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {mergeGroup && mergeGroup.contacts.length >= 2 && (
        <MergeContactDialog
          open={!!mergeGroup}
          onOpenChange={(open) => !open && setMergeGroup(null)}
          contactA={mergeGroup.contacts[0]}
          contactB={mergeGroup.contacts[1]}
          onMergeComplete={handleMergeComplete}
        />
      )}
    </>
  );
}
