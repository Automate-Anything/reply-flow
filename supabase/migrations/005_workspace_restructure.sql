-- ============================================================
-- MIGRATION 005: WORKSPACE RESTRUCTURING
-- Makes workspaces fully separate entities:
-- - Channels must belong to a workspace (NOT NULL)
-- - KB entries become company-level (drop workspace_id)
-- ============================================================

-- ============================================================
-- STEP 1: Ensure all channels belong to a workspace
-- ============================================================

-- Auto-create "Default Workspace" for companies with orphan channels
INSERT INTO public.workspaces (company_id, name, description)
SELECT DISTINCT wc.company_id, 'Default Workspace', 'Auto-created for existing channels'
FROM public.whatsapp_channels wc
WHERE wc.workspace_id IS NULL
AND NOT EXISTS (
  SELECT 1 FROM public.workspaces w
  WHERE w.company_id = wc.company_id AND w.name = 'Default Workspace'
);

-- Assign orphan channels to their company's default workspace
UPDATE public.whatsapp_channels wc
SET workspace_id = (
  SELECT w.id FROM public.workspaces w
  WHERE w.company_id = wc.company_id AND w.name = 'Default Workspace'
  LIMIT 1
)
WHERE wc.workspace_id IS NULL;

-- Make workspace_id NOT NULL
ALTER TABLE public.whatsapp_channels
  ALTER COLUMN workspace_id SET NOT NULL;

-- Change FK from ON DELETE SET NULL to ON DELETE RESTRICT
ALTER TABLE public.whatsapp_channels
  DROP CONSTRAINT whatsapp_channels_workspace_id_fkey,
  ADD CONSTRAINT whatsapp_channels_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

-- ============================================================
-- STEP 2: Make KB entries company-level (drop workspace/channel columns)
-- ============================================================

ALTER TABLE public.knowledge_base_entries DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE public.knowledge_base_entries DROP COLUMN IF EXISTS channel_id;
DROP INDEX IF EXISTS idx_kb_entries_workspace;
