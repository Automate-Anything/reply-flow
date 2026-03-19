import { Mail, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import api from '@/lib/api';

interface GmailConnectionProps {
  onCreated: () => void;
}

export default function GmailConnection(_props: GmailConnectionProps) {
  const [channelName, setChannelName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const { data } = await api.post('/channels/gmail/connect', {
        channelName: channelName || 'Gmail',
      });
      window.location.href = data.authUrl;
    } catch (err) {
      console.error('Failed to start Gmail connection:', err);
      setLoading(false);
    }
  };

  return (
    <div className="border rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
          <Mail className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-medium">Connect Gmail</h3>
          <p className="text-sm text-muted-foreground">Sign in with Google to connect your inbox</p>
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Channel Name (optional)</label>
        <Input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="e.g., Support Inbox" />
      </div>
      <Button onClick={handleConnect} disabled={loading} className="w-full">
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
        Sign in with Google
      </Button>
    </div>
  );
}
