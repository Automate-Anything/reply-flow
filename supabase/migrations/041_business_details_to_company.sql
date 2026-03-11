-- ============================================================
-- MIGRATION 041: MOVE BUSINESS DETAILS TO COMPANY TABLE
-- business_name already maps to companies.name
-- Adding business_type and business_description columns
-- ============================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS business_description TEXT;
