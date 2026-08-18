/**
 * AI weekly digest routes.
 *
 * Builds a narrative summary of the past 7 days per league using real
 * data: games played, scoring leaders, top rebounders, and notable
 * storylines. When a GROQ_API_KEY is configured, the raw facts are
 * passed to Groq's hosted LLM for prose generation. Otherwise a
 * deterministic fallback template renders the same facts cleanly.
 *
 * Cache strategy
 * --------------
 * Digests are keyed by (league_id, iso_week_start). When a cached row
 * exists for the current week we return it. The `/api/ops/digest/:league/regenerate`
 * endpoint forces a fresh generation and overwrites the cache.
 *
 *  Public
 *  ──────
 *  GET /api/public/digest?league=SBBL
 *
 *  Admin
 *  ─────
 *  POST /api/ops/digest/:leagueCode/regenerate
 */

import type { HandlerCtx } from "../shared";
import { json, resolveLeagueId } from "../shared";

function isoWeekStart(d = new Date()): { start: Date; end: Date } {
  // Monday-start weeks; trailing 7 days from today.
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function requireDigestAdmin(ctx: HandlerCtx): Promise<string> {
  const userId = ctx.req.headers.get("x-sbbl-user-id-verified");
  if (!userId) throw new Error("unauthorized");
  const { data } = await ctx.admin
    .from("user_role_assignments")
    .select("role")
    .eq("user_id", userId);
  const roles = (data ?? []).map((r) => String(r.role));
  if (
    !roles.some((r) =>
      ["super_admin", "league_admin", "media_operator"].includes(r),
    )
  ) {
    throw new Error("forbidden");
  }
  return userId;
}

type DigestFacts = {
  leagueCode: string;
  weekStart: string;
  weekEnd: string;
  games: Array<{
    id: string;
    home: string;
    away: string;
    home_score: number;
    away_score: number;
    game_date: string | null;
  }>;
  scoringLeaders: Array<{ name: string; pts: number; team?: string | null }>;
  reboundLeaders: Array<{ name: string; reb: number; team?: string | null }>;
  assistLeaders: Array<{ name: string; ast: number; team?: string | null }>;
};

async function collectFacts(
  admin: HandlerCtx["admin"],
  leagueCode: string,
): Promise<DigestFacts> {
  const { start, end } = isoWeekStart();
  const leagueId = await resolveLeagueId(admin, leagueCode);

  // Games in the last 7 days.
  let gamesQ = admin
    .from("games")
    .select(
      "id, home_score, away_score, game_date, home_team:home_team_id(name), away_team:away_team_id(name), league_id, status, created_at",
    )
    .eq("status", "final")
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString())
    .order("created_at", { ascending: false });
  if (leagueId) gamesQ = gamesQ.eq("league_id", leagueId);
  const { data: games } = await gamesQ;

  const mappedGames = (games ?? []).map((g) => {
    const rec = g as Record<string, unknown>;
    return {
      id: String(rec.id),
      home: String(
        (rec.home_team as { name?: string } | null)?.name ?? "Home",
      ),
      away: String(
        (rec.away_team as { name?: string } | null)?.name ?? "Away",
      ),
      home_score: Number(rec.home_score ?? 0),
      away_score: Number(rec.away_score ?? 0),
      game_date: (rec.game_date as string | null) ?? null,
    };
  });

  // Stat leaders via player_game_stats joined to games in the same window.
  const { data: stats } = await admin
    .from("player_game_stats")
    .select(
      // `players.user_id` carries NO foreign key, so `profiles:user_id(...)`
      // fails the whole query with PGRST200 ("Could not find a relationship
      // between 'players' and 'user_id'"). The real FK is players.profile_id →
      // profiles. players.display_name is the primary name source since the
      // roster/profile decoupling; the profile is only a fallback.
      "pts, reb, ast, player_id, players(display_name, user_id, team_id, teams(name), profiles:profile_id(display_name, full_name)), games!inner(created_at, status, league_id)",
    )
    .gte("games.created_at", start.toISOString())
    .lte("games.created_at", end.toISOString())
    .eq("games.status", "final");

  type Agg = { name: string; team: string | null; pts: number; reb: number; ast: number };
  const agg = new Map<string, Agg>();
  for (const row of stats ?? []) {
    const r = row as Record<string, unknown>;
    const players = r.players as
      | {
          display_name?: string | null;
          user_id?: string;
          team_id?: string;
          teams?: { name?: string } | null;
          profiles?: { display_name?: string; full_name?: string } | null;
        }
      | null;
    const game = r.games as { league_id?: string | null } | null;
    if (leagueId && game?.league_id !== leagueId) continue;
    const key = String(players?.user_id ?? r.player_id ?? "unknown");
    const existing =
      agg.get(key) ??
      {
        name: String(
          players?.display_name ??
            players?.profiles?.display_name ??
            players?.profiles?.full_name ??
            "Unknown",
        ),
        team: players?.teams?.name ?? null,
        pts: 0,
        reb: 0,
        ast: 0,
      };
    existing.pts += Number(r.pts ?? 0);
    existing.reb += Number(r.reb ?? 0);
    existing.ast += Number(r.ast ?? 0);
    agg.set(key, existing);
  }
  const all = Array.from(agg.values());
  const scoringLeaders = [...all].sort((a, b) => b.pts - a.pts).slice(0, 5);
  const reboundLeaders = [...all].sort((a, b) => b.reb - a.reb).slice(0, 5);
  const assistLeaders = [...all].sort((a, b) => b.ast - a.ast).slice(0, 5);

  return {
    leagueCode: leagueCode.toUpperCase(),
    weekStart: formatDate(start),
    weekEnd: formatDate(end),
    games: mappedGames,
    scoringLeaders,
    reboundLeaders,
    assistLeaders,
  };
}

