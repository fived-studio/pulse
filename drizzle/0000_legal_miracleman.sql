CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"member_id" uuid,
	"repo_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" text NOT NULL,
	CONSTRAINT "events_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "member_bios" (
	"member_id" uuid NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"bio" text NOT NULL,
	"fact_pack" jsonb NOT NULL,
	CONSTRAINT "member_bios_member_id_generated_at_pk" PRIMARY KEY("member_id","generated_at")
);
--> statement-breakpoint
CREATE TABLE "member_daily" (
	"member_id" uuid NOT NULL,
	"day" date NOT NULL,
	"prs_opened" integer DEFAULT 0 NOT NULL,
	"prs_merged" integer DEFAULT 0 NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"lines_added" integer DEFAULT 0 NOT NULL,
	"lines_removed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "member_daily_member_id_day_pk" PRIMARY KEY("member_id","day")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text,
	"avatar_url" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"oauth_token_encrypted" text,
	"app_installation_id" bigint,
	"visibility" jsonb DEFAULT '{"weekend":false,"latenight":false,"privateRepos":false,"paused":false}'::jsonb NOT NULL,
	CONSTRAINT "members_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "members_github_login_unique" UNIQUE("github_login")
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"is_fived_owned" boolean DEFAULT false NOT NULL,
	"is_member_owned" boolean DEFAULT false NOT NULL,
	"primary_lang" text,
	"stars" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone,
	CONSTRAINT "repos_github_id_unique" UNIQUE("github_id"),
	CONSTRAINT "repos_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE "wrappeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quarter" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"member_approvals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "wrappeds_quarter_unique" UNIQUE("quarter")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_bios" ADD CONSTRAINT "member_bios_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_daily" ADD CONSTRAINT "member_daily_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_recent_idx" ON "events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "events_member_recent_idx" ON "events" USING btree ("member_id","occurred_at");