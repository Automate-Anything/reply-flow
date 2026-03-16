-- Add brand_color column to companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS brand_color text;

-- Add CHECK constraint for hex format
ALTER TABLE public.companies
  ADD CONSTRAINT companies_brand_color_hex_check
  CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$');

-- Create company-logos storage bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Defense-in-depth RLS policy on storage (uploads go through supabaseAdmin which bypasses RLS,
-- but this protects against accidental direct client access)
CREATE POLICY "company_logos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'company-logos');

CREATE POLICY "company_logos_authenticated_write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'company-logos'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "company_logos_authenticated_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'company-logos'
    AND auth.role() = 'authenticated'
  );
