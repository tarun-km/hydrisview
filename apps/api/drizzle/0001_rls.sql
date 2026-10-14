-- Tenant isolation at the database boundary.
-- The application switches to the non-privileged role hydris_app for every request
-- and sets app.org_id (tenant) or app.bypass (system jobs). Superuser/owner
-- connections bypass RLS, so production must run the app as hydris_app (or a member).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hydris_app') THEN
    CREATE ROLE hydris_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO hydris_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hydris_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hydris_app;
--> statement-breakpoint
-- Audit trail is append-only for the application.
REVOKE UPDATE, DELETE ON audit_events FROM hydris_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hydris_tenant_ok(row_org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.bypass', true) = 'on'
      OR row_org = nullif(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','membership_sites','invitations','sites','facilities','process_areas','assets',
    'gateways','sensors','telemetry_readings','alarm_rules','alarm_events','alarm_event_history',
    'documents','inspection_templates','inspection_routes','inspections','inspection_responses',
    'attachments','maintenance_tasks','maintenance_activity','devices','device_assignments',
    'device_sessions','notifications','audit_events','simulation_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (hydris_tenant_ok(org_id)) WITH CHECK (hydris_tenant_ok(org_id))', t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON organizations USING (hydris_tenant_ok(id)) WITH CHECK (hydris_tenant_ok(id));
