CREATE TABLE "expense_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"requester_id" text NOT NULL,
	"assignee_id" text,
	"due_at" timestamp with time zone,
	"receipt_note" text,
	"employee_email" text,
	"employee_bank_last4" text,
	"team_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
