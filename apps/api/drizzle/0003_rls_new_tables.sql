GRANT SELECT, INSERT, UPDATE, DELETE ON telemetry_corrections, ui_profiles, ui_profile_versions, ui_profile_assignments TO hydris_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON telemetry_corrections FROM hydris_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['telemetry_corrections','ui_profiles','ui_profile_versions','ui_profile_assignments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (hydris_tenant_ok(org_id)) WITH CHECK (hydris_tenant_ok(org_id))', t);
  END LOOP;
END $$;