function renderFallbackDigest(
  facts: DigestFacts,
): { headline: string; summary: string; sections: unknown[] } {
  const { leagueCode, games, scoringLeaders } = facts;
  const totalGames = games.length;
  const topScorer = scoringLeaders[0];

  const headline =
    totalGames === 0
      ? `${leagueCode}: Quiet week on the hardwood`
      : topScorer
        ? `${leagueCode} Weekly: ${topScorer.name} torches the league for ${topScorer.pts} pts`
        : `${leagueCode} Weekly Recap`;

  const summaryLines: string[] = [];
  if (totalGames === 0) {
    summaryLines.push(
      `No finalised games in the last 7 days. Check the schedule for upcoming tip-offs.`,
    );
  } else {
    summaryLines.push(
      `${totalGames} games went final this week across ${leagueCode}.`,
    );
    const topMargin = games
      .map((g) => ({
        label: `${g.away} @ ${g.home}`,
        margin: Math.abs(g.home_score - g.away_score),
        score: `${g.home_score}–${g.away_score}`,
      }))
      .sort((a, b) => b.margin - a.margin)[0];
    if (topMargin) {
      summaryLines.push(
        `Biggest statement: ${topMargin.label} (${topMargin.score}).`,
      );
    }
    if (topScorer) {
      summaryLines.push(
        `${topScorer.name} leads all scorers with ${topScorer.pts} total points${
          topScorer.team ? ` for ${topScorer.team}` : ""
        }.`,
      );
    }
  }

  const sections = [
    {
      title: "Scores this week",
      items: games.map((g) => ({
        label: `${g.away} ${g.away_score} — ${g.home_score} ${g.home}`,
      })),
    },
    {
      title: "Scoring leaders",
      items: scoringLeaders.map((p) => ({
        label: `${p.name}${p.team ? ` (${p.team})` : ""}`,
        value: `${p.pts} pts`,
      })),
    },
    {
      title: "Rebound leaders",
      items: facts.reboundLeaders.map((p) => ({
        label: `${p.name}${p.team ? ` (${p.team})` : ""}`,
        value: `${p.reb} reb`,
      })),
    },
    {
      title: "Assist leaders",
      items: facts.assistLeaders.map((p) => ({
        label: `${p.name}${p.team ? ` (${p.team})` : ""}`,
        value: `${p.ast} ast`,
      })),
    },
  ];

  return {
    headline,
    summary: summaryLines.join(" "),
    sections,
  };
}

