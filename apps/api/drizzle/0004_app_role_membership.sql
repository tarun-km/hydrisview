-- Allow the connecting (migration/owner) user to SET ROLE hydris_app on managed Postgres.
-- PG16+ grants CREATEROLE creators admin-only membership (SET FALSE), so grant SET explicitly.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'hydris_app', 'MEMBER') THEN
    BEGIN
      EXECUTE format('GRANT hydris_app TO %I WITH SET TRUE', current_user);
    EXCEPTION WHEN syntax_error THEN
      EXECUTE format('GRANT hydris_app TO %I', current_user);
    END;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not grant hydris_app to %; grant it manually (see docs/operations/deployment.md)', current_user;
END $$;
