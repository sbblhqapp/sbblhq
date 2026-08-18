-- Migration: Add logo_url to teams table
-- Reason: Fixes PostgreSQL 42703 error "column teams_1.logo_url does not exist" when querying teams.

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS logo_url text;
