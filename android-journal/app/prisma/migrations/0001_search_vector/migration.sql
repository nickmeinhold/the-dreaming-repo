-- Full-text search vector on Paper table
-- Applied manually (not via prisma migrate) since tsvector is unsupported by Prisma

ALTER TABLE "Paper" ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS paper_search_idx ON "Paper" USING GIN(search_vector);

-- Trigger function: updates search_vector on insert/update
-- Title gets weight A (highest), abstract gets weight B
CREATE OR REPLACE FUNCTION paper_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.abstract, '')), 'B');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Attach trigger
DROP TRIGGER IF EXISTS paper_search_update ON "Paper";
CREATE TRIGGER paper_search_update
  BEFORE INSERT OR UPDATE OF title, abstract ON "Paper"
  FOR EACH ROW EXECUTE FUNCTION paper_search_trigger();

-- Backfill existing papers
UPDATE "Paper" SET search_vector =
  setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(abstract, '')), 'B');
