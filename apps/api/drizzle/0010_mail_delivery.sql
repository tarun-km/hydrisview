ALTER TABLE "mail_outbox" ADD COLUMN "body_html" text;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone;