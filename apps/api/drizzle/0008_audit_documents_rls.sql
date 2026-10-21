GRANT SELECT, INSERT, UPDATE, DELETE ON audit_documents, audit_document_pages TO hydris_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_document_events TO hydris_app;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_documents','audit_document_pages','audit_document_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (hydris_tenant_ok(org_id)) WITH CHECK (hydris_tenant_ok(org_id))', t);
  END LOOP;
END $$;
