import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import CannedResponsesManager from '@/components/settings/CannedResponsesManager';
import LabelsManager from '@/components/settings/LabelsManager';
import StatusesManager from '@/components/settings/StatusesManager';

interface InboxToolsPanelProps {
  onClose: () => void;
}

export default function InboxToolsPanel({ onClose }: InboxToolsPanelProps) {
  const [tab, setTab] = useState<'quick-replies' | 'labels' | 'statuses'>('quick-replies');

  return (
    <div className="flex h-full w-full flex-col border-r md:w-[320px]">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-sm font-semibold">Inbox Tools</h2>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-3 mt-3 w-auto">
          <TabsTrigger value="quick-replies" className="flex-1">Quick Replies</TabsTrigger>
          <TabsTrigger value="labels" className="flex-1">Labels</TabsTrigger>
          <TabsTrigger value="statuses" className="flex-1">Statuses</TabsTrigger>
        </TabsList>

        <TabsContent value="quick-replies" className="flex-1 overflow-y-auto p-3">
          <CannedResponsesManager />
        </TabsContent>

        <TabsContent value="labels" className="flex-1 overflow-y-auto p-3">
          <LabelsManager />
        </TabsContent>

        <TabsContent value="statuses" className="flex-1 overflow-y-auto p-3">
          <StatusesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
