ALTER TABLE "devices" ADD COLUMN "approval_state" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "pending_user_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "claim_denied_user_id" uuid;--> statement-breakpoint
ALTER TABLE "pairing_challenges" ADD COLUMN "needs_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_pending_user_id_users_id_fk" FOREIGN KEY ("pending_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_claim_denied_user_id_users_id_fk" FOREIGN KEY ("claim_denied_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Canonical hardware ids (trimmed, lower case) and merge of duplicate live records per organization:
-- the most recently active record is kept, older duplicates are revoked (history stays attached to them).
UPDATE "devices" SET "hardware_id" = lower(btrim("hardware_id")) WHERE "hardware_id" <> lower(btrim("hardware_id"));--> statement-breakpoint
WITH ranked AS (
  SELECT "id", first_value("id") OVER w AS keep_id, row_number() OVER w AS rn
  FROM "devices" WHERE "status" <> 'revoked'
  WINDOW w AS (PARTITION BY "org_id", "hardware_id" ORDER BY coalesce("last_seen_at", "paired_at") DESC, "created_at" DESC)
)
UPDATE "devices" d SET "status" = 'revoked', "revoked_at" = now(), "revoke_reason" = 'Merged duplicate of ' || ranked.keep_id::text, "session_version" = d."session_version" + 1, "updated_at" = now()
FROM ranked WHERE d."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
UPDATE "device_assignments" a SET "unassigned_at" = now(), "reason" = 'merged duplicate'
FROM "devices" d WHERE a."device_id" = d."id" AND a."unassigned_at" IS NULL AND d."status" = 'revoked' AND d."revoke_reason" LIKE 'Merged duplicate of %';--> statement-breakpoint
UPDATE "device_sessions" s SET "revoked_at" = now()
FROM "devices" d WHERE s."device_id" = d."id" AND s."revoked_at" IS NULL AND d."status" = 'revoked' AND d."revoke_reason" LIKE 'Merged duplicate of %';--> statement-breakpoint
CREATE UNIQUE INDEX "devices_org_hw_live_uq" ON "devices" USING btree ("org_id","hardware_id") WHERE "devices"."status" <> 'revoked';