CREATE TABLE "leetcode_stats" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"total_solved" integer DEFAULT 0 NOT NULL,
	"easy_solved" integer DEFAULT 0 NOT NULL,
	"medium_solved" integer DEFAULT 0 NOT NULL,
	"hard_solved" integer DEFAULT 0 NOT NULL,
	"total_easy" integer DEFAULT 0 NOT NULL,
	"total_medium" integer DEFAULT 0 NOT NULL,
	"total_hard" integer DEFAULT 0 NOT NULL,
	"ranking" integer,
	"reputation" integer DEFAULT 0 NOT NULL,
	"contest_rating" integer,
	"contest_global_ranking" integer,
	"contest_attended" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"total_active_days" integer DEFAULT 0 NOT NULL,
	"submission_calendar" jsonb,
	"language_stats" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "leetcode_handle" text;--> statement-breakpoint
ALTER TABLE "leetcode_stats" ADD CONSTRAINT "leetcode_stats_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;