async function callGroq(
  groqKey: string,
  facts: DigestFacts,
): Promise<{ headline: string; summary: string } | null> {
  try {
    const prompt = `You are the broadcast analyst for the ${facts.leagueCode}. Write a punchy 3-paragraph weekly recap (<280 words) for fans.
Week: ${facts.weekStart} → ${facts.weekEnd}.
Games (final): ${JSON.stringify(facts.games)}.
Scoring leaders (7-day totals): ${JSON.stringify(facts.scoringLeaders)}.
Rebound leaders: ${JSON.stringify(facts.reboundLeaders)}.
Assist leaders: ${JSON.stringify(facts.assistLeaders)}.
Return JSON: {"headline": string, "summary": string}. No markdown.`;
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${groqKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You write concise sports recap copy. Always return valid JSON." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.6,
        max_tokens: 600,
      }),
    });
    if (!resp.ok) return null;
    const j = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = j.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as { headline?: string; summary?: string };
    if (!parsed.headline || !parsed.summary) return null;
    return { headline: String(parsed.headline), summary: String(parsed.summary) };
  } catch (err) {
    console.warn("[digest] groq failed", err);
    return null;
  }
}

async function buildAndStoreDigest(
  ctx: HandlerCtx,
  leagueCode: string,
): Promise<Record<string, unknown>> {
  const facts = await collectFacts(ctx.admin, leagueCode);
  const fallback = renderFallbackDigest(facts);
  const groqKey = (ctx.env as unknown as { GROQ_API_KEY?: string })
    .GROQ_API_KEY;
  let headline = fallback.headline;
  let summary = fallback.summary;
  let model = "fallback";
  if (groqKey) {
    const llm = await callGroq(groqKey, facts);
    if (llm) {
      headline = llm.headline;
      summary = llm.summary;
      model = "llama-3.3-70b";
    }
  }

  const leagueId = await resolveLeagueId(ctx.admin, leagueCode);

  const payload = {
    league_id: leagueId,
    week_start: facts.weekStart,
    week_end: facts.weekEnd,
    headline,
    summary,
    sections: fallback.sections,
    model,
    generated_at: new Date().toISOString(),
  };

  // Upsert on (league_id, week_start).
  const { data, error } = await ctx.admin
    .from("ai_weekly_digest")
    .upsert(payload, { onConflict: "league_id,week_start" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export async function handlePublicDigest(ctx: HandlerCtx) {
  const url = new URL(ctx.req.url);
  const leagueCode = (url.searchParams.get("league") ?? "SBBL").toUpperCase();
  const { start } = isoWeekStart();
  const weekStart = formatDate(start);

  const leagueId = await resolveLeagueId(ctx.admin, leagueCode);

  let q = ctx.admin
    .from("ai_weekly_digest")
    .select("*")
    .eq("week_start", weekStart)
    .limit(1);
  q = leagueId ? q.eq("league_id", leagueId) : q.is("league_id", null);
  const { data: existing } = await q.maybeSingle();

  let digest = existing as Record<string, unknown> | null;
  if (!digest) {
    digest = await buildAndStoreDigest(ctx, leagueCode);
  }

  return new Response(JSON.stringify({ ok: true, digest }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, s-maxage=300, max-age=120",
    },
  });
}

export async function handleRegenerateDigest(ctx: HandlerCtx) {
  await requireDigestAdmin(ctx);
  const leagueCode = (ctx.params.leagueCode ?? "SBBL").toUpperCase();
  const digest = await buildAndStoreDigest(ctx, leagueCode);
  return json({ ok: true, digest });
}
