/**
 * Self-hosted LeetCode stats client.
 *
 * Calls leetcode.com/graphql directly. Public profile data needs no auth —
 * only Content-Type + Referer + a real User-Agent.
 *
 * Mirrors the queries used by alfa-leetcode-api and akarsh1995's catalogue,
 * but skips the express wrapper and runs in-process so we can pace requests
 * and cache results in Postgres.
 */

const ENDPOINT = "https://leetcode.com/graphql";
const UA = "Pulse/0.1 (+https://github.com/fived-studio/pulse)";

export class LeetcodeNotFoundError extends Error {
  constructor(handle: string) {
    super(`leetcode user '${handle}' not found`);
    this.name = "LeetcodeNotFoundError";
  }
}

export class LeetcodeRetryableError extends Error {
  constructor(public readonly status: number) {
    super(`leetcode upstream ${status}`);
    this.name = "LeetcodeRetryableError";
  }
}

type GqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

async function gql<T>(query: string, variables: Record<string, unknown>, op?: string): Promise<T> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://leetcode.com",
        "User-Agent": UA,
      },
      body: JSON.stringify({ query, variables, operationName: op }),
      signal: ctrl.signal,
    });

    if (res.status === 429 || res.status >= 500) {
      throw new LeetcodeRetryableError(res.status);
    }
    if (!res.ok) throw new Error(`leetcode http ${res.status}`);

    const json = (await res.json()) as GqlResponse<T>;
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      if (/not exist|not found/i.test(msg)) throw new LeetcodeNotFoundError(String(variables.username ?? ""));
      throw new Error(`leetcode gql: ${msg}`);
    }
    if (!json.data) throw new Error("leetcode: empty data");
    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof LeetcodeNotFoundError) throw err;
      if (i === attempts - 1) break;
      const delay = 500 * 2 ** i + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ---- Queries -----------------------------------------------------------

const Q_PROFILE = /* GraphQL */ `
  query getUserProfile($username: String!) {
    allQuestionsCount {
      difficulty
      count
    }
    matchedUser(username: $username) {
      username
      profile {
        realName
        userAvatar
        ranking
        countryName
        reputation
      }
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
          submissions
        }
      }
    }
  }
`;

const Q_CONTEST = /* GraphQL */ `
  query userContestRankingInfo($username: String!) {
    userContestRanking(username: $username) {
      attendedContestsCount
      rating
      globalRanking
      topPercentage
    }
  }
`;

const Q_CALENDAR = /* GraphQL */ `
  query UserProfileCalendar($username: String!, $year: Int) {
    matchedUser(username: $username) {
      userCalendar(year: $year) {
        submissionCalendar
        streak
        totalActiveDays
      }
    }
  }
`;

const Q_LANGS = /* GraphQL */ `
  query languageStats($username: String!) {
    matchedUser(username: $username) {
      languageProblemCount {
        languageName
        problemsSolved
      }
    }
  }
`;

const Q_BADGES = /* GraphQL */ `
  query userBadges($username: String!) {
    matchedUser(username: $username) {
      badges {
        id
        displayName
        icon
        category
        creationDate
      }
    }
  }
`;

export type LeetcodeBadge = {
  id: string;
  name: string;
  icon: string;
  category: string;
  creationDate: string;
};

function normalizeBadgeIcon(icon: string): string {
  if (!icon) return icon;
  if (icon.startsWith("http://") || icon.startsWith("https://")) return icon;
  if (icon.startsWith("//")) return `https:${icon}`;
  if (icon.startsWith("/")) return `https://leetcode.com${icon}`;
  return icon;
}

// ---- Public types -------------------------------------------------------

export type LeetcodeSnapshot = {
  handle: string;
  realName: string | null;
  avatar: string | null;
  ranking: number | null;
  reputation: number;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  totalEasy: number;
  totalMedium: number;
  totalHard: number;
  contestRating: number | null;
  contestGlobalRanking: number | null;
  contestAttended: number;
  streak: number;
  totalActiveDays: number;
  submissionCalendar: Record<string, number>;
  languageStats: Array<{ languageName: string; problemsSolved: number }>;
  badges: LeetcodeBadge[];
};

// ---- Fetch -------------------------------------------------------------

