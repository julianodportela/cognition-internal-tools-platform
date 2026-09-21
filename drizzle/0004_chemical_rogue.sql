CREATE TABLE "job_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"leased_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_txn_active_uniq" ON "refunds" USING btree ("transaction_id") WHERE status IN ('pending','issued');