-- Migration 038: Add last_visited_step to merchants table
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS last_visited_step VARCHAR(100) NULL AFTER onboarding_step;
