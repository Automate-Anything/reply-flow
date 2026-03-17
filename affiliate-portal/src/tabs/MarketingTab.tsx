import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, Check, QrCode, Share2, Trash2, Plus, Megaphone, X, Download } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { getCampaigns, createCampaign, deleteCampaign } from '../api';

interface Campaign {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  total_clicks: number;
  total_signups: number;
  created_at: string;
  url: string;
  directUrl: string;
}

interface MarketingTabProps {
  affiliateLink: string;
}

function MarketingTab({ affiliateLink }: MarketingTabProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New campaign form
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  // QR modal
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  // Share dropdown
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await getCampaigns();
      setCampaigns(res.campaigns);
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to load campaigns');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const handleCopy = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setFormError('');
    try {
      await createCampaign(newName.trim(), newDesc.trim() || undefined);
      setNewName('');
      setNewDesc('');
      setShowForm(false);
      await loadCampaigns();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create campaign');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this campaign? Click data will be preserved.')) return;
    try {
      await deleteCampaign(id);
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete campaign');
    }
  };

  const getShareLinks = (url: string) => ({
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent('Check out Reply Flow for your customer communication needs!')}&url=${encodeURIComponent(url)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`Check out Reply Flow: ${url}`)}`,
  });

  const handleDownloadQR = () => {
    if (!qrRef.current) return;
    const svg = qrRef.current.querySelector('svg');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 300, 300);
      ctx.drawImage(img, 0, 0, 300, 300);
      const a = document.createElement('a');
      a.download = 'affiliate-qr-code.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  if (loading) {
    return (
      <div className="space-y-6" role="tabpanel">
        <div className="bg-[hsl(var(--card))] rounded-lg shadow p-6">
          <Skeleton className="h-5 w-36 mb-4" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="bg-[hsl(var(--card))] rounded-lg shadow p-6">
          <Skeleton className="h-5 w-36 mb-4" />
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full mb-3" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" role="tabpanel">
      {/* Default Link */}
      {affiliateLink && (
        <Card title="Your Default Link">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              readOnly
              value={affiliateLink}
              className="flex-1 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-[var(--radius)] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleCopy(affiliateLink, 'default')}>
                {copiedId === 'default' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setQrUrl(affiliateLink)}>
                <QrCode className="h-4 w-4" />
              </Button>
              <div className="relative">
                <Button size="sm" variant="outline" onClick={() => setShareUrl(shareUrl === affiliateLink ? null : affiliateLink)}>
                  <Share2 className="h-4 w-4" />
                </Button>
                {shareUrl === affiliateLink && (
                  <ShareDropdown links={getShareLinks(affiliateLink)} onClose={() => setShareUrl(null)} />
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Campaign Links */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Campaign Links</h3>
          <Button size="sm" onClick={() => setShowForm(!showForm)} disabled={campaigns.length >= 20}>
            <Plus className="h-4 w-4 mr-1" />
            New Campaign
          </Button>
        </div>

        {campaigns.length >= 20 && (
          <p className="text-xs text-[hsl(var(--warning))] mb-3">
            Maximum 20 campaigns reached. Delete unused ones to create new ones.
          </p>
        )}

        {showForm && (
          <form onSubmit={handleCreate} className="mb-4 p-4 bg-[hsl(var(--muted))] rounded-[var(--radius)] space-y-3">
            <Input
              label="Campaign Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. YouTube Review, Blog Post"
              required
            />
            <Input
              label="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Internal note about this campaign"
            />
            {formError && <p className="text-sm text-[hsl(var(--destructive))]">{formError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={creating}>
                {creating ? 'Creating...' : 'Create Campaign'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => { setShowForm(false); setFormError(''); }}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {error && <p className="text-sm text-[hsl(var(--destructive))] mb-3">{error}</p>}

        {campaigns.length === 0 && !showForm ? (
          <EmptyState
            icon={<Megaphone className="h-12 w-12" />}
            title="No campaigns yet"
            description="Create campaign links to track which channels bring the most referrals."
            action={{ label: 'Create Campaign', onClick: () => setShowForm(true) }}
          />
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <div key={c.id} className="border border-[hsl(var(--border))] rounded-[var(--radius)] p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-[hsl(var(--foreground))]">{c.name}</p>
                    {c.description && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{c.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{c.total_clicks} clicks</span>
                    <span>{c.total_signups} signups</span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    readOnly
                    value={c.directUrl}
                    className="flex-1 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-[var(--radius)] px-2 py-1.5 text-xs text-[hsl(var(--foreground))]"
                  />
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleCopy(c.directUrl, c.id)}>
                      {copiedId === c.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setQrUrl(c.directUrl)}>
                      <QrCode className="h-3 w-3" />
                    </Button>
                    <div className="relative">
                      <Button size="sm" variant="outline" onClick={() => setShareUrl(shareUrl === c.id ? null : c.id)}>
                        <Share2 className="h-3 w-3" />
                      </Button>
                      {shareUrl === c.id && (
                        <ShareDropdown links={getShareLinks(c.directUrl)} onClose={() => setShareUrl(null)} />
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}>
                      <Trash2 className="h-3 w-3 text-[hsl(var(--destructive))]" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* QR Code Modal */}
      {qrUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setQrUrl(null)}>
          <div className="bg-[hsl(var(--card))] rounded-lg shadow-lg p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">QR Code</h3>
              <button
                onClick={() => setQrUrl(null)}
                className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div ref={qrRef} className="flex justify-center mb-4">
              <QRCodeSVG value={qrUrl} size={200} level="M" />
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] text-center mb-4 break-all">
              {qrUrl}
            </p>
            <Button className="w-full" onClick={handleDownloadQR}>
              <Download className="h-4 w-4 mr-1.5" />
              Download PNG
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShareDropdown({ links, onClose }: { links: Record<string, string>; onClose: () => void }) {
  const labels: Record<string, string> = {
    twitter: 'Twitter / X',
    linkedin: 'LinkedIn',
    facebook: 'Facebook',
    whatsapp: 'WhatsApp',
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-[var(--radius)] shadow-lg py-1 min-w-[140px]">
        {Object.entries(links).map(([key, url]) => (
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-2 text-sm text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]"
            onClick={onClose}
          >
            {labels[key] || key}
          </a>
        ))}
      </div>
    </>
  );
}

export { MarketingTab };
