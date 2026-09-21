CREATE TABLE "flag_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_id" uuid NOT NULL,
	"flag_key" text NOT NULL,
	"environment" text NOT NULL,
	"change" text NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"actor_id" text NOT NULL,
	"approver_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"owner_team" text NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"staging_enabled" boolean DEFAULT false NOT NULL,
	"staging_rollout" integer DEFAULT 0 NOT NULL,
	"production_enabled" boolean DEFAULT false NOT NULL,
	"production_rollout" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flags_key_unique" UNIQUE("key")
);
