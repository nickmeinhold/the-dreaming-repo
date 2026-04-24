-- Manual migration: Full-text search support via tsvector
-- Run this AFTER Prisma migrations on a fresh database.
--
-- This column is not managed by Prisma because Prisma does not support
-- the tsvector type natively. It is used by raw SQL in lib/search.ts.

-- 1. Add the tsvector column
ALTER TABLE "Paper" ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create a GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS paper_search_vector_idx ON "Paper" USING GIN (search_vector);

-- 3. Create a trigger to keep search_vector in sync with title + abstract
CREATE OR REPLACE FUNCTION paper_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.abstract, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS paper_search_vector_trigger ON "Paper";
CREATE TRIGGER paper_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, abstract ON "Paper"
  FOR EACH ROW
  EXECUTE FUNCTION paper_search_vector_update();

-- 4. Backfill existing rows
UPDATE "Paper" SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(abstract, '')), 'B');
