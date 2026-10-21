CREATE TYPE "public"."audit_doc_status" AS ENUM('processing', 'in_review', 'verified', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "audit_document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_document_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"ocr" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid,
	"asset_id" uuid,
	"title" text NOT NULL,
	"doc_type" text DEFAULT 'general' NOT NULL,
	"status" "audit_doc_status" DEFAULT 'in_review' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"extraction" jsonb NOT NULL,
	"engines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_status" text DEFAULT 'none' NOT NULL,
	"ai_error" text,
	"captured_by" uuid,
	"captured_via" text NOT NULL,
	"device_id" uuid,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_document_events" ADD CONSTRAINT "audit_document_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_document_events" ADD CONSTRAINT "audit_document_events_document_id_audit_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."audit_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_document_events" ADD CONSTRAINT "audit_document_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_document_events" ADD CONSTRAINT "audit_document_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_document_pages" ADD CONSTRAINT "audit_document_pages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_document_pages" ADD CONSTRAINT "audit_document_pages_document_id_audit_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."audit_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_document_events_doc_idx" ON "audit_document_events" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_document_pages_uq" ON "audit_document_pages" USING btree ("document_id","page_no");--> statement-breakpoint
CREATE INDEX "audit_documents_org_idx" ON "audit_documents" USING btree ("org_id","created_at");