CREATE TABLE "telemetry_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sensor_id" uuid NOT NULL,
	"reading_id" bigint NOT NULL,
	"original_value" double precision NOT NULL,
	"corrected_value" double precision,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"corrected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_profile_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"role" "role",
	"user_id" uuid,
	"device_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_profile_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ui_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telemetry_corrections" ADD CONSTRAINT "telemetry_corrections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_corrections" ADD CONSTRAINT "telemetry_corrections_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_corrections" ADD CONSTRAINT "telemetry_corrections_reading_id_telemetry_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."telemetry_readings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_corrections" ADD CONSTRAINT "telemetry_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_assignments" ADD CONSTRAINT "ui_profile_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_assignments" ADD CONSTRAINT "ui_profile_assignments_profile_id_ui_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ui_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_assignments" ADD CONSTRAINT "ui_profile_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_assignments" ADD CONSTRAINT "ui_profile_assignments_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_assignments" ADD CONSTRAINT "ui_profile_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_versions" ADD CONSTRAINT "ui_profile_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_versions" ADD CONSTRAINT "ui_profile_versions_profile_id_ui_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."ui_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_versions" ADD CONSTRAINT "ui_profile_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profile_versions" ADD CONSTRAINT "ui_profile_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profiles" ADD CONSTRAINT "ui_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_profiles" ADD CONSTRAINT "ui_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telemetry_corrections_reading_idx" ON "telemetry_corrections" USING btree ("reading_id","created_at");--> statement-breakpoint
CREATE INDEX "telemetry_corrections_sensor_idx" ON "telemetry_corrections" USING btree ("sensor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ui_assign_org_uq" ON "ui_profile_assignments" USING btree ("org_id") WHERE "ui_profile_assignments"."scope" = 'org';--> statement-breakpoint
CREATE UNIQUE INDEX "ui_assign_role_uq" ON "ui_profile_assignments" USING btree ("org_id","role") WHERE "ui_profile_assignments"."scope" = 'role';--> statement-breakpoint
CREATE UNIQUE INDEX "ui_assign_user_uq" ON "ui_profile_assignments" USING btree ("org_id","user_id") WHERE "ui_profile_assignments"."scope" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "ui_assign_device_uq" ON "ui_profile_assignments" USING btree ("org_id","device_id") WHERE "ui_profile_assignments"."scope" = 'device';--> statement-breakpoint
CREATE UNIQUE INDEX "ui_profile_versions_uq" ON "ui_profile_versions" USING btree ("profile_id","version");--> statement-breakpoint
CREATE INDEX "ui_profile_versions_status_idx" ON "ui_profile_versions" USING btree ("profile_id","status");--> statement-breakpoint
CREATE INDEX "ui_profiles_org_idx" ON "ui_profiles" USING btree ("org_id");