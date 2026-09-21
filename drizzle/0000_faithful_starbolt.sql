CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action_id" text NOT NULL,
	"app_id" text,
	"entity" text NOT NULL,
	"entity_id" text,
	"before_json" text,
	"after_json" text,
	"ip" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"action_id" text NOT NULL,
	"result_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"action_id" text NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"team_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");