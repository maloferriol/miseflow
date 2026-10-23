CREATE TABLE "applied_mutations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
