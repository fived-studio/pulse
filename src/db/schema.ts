import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role"),
  avatarUrl: text("avatar_url"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  oauthTokenEncrypted: text("oauth_token_encrypted"),
  appInstallationId: bigint("app_installation_id", { mode: "number" }),
  visibility: jsonb("visibility")
    .$type<{
      weekend: boolean;
      latenight: boolean;
      privateRepos: boolean;
      paused: boolean;
    }>()
    .default({ weekend: false, latenight: false, privateRepos: false, paused: false })
    .notNull(),
  leetcodeHandle: text("leetcode_handle"),
});

export const repos = pgTable("repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  fullName: text("full_name").notNull().unique(),
  isFivedOwned: boolean("is_fived_owned").notNull().default(false),
  isMemberOwned: boolean("is_member_owned").notNull().default(false),
  primaryLang: text("primary_lang"),
  stars: integer("stars").notNull().default(0),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: text("delivery_id").unique(),
    source: text("source", { enum: ["webhook", "poll"] }).notNull(),
    eventType: text("event_type").notNull(),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    repoId: uuid("repo_id").references(() => repos.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
    payload: jsonb("payload").notNull(),
    summary: text("summary").notNull(),
  },
  (t) => ({
    recentIdx: index("events_recent_idx").on(t.occurredAt),
    memberRecentIdx: index("events_member_recent_idx").on(t.memberId, t.occurredAt),
  }),
);

export const memberDaily = pgTable(
  "member_daily",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    prsOpened: integer("prs_opened").notNull().default(0),
    prsMerged: integer("prs_merged").notNull().default(0),
    commits: integer("commits").notNull().default(0),
    reviews: integer("reviews").notNull().default(0),
    linesAdded: integer("lines_added").notNull().default(0),
    linesRemoved: integer("lines_removed").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.memberId, t.day] }) }),
);

export const wrappeds = pgTable("wrappeds", {
  id: uuid("id").primaryKey().defaultRandom(),
  quarter: text("quarter").notNull().unique(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  payload: jsonb("payload").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  memberApprovals: jsonb("member_approvals").default({}).notNull(),
});

export const memberBios = pgTable(
  "member_bios",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    bio: text("bio").notNull(),
    factPack: jsonb("fact_pack").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.memberId, t.generatedAt] }) }),
);

export const leetcodeStats = pgTable("leetcode_stats", {
  memberId: uuid("member_id")
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  totalSolved: integer("total_solved").notNull().default(0),
  easySolved: integer("easy_solved").notNull().default(0),
  mediumSolved: integer("medium_solved").notNull().default(0),
  hardSolved: integer("hard_solved").notNull().default(0),
  totalEasy: integer("total_easy").notNull().default(0),
  totalMedium: integer("total_medium").notNull().default(0),
  totalHard: integer("total_hard").notNull().default(0),
  ranking: integer("ranking"),
  reputation: integer("reputation").notNull().default(0),
  contestRating: integer("contest_rating"),
  contestGlobalRanking: integer("contest_global_ranking"),
  contestAttended: integer("contest_attended").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  totalActiveDays: integer("total_active_days").notNull().default(0),
  submissionCalendar: jsonb("submission_calendar").$type<Record<string, number>>(),
  languageStats: jsonb("language_stats").$type<Array<{ languageName: string; problemsSolved: number }>>(),
  badges: jsonb("badges").$type<Array<{
    id: string;
    name: string;
    icon: string;
    category: string;
    creationDate: string;
  }>>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  lastError: text("last_error"),
});

export type Member = typeof members.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Repo = typeof repos.$inferSelect;
export type LeetcodeStats = typeof leetcodeStats.$inferSelect;
