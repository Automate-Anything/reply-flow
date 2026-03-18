-- Add rule_group_id for linking multi-scope alert rules
ALTER TABLE group_criteria ADD COLUMN rule_group_id UUID DEFAULT NULL;
