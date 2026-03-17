import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useSession } from '@/contexts/SessionContext';
import api from '@/lib/api';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useDebugMode } from '@/hooks/useDebugMode';
import {
  Shield,
  Users,
  Building2,
  Bot,
  BookOpen,
  FileText,
  Layers,
  ChevronDown,
  ChevronRight,
  Save,
  Eye,
  ArrowRight,
  Settings2,
  Bug,
} from 'lucide-react';
import { AffiliateListTab } from '@/components/super-admin/affiliates/AffiliateListTab';
import { ScheduleListTab } from '@/components/super-admin/commission-schedules/ScheduleListTab';
import { PayoutListTab } from '@/components/super-admin/affiliate-payouts/PayoutListTab';
import { AgreementListTab } from '@/components/super-admin/affiliate-agreements/AgreementListTab';

const TABS = ['overview', 'templates', 'preview', 'knowledge-bases', 'retrieval', 'debug', 'affiliates', 'commissions', 'payouts', 'agreements'] as const;
type Tab = (typeof TABS)[number];

// ── Types ──────────────────────────────────────────

interface Stats {
  users: number;
  companies: number;
  agents: number;
  knowledge_bases: number;
  entries: number;
  chunks: number;
  embedding_status: { status: string; count: number }[];
}

interface Company {
  id: string;
  name: string;
  slug: string | null;
  created_at: string;
  member_count: number;
  agent_count: number;
}

interface PromptTemplate {
  id: string;
  key: string;
  category: string;
  label: string;
  content: string;
  updated_at: string;
}

interface Agent {
  id: string;
  name: string;
  created_at: string;
  profile_data?: any;
  company_id?: string;
}

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  company_id: string;
  company_name: string;
  entry_count: number;
  chunk_count: number;
  created_at: string;
}

interface KBEntryRow {
  id: string;
  title: string;
  source_type: string;
  file_name: string | null;
  embedding_status: string;
  chunk_count: number;
  content_length: number;
  created_at: string;
}

interface PipelineData {
  entry: {
    id: string;
    title: string;
    source_type: string;
    file_name: string | null;
    content_length: number;
    embedding_status: string;
    created_at: string;
  };
  chunks: {
    id: string;
    chunk_index: number;
    content_preview: string;
    content_length: number;
    has_embedding: boolean;
    metadata: Record<string, any>;
    full_content?: string;
  }[];
  stats: {
    total_chunks: number;
    avg_chunk_size: number;
    min_chunk_size: number;
    max_chunk_size: number;
    chunks_with_embeddings: number;
    chunks_without_embeddings: number;
  };
}

interface KBAnalytics {
  total_chunks: number;
  chunks_with_embeddings: number;
  chunks_without_embeddings: number;
  embedding_completion_pct: number;
  avg_chunk_size: number;
  min_chunk_size: number;
  max_chunk_size: number;
  total_characters: number;
  embedded_characters: number;
  chunk_size_distribution: Record<string, number>;
  entry_status_breakdown: { status: string; count: number }[];
}

// ── Main Page ──────────────────────────────────────