export async function fetchLeetcodeSnapshot(handle: string): Promise<LeetcodeSnapshot> {
  const username = handle.trim();
  if (!username) throw new Error("empty leetcode handle");

  type ProfileResp = {
    allQuestionsCount: Array<{ difficulty: string; count: number }>;
    matchedUser: {
      username: string;
      profile: {
        realName: string | null;
        userAvatar: string | null;
        ranking: number | null;
        countryName: string | null;
        reputation: number | null;
      };
      submitStatsGlobal: {
        acSubmissionNum: Array<{ difficulty: string; count: number; submissions: number }>;
      };
    } | null;
  };

  const profile = await withRetry(() => gql<ProfileResp>(Q_PROFILE, { username }, "getUserProfile"));
  if (!profile.matchedUser) throw new LeetcodeNotFoundError(username);

  const ac = Object.fromEntries(profile.matchedUser.submitStatsGlobal.acSubmissionNum.map((r) => [r.difficulty, r.count]));
  const totals = Object.fromEntries(profile.allQuestionsCount.map((r) => [r.difficulty, r.count]));

  // Contest + calendar + langs are independent — fetch in parallel but
  // tolerate any single failure (treat as null/empty).
  type ContestResp = {
    userContestRanking: {
      attendedContestsCount: number;
      rating: number;
      globalRanking: number;
      topPercentage: number;
    } | null;
  };
  type CalendarResp = {
    matchedUser: {
      userCalendar: {
        submissionCalendar: string;
        streak: number;
        totalActiveDays: number;
      };
    } | null;
  };
  type LangsResp = {
    matchedUser: {
      languageProblemCount: Array<{ languageName: string; problemsSolved: number }>;
    } | null;
  };
  type BadgesResp = {
    matchedUser: {
      badges: Array<{
        id: string;
        displayName: string;
        icon: string;
        category: string;
        creationDate: string;
      }>;
    } | null;
  };

  // Calendar query is per-year. To populate the past 365 days we need both
  // the current year and the previous year, then merge the keys.
  const thisYear = new Date().getUTCFullYear();
  const lastYear = thisYear - 1;
  const [contest, calThis, calPrev, langs, badges] = await Promise.allSettled([
    withRetry(() => gql<ContestResp>(Q_CONTEST, { username }, "userContestRankingInfo")),
    withRetry(() => gql<CalendarResp>(Q_CALENDAR, { username, year: thisYear }, "UserProfileCalendar")),
    withRetry(() => gql<CalendarResp>(Q_CALENDAR, { username, year: lastYear }, "UserProfileCalendar")),
    withRetry(() => gql<LangsResp>(Q_LANGS, { username }, "languageStats")),
    withRetry(() => gql<BadgesResp>(Q_BADGES, { username }, "userBadges")),
  ]);

  const contestData = contest.status === "fulfilled" ? contest.value.userContestRanking : null;

  function parseCal(s: PromiseSettledResult<CalendarResp>): Record<string, number> {
    if (s.status !== "fulfilled") return {};
    const raw = s.value.matchedUser?.userCalendar?.submissionCalendar;
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      return {};
    }
  }
  const calendarMap: Record<string, number> = { ...parseCal(calPrev), ...parseCal(calThis) };

  // Compute streak + active days from the merged 365-day window so the
  // numbers match what the heatmap actually shows. Past LeetCode-returned
  // `streak` was per-queried-year, which made early-Jan look like a full
  // reset every January.
  const cutoff = (() => {
    const t = new Date();
    const today = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    today.setUTCDate(today.getUTCDate() - 364);
    return Math.floor(today.getTime() / 1000);
  })();
  const todayEpoch = (() => {
    const t = new Date();
    return Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / 1000);
  })();

  let totalActiveDays = 0;
  let maxStreak = 0;
  let currentStreak = 0;
  // Walk every day in the 365-day window so gaps reset the streak even when
  // the calendar map omits zero-count days.
  for (let e = cutoff; e <= todayEpoch; e += 86400) {
    const count = calendarMap[String(e)] ?? 0;
    if (count > 0) {
      totalActiveDays += 1;
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  const langStats =
    langs.status === "fulfilled" && langs.value.matchedUser
      ? langs.value.matchedUser.languageProblemCount
      : [];

  const badgeList: LeetcodeBadge[] =
    badges.status === "fulfilled" && badges.value.matchedUser
      ? badges.value.matchedUser.badges.map((b) => ({
          id: b.id,
          name: b.displayName,
          icon: normalizeBadgeIcon(b.icon),
          category: b.category,
          creationDate: b.creationDate,
        }))
      : [];

  return {
    handle: username,
    realName: profile.matchedUser.profile.realName ?? null,
    avatar: profile.matchedUser.profile.userAvatar ?? null,
    ranking: profile.matchedUser.profile.ranking ?? null,
    reputation: profile.matchedUser.profile.reputation ?? 0,
    totalSolved: ac.All ?? 0,
    easySolved: ac.Easy ?? 0,
    mediumSolved: ac.Medium ?? 0,
    hardSolved: ac.Hard ?? 0,
    totalEasy: totals.Easy ?? 0,
    totalMedium: totals.Medium ?? 0,
    totalHard: totals.Hard ?? 0,
    contestRating: contestData ? Math.round(contestData.rating) : null,
    contestGlobalRanking: contestData?.globalRanking ?? null,
    contestAttended: contestData?.attendedContestsCount ?? 0,
    streak: maxStreak,
    totalActiveDays,
    submissionCalendar: calendarMap,
    languageStats: langStats,
    badges: badgeList,
  };
}

export function weightedScore(snap: Pick<LeetcodeSnapshot, "easySolved" | "mediumSolved" | "hardSolved">): number {
  return snap.easySolved * 1 + snap.mediumSolved * 2 + snap.hardSolved * 4;
}
