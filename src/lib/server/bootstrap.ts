import { pool } from "@/db";

// Idempotent schema bootstrap mirroring src/db/schema.ts (same names/defaults as
// drizzle-kit push), so a fresh database works even before a push has run.
const DDL = `
CREATE TABLE IF NOT EXISTS provider_settings (
  id text PRIMARY KEY,
  api_key text,
  base_url text,
  model text,
  wire_format text,
  enabled boolean NOT NULL DEFAULT true,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY DEFAULT 1,
  active_provider_id text NOT NULL DEFAULT 'deepseek',
  platforms jsonb NOT NULL DEFAULT '["adobe","shutterstock","freepik","istock"]'::jsonb,
  default_hint text NOT NULL DEFAULT 'auto',
  concurrency integer NOT NULL DEFAULT 3,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  width integer NOT NULL DEFAULT 0,
  height integer NOT NULL DEFAULT 0,
  hint text NOT NULL DEFAULT 'auto',
  status text NOT NULL DEFAULT 'pending',
  error text,
  provider_id text,
  model text,
  result jsonb,
  raw_result jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_type text,
  vector_companion text,
  usage jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_created_idx ON assets USING btree (created_at);
CREATE TABLE IF NOT EXISTS asset_images (
  asset_id uuid PRIMARY KEY,
  mime text NOT NULL DEFAULT 'image/jpeg',
  thumb bytea NOT NULL,
  analysis bytea NOT NULL,
  CONSTRAINT asset_images_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE cascade
);
`;

const g = globalThis as typeof globalThis & { __stockmetaSchemaReady?: Promise<void> | null };

export function ensureSchema(): Promise<void> {
  if (!g.__stockmetaSchemaReady) {
    g.__stockmetaSchemaReady = pool
      .query(DDL)
      .then(() => undefined)
      .catch(async (e: unknown) => {
        // A concurrent bootstrap can race on catalog rows — retry once.
        try {
          await pool.query(DDL);
        } catch {
          g.__stockmetaSchemaReady = null;
          throw e;
        }
      });
  }
  return g.__stockmetaSchemaReady;
}