export default function SuperAdminPage() {
  const { isSuperAdmin } = useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'overview';

  useEffect(() => {
    if (!isSuperAdmin) navigate('/');
  }, [isSuperAdmin, navigate]);

  if (!isSuperAdmin) return null;

  const handleTabChange = (value: string) => {
    setSearchParams(value === 'overview' ? {} : { tab: value }, { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Super Admin</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            System-wide management and diagnostics.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full">
          <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
          <TabsTrigger value="templates" className="flex-1">Prompt Building Blocks</TabsTrigger>
          <TabsTrigger value="preview" className="flex-1">Prompt Preview</TabsTrigger>
          <TabsTrigger value="knowledge-bases" className="flex-1">Knowledge Bases</TabsTrigger>
          <TabsTrigger value="retrieval" className="flex-1">Retrieval Settings</TabsTrigger>
          <TabsTrigger value="debug" className="flex-1">Debug</TabsTrigger>
          <TabsTrigger value="affiliates" className="flex-1">Affiliates</TabsTrigger>
          <TabsTrigger value="commissions" className="flex-1">Commissions</TabsTrigger>
          <TabsTrigger value="payouts" className="flex-1">Payouts</TabsTrigger>
          <TabsTrigger value="agreements" className="flex-1">Agreements</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-6">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="preview" className="mt-6">
          <PromptPreviewTab />
        </TabsContent>
        <TabsContent value="knowledge-bases" className="mt-6">
          <KnowledgeBasesTab />
        </TabsContent>
        <TabsContent value="retrieval" className="mt-6">
          <RetrievalSettingsTab />
        </TabsContent>
        <TabsContent value="debug" className="mt-6">
          <DebugModeTab />
        </TabsContent>
        <TabsContent value="affiliates" className="mt-6">
          <AffiliateListTab />
        </TabsContent>
        <TabsContent value="commissions" className="mt-6">
          <ScheduleListTab />
        </TabsContent>
        <TabsContent value="payouts" className="mt-6">
          <PayoutListTab />
        </TabsContent>
        <TabsContent value="agreements" className="mt-6">
          <AgreementListTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────

function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Stats>('/super-admin/stats')
      .then(({ data }) => setStats(data))
      .catch(() => toast.error('Failed to load stats'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  if (!stats) return <p className="text-muted-foreground">Failed to load stats.</p>;

  const statCards = [
    { label: 'Users', value: stats.users, icon: Users },
    { label: 'Companies', value: stats.companies, icon: Building2 },
    { label: 'AI Agents', value: stats.agents, icon: Bot },
    { label: 'Knowledge Bases', value: stats.knowledge_bases, icon: BookOpen },
    { label: 'KB Entries', value: stats.entries, icon: FileText },
    { label: 'Chunks', value: stats.chunks, icon: Layers },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{value.toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.embedding_status.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Embedding Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {stats.embedding_status.map(({ status, count }) => (
                <div key={status} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                  <EmbeddingStatusBadge status={status} />
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Templates Tab ──────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<Record<string, PromptTemplate[]>>({});
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ templates: Record<string, PromptTemplate[]> }>('/super-admin/prompt-templates')
      .then(({ data }) => {
        setTemplates(data.templates);
        const values: Record<string, string> = {};
        for (const group of Object.values(data.templates)) {
          for (const t of group) values[t.key] = t.content;
        }
        setEditValues(values);
      })
      .catch(() => toast.error('Failed to load templates'))
      .finally(() => setLoading(false));
  }, []);

  const saveTemplate = async (key: string) => {
    setSaving(key);
    try {
      await api.put(`/super-admin/prompt-templates/${key}`, { content: editValues[key] });
      toast.success('Template saved');
    } catch {
      toast.error('Failed to save template');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Skeleton className="h-64" />;

  const categoryLabels: Record<string, string> = {
    identity: 'Identity Intros',
    tone: 'Tone Descriptions',
    length: 'Response Length Descriptions',
    emoji: 'Emoji Usage Descriptions',
    language: 'Language Instructions',
    kb_context: 'Knowledge Base Context',
    scenario: 'Scenario Instructions',
    classifier: 'Message Classifier',
    core_rules: 'Core Rules',
  };

  const categoryDescriptions: Record<string, string> = {
    identity: 'Opening intro sentences for each use case. Use {name} as placeholder for the business/org name.',
    language: 'Language instructions. Use {language} as placeholder for the specific language name.',
    kb_context: 'Introduction text shown before knowledge base context is injected into the prompt.',
    scenario: 'Headers and fallback messages for the scenario system. Use {human_phone} as placeholder in phone fallback.',
    classifier: 'Full prompt sent to the classifier model. Use {business_context} and {scenario_list} as placeholders.',
  };

  // Categories that need larger textareas
  const largeCategories = new Set(['core_rules', 'classifier', 'scenario']);

  const categoryOrder = ['identity', 'tone', 'length', 'emoji', 'language', 'kb_context', 'scenario', 'classifier', 'core_rules'];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        These building blocks control how AI prompts are assembled. Changes take effect within 60 seconds.
      </p>
      {categoryOrder.map((category) => {
        const group = templates[category];
        if (!group) return null;
        return (
          <Card key={category}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{categoryLabels[category] || category}</CardTitle>
              {categoryDescriptions[category] && (
                <p className="text-xs text-muted-foreground mt-1">{categoryDescriptions[category]}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {group.map((t) => (
                <div key={t.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">{t.label}</label>
                    <Badge variant="outline" className="text-xs">{t.key}</Badge>
                  </div>
                  <textarea
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={largeCategories.has(category) ? 8 : 3}
                    value={editValues[t.key] || ''}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, [t.key]: e.target.value }))}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => saveTemplate(t.key)}
                      disabled={saving === t.key || editValues[t.key] === t.content}
                    >
                      <Save className="mr-1 h-3 w-3" />
                      {saving === t.key ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Prompt Preview Tab ─────────────────────────────

function PromptPreviewTab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [profileJson, setProfileJson] = useState<string>('{}');
  const [preview, setPreview] = useState<string>('');
  const [charCount, setCharCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);

  useEffect(() => {
    api.get<{ companies: Company[] }>('/super-admin/companies?limit=100')
      .then(({ data }) => setCompanies(data.companies))
      .catch(() => toast.error('Failed to load companies'));
  }, []);

  const onCompanyChange = useCallback(async (companyId: string) => {
    setSelectedCompany(companyId);
    setSelectedAgent('');
    setAgents([]);
    if (!companyId) return;
    setLoadingAgents(true);
    try {
      const { data } = await api.get<{ agents: Agent[] }>(`/super-admin/companies/${companyId}/agents`);
      setAgents(data.agents);
    } catch {
      toast.error('Failed to load agents');
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  const loadAgent = useCallback(async () => {
    if (!selectedAgent) return;
    try {
      const { data } = await api.get<{ agent: Agent }>(`/super-admin/agents/${selectedAgent}`);
      setProfileJson(JSON.stringify(data.agent.profile_data || {}, null, 2));
    } catch {
      toast.error('Failed to load agent');
    }
  }, [selectedAgent]);

  const generatePreview = useCallback(async () => {
    setLoading(true);
    try {
      const profileData = JSON.parse(profileJson);
      const { data } = await api.post<{ prompt: string; character_count: number }>('/super-admin/prompt-preview', { profileData });
      setPreview(data.prompt);
      setCharCount(data.character_count);
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        toast.error('Invalid JSON in profile data');
      } else {
        toast.error('Failed to generate preview');
      }
    } finally {
      setLoading(false);
    }
  }, [profileJson]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left: Controls */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Agent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Company</label>
              <Select value={selectedCompany} onValueChange={onCompanyChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a company..." />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Agent</label>
              <Select value={selectedAgent} onValueChange={setSelectedAgent} disabled={!selectedCompany || loadingAgents}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingAgents ? 'Loading...' : 'Select an agent...'} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={loadAgent} disabled={!selectedAgent} variant="outline" size="sm">
              Load Agent Settings
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Profile Data (JSON)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              rows={16}
              value={profileJson}
              onChange={(e) => setProfileJson(e.target.value)}
            />
            <Button onClick={generatePreview} disabled={loading}>
              <Eye className="mr-1 h-4 w-4" />
              {loading ? 'Generating...' : 'Generate Preview'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Right: Output */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Built System Prompt</CardTitle>
            {charCount > 0 && (
              <Badge variant="outline">{charCount.toLocaleString()} chars</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1">
          {preview ? (
            <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-4 text-xs">
              {preview}
            </pre>
          ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
              Select an agent and click "Generate Preview" to see the built prompt.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Knowledge Bases Tab ────────────────────────────

function KnowledgeBasesTab() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [kbs, setKBs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [expandedKB, setExpandedKB] = useState<string | null>(null);
  const [kbEntries, setKBEntries] = useState<Record<string, KBEntryRow[]>>({});
  const [loadingEntries, setLoadingEntries] = useState<string | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [pipelineData, setPipelineData] = useState<Record<string, PipelineData>>({});
  const [loadingPipeline, setLoadingPipeline] = useState<string | null>(null);

  // Analytics
  const [kbAnalytics, setKBAnalytics] = useState<Record<string, KBAnalytics>>({});
  const [loadingAnalytics, setLoadingAnalytics] = useState<string | null>(null);

  // Full entry content
  const [entryContents, setEntryContents] = useState<Record<string, string>>({});
  const [loadingContent, setLoadingContent] = useState<string | null>(null);
  const [showContent, setShowContent] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ companies: Company[] }>('/super-admin/companies?limit=100'),
      api.get<{ knowledge_bases: KnowledgeBase[] }>('/super-admin/knowledge-bases'),
    ]).then(([companiesRes, kbsRes]) => {
      setCompanies(companiesRes.data.companies);
      setKBs(kbsRes.data.knowledge_bases);
    }).catch(() => toast.error('Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  const filteredKBs = companyFilter === 'all'
    ? kbs
    : kbs.filter((kb) => kb.company_id === companyFilter);

  const toggleKB = async (kbId: string) => {
    if (expandedKB === kbId) {
      setExpandedKB(null);
      return;
    }
    setExpandedKB(kbId);
    setExpandedEntry(null);
    setShowContent(null);

    // Fetch entries + analytics in parallel (skip if already cached)
    const promises: Promise<void>[] = [];

    if (!kbEntries[kbId]) {
      setLoadingEntries(kbId);
      promises.push(
        api.get<{ entries: KBEntryRow[] }>(`/super-admin/knowledge-bases/${kbId}/entries`)
          .then(({ data }) => setKBEntries((prev) => ({ ...prev, [kbId]: data.entries })))
          .catch(() => { toast.error('Failed to load entries'); })
          .finally(() => setLoadingEntries(null))
      );
    }

    if (!kbAnalytics[kbId]) {
      setLoadingAnalytics(kbId);
      promises.push(
        api.get<KBAnalytics>(`/super-admin/knowledge-bases/${kbId}/analytics`)
          .then(({ data }) => setKBAnalytics((prev) => ({ ...prev, [kbId]: data })))
          .catch(() => { toast.error('Failed to load analytics'); })
          .finally(() => setLoadingAnalytics(null))
      );
    }

    await Promise.all(promises);
  };

  const togglePipeline = async (entryId: string) => {
    if (expandedEntry === entryId) {
      setExpandedEntry(null);
      return;
    }
    setExpandedEntry(entryId);
    setShowContent(null);
    if (pipelineData[entryId]) return;
    setLoadingPipeline(entryId);
    try {
      const { data } = await api.get<PipelineData>(`/super-admin/entries/${entryId}/pipeline`);
      setPipelineData((prev) => ({ ...prev, [entryId]: data }));
    } catch {
      toast.error('Failed to load pipeline data');
    } finally {
      setLoadingPipeline(null);
    }
  };

  const loadEntryContent = async (entryId: string) => {
    if (entryContents[entryId]) {
      setShowContent(showContent === entryId ? null : entryId);
      return;
    }
    setLoadingContent(entryId);
    try {
      const { data } = await api.get<{ id: string; content: string }>(`/super-admin/entries/${entryId}/content`);
      setEntryContents((prev) => ({ ...prev, [entryId]: data.content }));
      setShowContent(entryId);
    } catch {
      toast.error('Failed to load entry content');
    } finally {
      setLoadingContent(null);
    }
  };

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Filter by company:</label>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-[250px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredKBs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No knowledge bases found.</p>
      ) : (
        <div className="space-y-2">
          {filteredKBs.map((kb) => (
            <Card key={kb.id}>
              <button
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/50"
                onClick={() => toggleKB(kb.id)}
              >
                {expandedKB === kb.id ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{kb.name}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{kb.company_name}</Badge>
                  </div>
                  {kb.description && <p className="mt-0.5 text-xs text-muted-foreground truncate">{kb.description}</p>}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                  <span>{kb.entry_count} entries</span>
                  <span>{kb.chunk_count} chunks</span>
                </div>
              </button>

              {expandedKB === kb.id && (
                <div className="border-t px-4 pb-4">
                  {/* Analytics Panel */}
                  {loadingAnalytics === kb.id ? (
                    <Skeleton className="mt-3 h-32" />
                  ) : kbAnalytics[kb.id] ? (
                    <KBAnalyticsPanel analytics={kbAnalytics[kb.id]} />
                  ) : null}

                  {/* Entries List */}
                  {loadingEntries === kb.id ? (
                    <Skeleton className="mt-3 h-20" />
                  ) : (kbEntries[kb.id] || []).length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No entries in this knowledge base.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {(kbEntries[kb.id] || []).map((entry) => (
                        <div key={entry.id} className="rounded-lg border">
                          <button
                            className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/30"
                            onClick={() => togglePipeline(entry.id)}
                          >
                            {expandedEntry === entry.id ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium truncate block">{entry.title}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <Badge variant="secondary" className="text-xs">{entry.source_type}</Badge>
                                {entry.file_name && <span className="text-xs text-muted-foreground">{entry.file_name}</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                              <span>{entry.chunk_count} chunks</span>
                              <span>{entry.content_length.toLocaleString()} chars</span>
                              <EmbeddingStatusBadge status={entry.embedding_status} />
                            </div>
                          </button>

                          {expandedEntry === entry.id && (
                            <div className="border-t px-3 pb-3">
                              {/* Full Content Viewer */}
                              <div className="mt-3 mb-3">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => loadEntryContent(entry.id)}
                                  disabled={loadingContent === entry.id}
                                >
                                  <Eye className="mr-1 h-3 w-3" />
                                  {loadingContent === entry.id ? 'Loading...' :
                                   showContent === entry.id ? 'Hide Full Content' : 'View Full Content'}
                                </Button>
                                {showContent === entry.id && entryContents[entry.id] && (
                                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/50 p-3 text-xs">
                                    {entryContents[entry.id]}
                                  </pre>
                                )}
                              </div>

                              {/* Pipeline View */}
                              {loadingPipeline === entry.id ? (
                                <Skeleton className="mt-3 h-32" />
                              ) : pipelineData[entry.id] ? (
                                <PipelineView data={pipelineData[entry.id]} entryId={entry.id} />
                              ) : null}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pipeline View ──────────────────────────────────

function PipelineView({ data, entryId }: { data: PipelineData; entryId: string }) {
  const [showChunks, setShowChunks] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());
  const [fullContentData, setFullContentData] = useState<PipelineData | null>(null);
  const [loadingFullContent, setLoadingFullContent] = useState(false);
  const { entry, chunks, stats } = data;
  const embeddingPct = stats.total_chunks > 0
    ? Math.round((stats.chunks_with_embeddings / stats.total_chunks) * 100)
    : 0;

  const steps = [
    {
      label: 'Upload',
      detail: `${entry.source_type === 'file' ? entry.file_name || 'file' : 'text'} (${entry.source_type})`,
    },
    {
      label: 'Text Extraction',
      detail: `${entry.content_length.toLocaleString()} characters`,
    },
    {
      label: 'Chunking',
      detail: `${stats.total_chunks} chunks (avg ${stats.avg_chunk_size}, min ${stats.min_chunk_size}, max ${stats.max_chunk_size})`,
    },
    {
      label: 'Embedding',
      detail: `${stats.chunks_with_embeddings}/${stats.total_chunks} completed (${embeddingPct}%)`,
    },
  ];

  return (
    <div className="mt-3 space-y-4">
      {/* Pipeline Steps */}
      <div className="flex items-center gap-2 overflow-x-auto">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2">
            <div className="rounded-lg border bg-background px-3 py-2 min-w-0">
              <p className="text-xs font-semibold">{step.label}</p>
              <p className="text-xs text-muted-foreground whitespace-nowrap">{step.detail}</p>
            </div>
            {i < steps.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Chunks */}
      {chunks.length > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const next = !showChunks;
              setShowChunks(next);
              // Fetch full content on first open
              if (next && !fullContentData && !loadingFullContent) {
                setLoadingFullContent(true);
                try {
                  const { data: fullData } = await api.get<PipelineData>(
                    `/super-admin/entries/${entryId}/pipeline?include_content=true`
                  );
                  setFullContentData(fullData);
                } catch {
                  // Silently fail — preview still works
                } finally {
                  setLoadingFullContent(false);
                }
              }
            }}
            className="mb-2"
          >
            {showChunks ? <ChevronDown className="mr-1 h-3 w-3" /> : <ChevronRight className="mr-1 h-3 w-3" />}
            {showChunks ? 'Hide' : 'Show'} Chunks ({chunks.length})
          </Button>

          {showChunks && (
            <div className="max-h-[500px] overflow-y-auto space-y-2">
              {chunks.map((chunk) => {
                const isExpanded = expandedChunks.has(chunk.id);
                const fullChunk = fullContentData?.chunks.find((c) => c.id === chunk.id);
                return (
                  <div key={chunk.id} className="rounded border bg-muted/30 p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs">#{chunk.chunk_index}</Badge>
                      <span className="text-xs text-muted-foreground">{chunk.content_length} chars</span>
                      {chunk.has_embedding ? (
                        <Badge className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">embedded</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">no embedding</Badge>
                      )}
                      {chunk.metadata?.sectionHeading && (
                        <span className="text-xs text-muted-foreground italic truncate">{chunk.metadata.sectionHeading}</span>
                      )}
                      <button
                        className="ml-auto text-xs text-primary hover:underline shrink-0"
                        onClick={() => {
                          setExpandedChunks((prev) => {
                            const next = new Set(prev);
                            if (next.has(chunk.id)) next.delete(chunk.id);
                            else next.add(chunk.id);
                            return next;
                          });
                        }}
                      >
                        {isExpanded ? 'Collapse' : 'Expand'}
                      </button>
                    </div>
                    {isExpanded ? (
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground max-h-64 overflow-auto rounded border bg-background p-2">
                        {loadingFullContent ? 'Loading...' : (fullChunk?.full_content || chunk.content_preview)}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground line-clamp-3">{chunk.content_preview}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── KB Analytics Panel ─────────────────────────────

function KBAnalyticsPanel({ analytics }: { analytics: KBAnalytics }) {
  const {
    total_chunks, chunks_with_embeddings,
    embedding_completion_pct, avg_chunk_size, min_chunk_size, max_chunk_size,
    total_characters, embedded_characters, chunk_size_distribution,
    entry_status_breakdown,
  } = analytics;

  const maxBucket = Math.max(...Object.values(chunk_size_distribution), 1);

  return (
    <div className="mt-3 space-y-4 rounded-lg border bg-muted/20 p-4">
      {/* Embedding Completion Progress Bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium">Embedding Completion</span>
          <span className="text-xs text-muted-foreground">
            {chunks_with_embeddings}/{total_chunks} chunks ({embedding_completion_pct}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${embedding_completion_pct}%` }}
          />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border bg-background p-2">
          <p className="text-[11px] text-muted-foreground">Avg Chunk Size</p>
          <p className="text-sm font-semibold">{avg_chunk_size.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-background p-2">
          <p className="text-[11px] text-muted-foreground">Min / Max</p>
          <p className="text-sm font-semibold">{min_chunk_size.toLocaleString()} / {max_chunk_size.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-background p-2">
          <p className="text-[11px] text-muted-foreground">Total Characters</p>
          <p className="text-sm font-semibold">{total_characters.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-background p-2">
          <p className="text-[11px] text-muted-foreground">Embedded Characters</p>
          <p className="text-sm font-semibold">{embedded_characters.toLocaleString()}</p>
        </div>
      </div>

      {/* Chunk Size Distribution */}
      {total_chunks > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Chunk Size Distribution</p>
          <div className="space-y-1">
            {Object.entries(chunk_size_distribution).map(([bucket, count]) => (
              <div key={bucket} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20 shrink-0 text-right">{bucket}</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className="h-full bg-primary/60 rounded transition-all"
                    style={{ width: `${(count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className="text-xs font-medium w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entry Status Breakdown */}
      {entry_status_breakdown.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Entry Status Breakdown</p>
          <div className="flex flex-wrap gap-2">
            {entry_status_breakdown.map(({ status, count }) => (
              <div key={status} className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1.5">
                <EmbeddingStatusBadge status={status} />
                <span className="text-sm font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared Components ──────────────────────────────

function EmbeddingStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variants[status] || variants.pending}`}>
      {status}
    </span>
  );
}

// ── Debug Mode Tab ────────────────────────────────

function DebugModeTab() {
  const { debugMode, toggleDebugMode, loading } = useDebugMode();
  const [toggling, setToggling] = useState(false);

  const handleToggle = async (checked: boolean) => {
    setToggling(true);
    try {
      await toggleDebugMode(checked);
      toast.success(checked ? 'Debug mode enabled' : 'Debug mode disabled');
    } catch {
      toast.error('Failed to toggle debug mode');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bug className="h-4 w-4" />
            Debug Mode
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            When enabled, AI responses include detailed debug information (tokens, timing, KB search scores, prompt sections) and KB uploads show a live pipeline visualizer.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Debug Mode</p>
              <p className="text-xs text-muted-foreground">
                System-wide setting. Affects all super admin sessions.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={debugMode ? 'default' : 'outline'} className="text-xs">
                {debugMode ? 'ON' : 'OFF'}
              </Badge>
              <Switch
                checked={debugMode}
                onCheckedChange={handleToggle}
                disabled={loading || toggling}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What Debug Mode Does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
            <p><strong className="text-foreground">AI Debug Panels</strong> — Each AI reply shows an expandable panel with token counts, response time, query classification, KB search scores, matched scenario, and the full assembled prompt.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
            <p><strong className="text-foreground">KB Pipeline Visualizer</strong> — File uploads show a live step-by-step view of classification, extraction, cleaning, chunking, embedding, and storing.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
            <p><strong className="text-foreground">Visual Debug Overlay</strong> — Hover over UI elements to see component boundaries and dimensions.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Retrieval Settings Tab ────────────────────────

interface RetrievalSetting {
  key: string;
  value: string;
  label: string;
  description: string | null;
  updated_at: string;
}

const SETTING_GROUPS: Record<string, { title: string; description: string; keys: string[] }> = {
  search: {
    title: 'Search Settings',
    description: 'Control how many results are returned and the minimum quality thresholds.',
    keys: ['match_count', 'similarity_threshold', 'fts_threshold', 'rrf_threshold'],
  },
  chunking: {
    title: 'Chunking Settings',
    description: 'Control how documents are split into chunks during upload. Changes only affect newly uploaded documents.',
    keys: ['max_chunk_size', 'chunk_target_size', 'chunk_overlap', 'min_chunk_size'],
  },
};

function RetrievalSettingsTab() {
  const [settings, setSettings] = useState<RetrievalSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ settings: RetrievalSetting[] }>('/super-admin/retrieval-settings')
      .then(({ data }) => {
        setSettings(data.settings);
        const values: Record<string, string> = {};
        for (const s of data.settings) values[s.key] = s.value;
        setEditValues(values);
      })
      .catch(() => toast.error('Failed to load retrieval settings'))
      .finally(() => setLoading(false));
  }, []);

  const saveSetting = async (key: string) => {
    const value = editValues[key];
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) {
      toast.error('Value must be a non-negative number');
      return;
    }

    setSaving(key);
    try {
      await api.put(`/super-admin/retrieval-settings/${key}`, { value });
      setSettings((prev) => prev.map((s) => s.key === key ? { ...s, value } : s));
      toast.success('Setting saved');
    } catch {
      toast.error('Failed to save setting');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Skeleton className="h-64" />;

  const settingsByKey = Object.fromEntries(settings.map((s) => [s.key, s]));

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure how the knowledge base search and chunking pipeline works. Changes to search settings take effect within 60 seconds.
      </p>

      {Object.entries(SETTING_GROUPS).map(([groupKey, group]) => (
        <Card key={groupKey}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4" />
              {group.title}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{group.description}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {group.keys.map((key) => {
              const setting = settingsByKey[key];
              if (!setting) return null;
              const isChanged = editValues[key] !== setting.value;

              return (
                <div key={key} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-medium">{setting.label}</label>
                      <Badge variant="outline" className="text-xs shrink-0">{key}</Badge>
                    </div>
                    {setting.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    className="w-28 text-right"
                    value={editValues[key] || ''}
                    onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && isChanged && saveSetting(key)}
                  />
                  <Button
                    size="sm"
                    onClick={() => saveSetting(key)}
                    disabled={saving === key || !isChanged}
                    className="shrink-0"
                  >
                    <Save className="mr-1 h-3 w-3" />
                    {saving === key ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
