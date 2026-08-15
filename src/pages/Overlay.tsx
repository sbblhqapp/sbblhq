/**
 * /overlay/:gameId — chromeless scoreboard overlay for OBS browser source.
 *
 * Usage (OBS):
 *   Browser source URL: https://sbbl-hq.icu/overlay/<gameId>?theme=<theme>
 *   Width: 1920  Height: 1080  "Custom CSS": (blank)
 *   Shutdown source when not visible: off
 *
 * The page is 100% transparent background. Only the scoreboard and sponsor
 * bug render. Polls the worker every 1 s and animates the clock locally.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { fetchOverlay, type OverlayPayload } from '@/lib/api/overlay';
import { trackSponsorEvent } from '@/lib/api/sponsors';
import { getSupabaseClient } from '@/lib/supabase/client';
import CheerMeter from '@/components/CheerMeter';
import { isBroadcastOverlayV2Enabled } from '@/lib/feature-flags';

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  if (safe < 60) {
    // Tenths in final minute; OBS-friendly read.
    const tenths = Math.max(0, Math.floor((seconds - safe) * 10));
    return `${ss}.${tenths}`;
  }
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

type OverlayCard =
  | 'scorebug'
  | 'lower-third'
  | 'lineup'
  | 'game-state'
  | 'sponsor'
  | 'postgame'
  | 'matchup'
  | 'stat-leader';

function parseOverlayCard(value: string | null): OverlayCard {
  switch (value) {
    case 'lower-third':
    case 'lineup':
    case 'game-state':
    case 'sponsor':
    case 'postgame':
    case 'matchup':
    case 'stat-leader':
      return value;
    default:
      return 'scorebug';
  }
}

function teamShort(name: string): string {
  if (!name) return '---';
  // Respect acronyms already.
  const trimmed = name.trim();
  if (trimmed.length <= 4) return trimmed.toUpperCase();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return parts.map((p) => p[0]).join('').slice(0, 4).toUpperCase();
  }
  return trimmed.slice(0, 4).toUpperCase();
}

export default function OverlayPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [params] = useSearchParams();
  const theme = params.get('theme') ?? 'default';
  const card = parseOverlayCard(params.get('card'));

  const [payload, setPayload] = useState<OverlayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const sponsorTrackedRef = useRef<string | null>(null);

  // Remove body scrollbars/padding so nothing leaks into OBS.
  useEffect(() => {
    const prevBg = document.body.style.background;
    const prevOverflow = document.body.style.overflow;
    document.body.style.background = 'transparent';
    document.documentElement.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.background = prevBg;
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Load initial overlay + game + sponsor payload, then refresh every 5 s
  // to rotate the sponsor slot (server-side rotation key is 15 s) and to
  // pick up any metadata changes to the games row. Score/clock/event fields
  // are pushed via the Realtime subscription below — the poll is intentionally
  // slow, it's no longer the primary update channel.
  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchOverlay(gameId, theme);
        if (!cancelled) {
          setPayload(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    void load();
    const id = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [gameId, theme]);

  // Realtime push for overlay_game_state changes — sub-100 ms score/clock.
  useEffect(() => {
    if (!gameId) return;
    const client = getSupabaseClient();
    if (!client) return;
    const channel = client
      .channel(`overlay-state-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'overlay_game_state',
          filter: `game_id=eq.${gameId}`,
        },
        (evt) => {
          const nextOverlay = evt.new as OverlayPayload['overlay'];
          if (!nextOverlay) return;
          setPayload((prev) => (prev ? { ...prev, overlay: nextOverlay } : prev));
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [gameId]);

  // Local animation tick — keeps the clock smooth between polls.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  // Track sponsor impression once per sponsor+game.
  useEffect(() => {
    const sponsor = payload?.sponsor;
    if (!sponsor || !gameId) return;
    const key = `${sponsor.id}:${gameId}`;
    if (sponsorTrackedRef.current === key) return;
    sponsorTrackedRef.current = key;
    void trackSponsorEvent(sponsor.id, { kind: 'impression', game_id: gameId }).catch(() => {});
  }, [payload?.sponsor, gameId]);

  const liveClock = useMemo(() => {
    const o = payload?.overlay;
    if (!o) return 0;
    if (!o.clock_running || !o.clock_last_started_at) {
      return o.clock_seconds;
    }
    const elapsedMs = nowMs - new Date(o.clock_last_started_at).getTime();
    return Math.max(0, o.clock_seconds - elapsedMs / 1000);
  }, [payload, nowMs]);

  if (!gameId) {
    return <div style={{ color: 'white' }}>Missing gameId.</div>;
  }

  if (error && !payload) {
    return (
      <div
        style={{
          color: '#fff',
          fontFamily: 'Inter, sans-serif',
          padding: 12,
        }}
      >
        Overlay unavailable: {error}
      </div>
    );
  }

  if (!payload || !payload.game) {
    return (
      <div
        style={{
          color: '#fff',
          fontFamily: 'Inter, sans-serif',
          padding: 12,
        }}
      >
        Overlay unavailable: Missing game data.
      </div>
    );
  }

  const overlay = payload.overlay;
  const game = payload.game;
  const sponsor = payload.sponsor;
  const homeName =
    game?.home_team?.name ??
    game?.participant1_label ??
    (game?.event_name ? 'Home' : 'Home');
  const awayName =
    game?.away_team?.name ??
    game?.participant2_label ??
    (game?.event_name ? 'Away' : 'Away');
  const leagueCode = game?.leagues?.code ?? '';

  if (isBroadcastOverlayV2Enabled() && card !== 'scorebug') {
    return (
      <OverlayV2Card
        card={card}
        gameId={gameId}
        homeName={homeName}
        awayName={awayName}
        leagueCode={leagueCode}
        overlay={overlay}
        game={game}
        sponsor={sponsor}
        liveClock={liveClock}
      />
    );
  }

  return (
    <div
      data-testid="overlay-root"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        background: 'transparent',
        color: '#fff',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Scorebug — bottom left */}
      <div
        style={{
          position: 'absolute',
          left: 32,
          bottom: 32,
          display: 'flex',
          alignItems: 'stretch',
          boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(10,12,18,0.92)',
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* League chip */}
        <div
          style={{
            background: 'linear-gradient(180deg,#ffb020,#ff6b00)',
            color: '#000',
            fontWeight: 900,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            letterSpacing: '0.1em',
            fontSize: 14,
          }}
        >
          {leagueCode || 'LIVE'}
        </div>

        {/* Away */}
        <TeamBlock
          name={awayName}
          short={teamShort(awayName)}
          score={overlay?.away_score ?? game.away_score ?? 0}
          bonus={overlay?.bonus_away ?? false}
          fouls={overlay?.away_fouls ?? 0}
          hasPossession={overlay?.possession === 'away'}
          timeouts={overlay?.away_timeouts_left ?? 0}
        />

        {/* Clock + period */}
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            padding: '10px 18px',
            minWidth: 128,
            textAlign: 'center',
            borderLeft: '1px solid rgba(255,255,255,0.08)',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 2,
          }}
        >
          <div
            style={{
              fontFamily: "'Space Grotesk', ui-monospace, monospace",
              fontSize: 40,
              lineHeight: 1,
              fontWeight: 600,
              letterSpacing: '0.04em',
              fontVariantNumeric: 'tabular-nums',
              color: overlay?.clock_running ? '#fff' : '#ffb020',
            }}
          >
            {formatClock(liveClock)}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.7)',
              fontWeight: 700,
              letterSpacing: '0.18em',
            }}
          >
            {overlay?.period_label ?? 'Q1'}
          </div>
        </div>

        {/* Home */}
        <TeamBlock
          name={homeName}
          short={teamShort(homeName)}
          score={overlay?.home_score ?? game.home_score ?? 0}
          bonus={overlay?.bonus_home ?? false}
          fouls={overlay?.home_fouls ?? 0}
          hasPossession={overlay?.possession === 'home'}
          timeouts={overlay?.home_timeouts_left ?? 0}
        />
      </div>

      {/* Last-event ticker */}
      {overlay?.last_event_text && (
        <div
          style={{
            position: 'absolute',
            left: 32,
            bottom: 160,
            padding: '8px 14px',
            background: 'rgba(10,12,18,0.82)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderLeft: '4px solid #ffb020',
            borderRadius: 6,
            fontSize: 13,
            letterSpacing: '0.02em',
            maxWidth: 520,
          }}
        >
          {overlay.last_event_text}
        </div>
      )}

      {/* Lower third */}
      {overlay?.show_lower_third && overlay.lower_third_text && (
        <div
          style={{
            position: 'absolute',
            left: 32,
            right: 32,
            bottom: 220,
            padding: '14px 22px',
            background:
              'linear-gradient(90deg, rgba(10,12,18,0.95) 0%, rgba(10,12,18,0.55) 90%)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderLeft: '6px solid #ff6b00',
            borderRadius: 6,
            maxWidth: 680,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {overlay.lower_third_text}
          </div>
          {overlay.lower_third_subtext && (
            <div
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.7)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginTop: 2,
              }}
            >
              {overlay.lower_third_subtext}
            </div>
          )}
        </div>
      )}

      {/* Cheer meter — top left (mirror of sponsor bug) */}
      <div
        style={{
          position: 'absolute',
          top: 32,
          left: 32,
        }}
      >
        <CheerMeter gameId={gameId} variant="overlay" />
      </div>

      {/* Sponsor bug — top right */}
      {overlay?.show_sponsor_bug && sponsor && (
        <div
          style={{
            position: 'absolute',
            top: 32,
            right: 32,
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderRadius: 8,
            background: sponsor.background_color ?? 'rgba(10,12,18,0.9)',
            color: sponsor.text_color ?? '#fff',
            boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.08)',
            minWidth: 220,
          }}
        >
          {sponsor.logo_url && (
            <img
              src={sponsor.logo_url}
              alt={sponsor.name}
              style={{ height: 30, width: 'auto' }}
            />
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                opacity: 0.7,
              }}
            >
              Presented by
            </span>
            <span style={{ fontWeight: 800, fontSize: 15 }}>
              {sponsor.name}
            </span>
            {sponsor.tagline && (
              <span style={{ fontSize: 11, opacity: 0.8 }}>
                {sponsor.tagline}
              </span>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

function TeamBlock({
  name,
  short,
  score,
  bonus,
  fouls,
  hasPossession,
  timeouts,
}: {
  name: string;
  short: string;
  score: number;
  bonus: boolean;
  fouls: number;
  hasPossession: boolean;
  timeouts: number;
}) {
  return (
    <div
      style={{
        padding: '10px 18px 10px 14px',
        minWidth: 148,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        position: 'relative',
      }}
      title={name}
    >
      {hasPossession && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#ffb020',
            boxShadow: '0 0 10px #ffb020',
          }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <span
          style={{
            fontWeight: 900,
            fontSize: 16,
            letterSpacing: '0.06em',
          }}
        >
          {short}
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          {fouls} {fouls === 1 ? 'foul' : 'fouls'}
          {bonus ? ' · BONUS' : ''}
          {timeouts > 0 ? ` · ${timeouts} TO` : ''}
        </span>
      </div>
      <span
        style={{
          marginLeft: 'auto',
          fontFamily: "'Space Grotesk', ui-monospace, monospace",
          fontSize: 40,
          lineHeight: 1,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {score}
      </span>
    </div>
  );
}


type OverlayV2CardProps = {
  card: OverlayCard;
  gameId: string;
  homeName: string;
  awayName: string;
  leagueCode: string;
  overlay: OverlayPayload['overlay'];
  game: OverlayPayload['game'];
  sponsor: OverlayPayload['sponsor'];
  liveClock: number;
};

function OverlayV2Card({
  card,
  gameId,
  homeName,
  awayName,
  leagueCode,
  overlay,
  game,
  sponsor,
  liveClock,
}: OverlayV2CardProps) {
  const homeScore = overlay?.home_score ?? game.home_score ?? 0;
  const awayScore = overlay?.away_score ?? game.away_score ?? 0;
  const panelTitle = card.replace('-', ' ').toUpperCase();
  const basePanel: CSSProperties = {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    background: 'transparent',
    color: '#fff',
    fontFamily: 'Inter, system-ui, sans-serif',
  };
  const cardStyle: CSSProperties = {
    position: 'absolute',
    left: 48,
    bottom: 48,
    width: 680,
    borderRadius: 18,
    padding: 28,
    background: 'linear-gradient(135deg, rgba(5,8,14,0.94), rgba(20,24,34,0.72))',
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: '0 18px 70px rgba(0,0,0,0.48)',
    backdropFilter: 'blur(12px)',
  };

  const Header = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 18 }}>
      <div style={{ fontSize: 12, letterSpacing: '0.2em', color: '#ffb020', fontWeight: 900 }}>{leagueCode || 'SBBL HQ'} · {panelTitle}</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>Game {gameId.slice(0, 8)}</div>
    </div>
  );

  let body: ReactNode;
  switch (card) {
    case 'lower-third':
      body = (
        <>
          <Header />
          <div style={{ fontSize: 42, fontWeight: 950 }}>{overlay?.lower_third_text ?? overlay?.last_event_text ?? 'Live Game Update'}</div>
          <div style={{ marginTop: 8, fontSize: 18, color: 'rgba(255,255,255,0.74)' }}>{overlay?.lower_third_subtext ?? `${awayName} at ${homeName}`}</div>
        </>
      );
      break;
    case 'lineup':
      body = (
        <>
          <Header />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <RosterColumn title={awayName} values={['Starting five pending', 'Bench managed in HQ', 'No premium controls exposed']} />
            <RosterColumn title={homeName} values={['Starting five pending', 'Bench managed in HQ', 'Read-only OBS panel']} />
          </div>
        </>
      );
      break;
    case 'game-state':
      body = (
        <>
          <Header />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
            <Metric label={teamShort(awayName)} value={awayScore} />
            <Metric label={overlay?.period_label ?? 'Q1'} value={formatClock(liveClock)} />
            <Metric label={teamShort(homeName)} value={homeScore} />
          </div>
        </>
      );
      break;
    case 'sponsor':
      body = (
        <>
          <Header />
          <div style={{ fontSize: 16, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.68)' }}>Presented by</div>
          <div style={{ marginTop: 8, fontSize: 48, fontWeight: 950 }}>{sponsor?.name ?? 'SBBL HQ Partners'}</div>
          {sponsor?.tagline && <div style={{ marginTop: 8, fontSize: 20, color: 'rgba(255,255,255,0.76)' }}>{sponsor.tagline}</div>}
        </>
      );
      break;
    case 'postgame':
      body = (
        <>
          <Header />
          <div style={{ fontSize: 24, color: '#ffb020', fontWeight: 900 }}>FINAL</div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 44, fontWeight: 950 }}>
            <span>{awayName} {awayScore}</span>
            <span>{homeName} {homeScore}</span>
          </div>
        </>
      );
      break;
    case 'matchup':
      body = (
        <>
          <Header />
          <div style={{ fontSize: 52, fontWeight: 950 }}>{awayName}</div>
          <div style={{ margin: '8px 0', fontSize: 22, color: '#ffb020', fontWeight: 900 }}>VS</div>
          <div style={{ fontSize: 52, fontWeight: 950 }}>{homeName}</div>
          <div style={{ marginTop: 14, fontSize: 16, color: 'rgba(255,255,255,0.7)' }}>{game.event_name ?? 'Live basketball broadcast'}</div>
        </>
      );
      break;
    case 'stat-leader':
      body = (
        <>
          <Header />
          <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.7)' }}>Stat leader card</div>
          <div style={{ marginTop: 8, fontSize: 42, fontWeight: 950 }}>{overlay?.last_event_text ?? 'Awaiting first stat marker'}</div>
          <div style={{ marginTop: 12, fontSize: 16, color: '#ffb020' }}>{awayName} {awayScore} · {homeName} {homeScore}</div>
        </>
      );
      break;
    default:
      body = null;
  }

  return <div data-testid={`overlay-v2-${card}`} style={basePanel}><div style={cardStyle}>{body}</div></div>;
}

function RosterColumn({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={{ borderLeft: '4px solid #ffb020', paddingLeft: 14 }}>
      <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 10 }}>{title}</div>
      {values.map((value) => <div key={value} style={{ fontSize: 16, color: 'rgba(255,255,255,0.76)', margin: '6px 0' }}>{value}</div>)}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ minWidth: 150, textAlign: 'center' }}>
      <div style={{ fontSize: 13, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.65)' }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 48, fontWeight: 950, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}
