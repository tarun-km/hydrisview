-- realtime_events is only read/written in system context (publisher flush, SSE polling, pruning).
GRANT SELECT, INSERT, DELETE ON realtime_events TO hydris_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE realtime_events_id_seq TO hydris_app;
--> statement-breakpoint
ALTER TABLE realtime_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE realtime_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_only ON realtime_events USING (current_setting('app.bypass', true) = 'on') WITH CHECK (current_setting('app.bypass', true) = 'on');
--> statement-breakpoint
-- Re-check SET ROLE capability (0004 tested plain membership). On PG16+ (Neon, Supabase, RDS)
-- a non-superuser owner that created hydris_app holds an ADMIN-only membership with SET FALSE,
-- which counts as "MEMBER" but cannot `SET ROLE hydris_app`. Grant SET explicitly when missing.
DO $$
DECLARE can_set boolean;
BEGIN
  BEGIN
    can_set := pg_has_role(current_user, 'hydris_app', 'SET');
  EXCEPTION WHEN invalid_parameter_value THEN
    can_set := pg_has_role(current_user, 'hydris_app', 'MEMBER'); -- PG < 16: membership implies SET
  END;
  IF NOT can_set THEN
    EXECUTE format('GRANT hydris_app TO %I WITH SET TRUE', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not grant SET on hydris_app to %; run GRANT hydris_app TO % WITH SET TRUE as an admin', current_user, current_user;
END $$;
