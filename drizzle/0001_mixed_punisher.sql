CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"app_id" text,
	"requester_id" text NOT NULL,
	"input_json" text NOT NULL,
	"policy_json" text NOT NULL,
	"idem_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"approver_id" text,
	"reason" text,
	"decided_at" timestamp with time zone,
	"result_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "approval_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_requester_idx" ON "approval_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("app_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "notes_entity_idx" ON "notes" USING btree ("app_id","entity","entity_id");