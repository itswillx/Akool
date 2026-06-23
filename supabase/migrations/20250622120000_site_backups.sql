-- Site backup metadata and settings

CREATE TABLE IF NOT EXISTS site_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('manual', 'automatic')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  storage_path text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  tables_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text
);

CREATE INDEX IF NOT EXISTS site_backups_created_at_idx ON site_backups (created_at DESC);

CREATE TABLE IF NOT EXISTS site_backup_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_enabled boolean NOT NULL DEFAULT false,
  interval_days int NOT NULL DEFAULT 7,
  last_auto_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_backup_settings (id, auto_enabled, interval_days)
VALUES (1, false, 7)
ON CONFLICT (id) DO NOTHING;

-- Storage bucket for backup archives
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('site-backups', 'site-backups', false, 524288000)
ON CONFLICT (id) DO NOTHING;

-- RLS: admins can read backup metadata
ALTER TABLE site_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_backup_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read site_backups"
  ON site_backups FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can read site_backup_settings"
  ON site_backup_settings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Weekly auto-backup check function (called by pg_cron or manually)
CREATE OR REPLACE FUNCTION public.check_auto_site_backup_due()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settings_row site_backup_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings_row FROM site_backup_settings WHERE id = 1;
  IF NOT FOUND OR NOT settings_row.auto_enabled THEN
    RETURN false;
  END IF;
  IF settings_row.last_auto_at IS NULL THEN
    RETURN true;
  END IF;
  RETURN settings_row.last_auto_at + (settings_row.interval_days || ' days')::interval <= now();
END;
$$;

-- pg_cron weekly job (requires pg_cron + pg_net extensions enabled in Supabase dashboard)
-- Configure BACKUP_CRON_SECRET in Edge Function env and call:
-- POST /functions/v1/site-backup with header x-cron-secret and body {"action":"run_auto_backup"}
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'weekly-site-backup';

    PERFORM cron.schedule(
      'weekly-site-backup',
      '0 3 * * 0',
      $job$
      SELECT CASE WHEN public.check_auto_site_backup_due() THEN
        net.http_post(
          url := current_setting('app.settings.supabase_url', true) || '/functions/v1/site-backup',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-cron-secret', current_setting('app.settings.backup_cron_secret', true)
          ),
          body := '{"action":"run_auto_backup"}'::jsonb
        )
      END;
      $job$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$cron$;
