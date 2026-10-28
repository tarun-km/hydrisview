-- Phase 1 identity: two account types (admin | operator), membership lifecycle
-- (invited | active | suspended | removed), operator profile fields, invitation status,
-- Supabase Auth user link and organization setup state.
--
-- Postgres cannot drop enum values, so both enums are rebuilt: columns go to text,
-- values are mapped, the type is recreated, and the columns are cast back.
-- Legacy role mapping:
--   org_admin, factory_manager, supervisor              -> admin
--   field_operator, maintenance_engineer, viewer        -> operator
-- Legacy membership status: deactivated -> suspended.

-- Tables use FORCE ROW LEVEL SECURITY, which also binds the (non-superuser) owner that runs
-- migrations on managed Postgres (Supabase, Neon). Enable the system bypass for this transaction
-- so the data updates below see every tenant's rows.
SELECT set_config('app.bypass', 'on', true);
--> statement-breakpoint

-- ---------------------------------------------------------------- role -> account type
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE text USING "role"::text;
--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE text USING "role"::text;
--> statement-breakpoint
ALTER TABLE "ui_profile_assignments" ALTER COLUMN "role" TYPE text USING "role"::text;
--> statement-breakpoint
DROP TYPE "public"."role";
--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'operator');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hydris_map_legacy_role(r text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN r IN ('org_admin', 'factory_manager', 'supervisor', 'admin') THEN 'admin'
    WHEN r IS NULL THEN NULL
    ELSE 'operator'
  END
$$;
--> statement-breakpoint
UPDATE "memberships" SET "role" = hydris_map_legacy_role("role");
--> statement-breakpoint
UPDATE "invitations" SET "role" = hydris_map_legacy_role("role");
--> statement-breakpoint
-- Role-scoped glasses UI profile assignments collapse onto two roles: keep one per (org, role),
-- preferring the assignment that was made for the canonical legacy role, then the newest.
DELETE FROM "ui_profile_assignments" a
USING (
  SELECT id, row_number() OVER (
    PARTITION BY org_id, hydris_map_legacy_role(role)
    ORDER BY CASE WHEN role IN ('org_admin', 'field_operator') THEN 0 ELSE 1 END, created_at DESC
  ) AS rn
  FROM "ui_profile_assignments" WHERE scope = 'role'
) d
WHERE a.id = d.id AND d.rn > 1;
--> statement-breakpoint
UPDATE "ui_profile_assignments" SET "role" = hydris_map_legacy_role("role") WHERE "role" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "public"."role" USING "role"::"public"."role";
--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "public"."role" USING "role"::"public"."role";
--> statement-breakpoint
ALTER TABLE "ui_profile_assignments" ALTER COLUMN "role" TYPE "public"."role" USING "role"::"public"."role";
--> statement-breakpoint

-- ---------------------------------------------------------------- membership lifecycle
ALTER TABLE "memberships" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "status" TYPE text USING "status"::text;
--> statement-breakpoint
DROP TYPE "public"."membership_status";
--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'removed');
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "suspended_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "removed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "memberships" SET "status" = 'suspended', "suspended_at" = coalesce("deactivated_at", now()) WHERE "status" = 'deactivated';
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "status" TYPE "public"."membership_status" USING "status"::"public"."membership_status";
--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "status" SET DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "status_changed_by" uuid;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_status_changed_by_users_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- ---------------------------------------------------------------- operator profile
ALTER TABLE "memberships" ADD COLUMN "employee_id" text;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "phone" text;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "shift_label" text;
--> statement-breakpoint

-- ---------------------------------------------------------------- invitations
ALTER TABLE "invitations" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
UPDATE "invitations" SET "status" = CASE WHEN "accepted_at" IS NOT NULL THEN 'accepted' WHEN "revoked_at" IS NOT NULL THEN 'revoked' ELSE 'pending' END;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "employee_id" text;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "phone" text;
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "shift_label" text;
--> statement-breakpoint

-- ---------------------------------------------------------------- Supabase link, org setup
ALTER TABLE "users" ADD COLUMN "supabase_user_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_supabase_uq" ON "users" USING btree ("supabase_user_id");
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "email_domain" text;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "setup_completed_at" timestamp with time zone;
--> statement-breakpoint
-- Existing organizations were set up before the wizard existed.
UPDATE "organizations" SET "setup_completed_at" = "created_at" WHERE "setup_completed_at" IS NULL;
--> statement-breakpoint
-- New columns on RLS tables are covered by the existing tenant_isolation policies (org_id);
-- users/organizations keep their existing grants. Re-assert grants for the application role.
GRANT SELECT, INSERT, UPDATE, DELETE ON users, organizations, memberships, invitations TO hydris_app;
