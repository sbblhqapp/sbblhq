/**
 * /overlay-control/:gameId — operator console.
 *
 * Admin-only. Drives the OBS scoreboard overlay in real time.
 * Pairs with /overlay/:gameId (the chromeless browser source).
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  fetchOverlay,
  patchOverlay,
  controlClock,
  adjustScore,
  adjustFoul,
  advancePeriod,
  resetOverlay,
  postBiometrics,
  postOverlayEvent,
  type OverlayPayload,
} from '@/lib/api/overlay';
import { enqueueObsCommand } from '@/lib/api/digest';
import HighlightMarker from '@/components/HighlightMarker';

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

export default function OverlayControlPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const query = useQuery<OverlayPayload>({
    queryKey: ['overlay-control', gameId],
    queryFn: () => fetchOverlay(gameId!),
    refetchInterval: 1500,
    refetchIntervalInBackground: false,
    enabled: !!gameId,
  });

  const overlay = query.data?.overlay ?? null;
  const game = query.data?.game;

  const liveSeconds = useMemo(() => {
    if (!overlay) return 0;
    if (!overlay.clock_running || !overlay.clock_last_started_at) {
      return overlay.clock_seconds;
    }
    const elapsed =
      (nowMs - new Date(overlay.clock_last_started_at).getTime()) / 1000;
    return Math.max(0, overlay.clock_seconds - elapsed);
  }, [overlay, nowMs]);

  if (!gameId) return <div className="p-6">Missing gameId.</div>;
  if (query.isLoading) return <div className="p-6">Loading…</div>;
  if (!game) return <div className="p-6">Game not found.</div>;

  const action = async (promise: Promise<unknown>, label: string) => {
    try {
      await promise;
      await query.refetch();
      toast.success(label);
    } catch (err) {
      toast.error(`${label} failed: ${(err as Error).message}`);
    }
  };

  const overlayUrl = `${window.location.origin}/overlay/${gameId}`;

  return (
    <div className="container py-8 max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Overlay Control</h1>
          <p className="text-muted-foreground text-sm">
            {game.leagues?.code ?? ''} · {game.away_team?.name ?? 'Away'} @{' '}
            {game.home_team?.name ?? 'Home'}
          </p>
        </div>
        <div className="panel p-3 text-xs">
          <div className="font-semibold mb-1 uppercase tracking-wider text-muted-foreground">
            OBS Browser Source URL
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-[11px] break-all max-w-[380px]">
              {overlayUrl}
            </code>
            <button
              className="px-2 py-1 text-[11px] border border-border rounded-sm hover:bg-secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(overlayUrl);
                toast.success('Copied');
              }}
            >
              Copy
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Score controls — away */}
        <div className="panel p-4">
          <h2 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-2">
            Away · {game.away_team?.name ?? 'Away'}
          </h2>
          <div className="stat-numeral text-5xl text-center mb-3">
            {overlay?.away_score ?? 0}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() =>
                  action(
                    adjustScore(gameId, 'away', { delta: n }),
                    `+${n} away`,
                  )
                }
                className="px-3 py-2 bg-primary text-primary-foreground rounded-sm font-bold"
              >
                +{n}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 px-3 py-1 text-xs border border-border rounded-sm hover:bg-secondary"
              onClick={() =>
                action(adjustScore(gameId, 'away', { delta: -1 }), '-1 away')
              }
            >
              -1
            </button>
            <button
              className="flex-1 px-3 py-1 text-xs border border-border rounded-sm hover:bg-secondary"
              onClick={() => action(adjustFoul(gameId, 'away', { delta: 1 }), 'away foul')}
            >
              +foul ({overlay?.away_fouls ?? 0})
            </button>
            <button
              className="flex-1 px-3 py-1 text-xs border border-border rounded-sm hover:bg-secondary"
              onClick={() =>
                action(
                  patchOverlay(gameId, {
                    possession: 'away',
                  }),
                  'away possession',
                )
              }
            >
              Poss.
            </button>
          </div>
        </div>

        {/* Clock & period */}
        <div className="panel p-4">
          <h2 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-2">
            Clock · {overlay?.period_label ?? 'Q1'}
          </h2>
          <div className="stat-numeral text-5xl text-center mb-3">
            {fmt(liveSeconds)}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              className="px-3 py-2 bg-green-600 text-white rounded-sm font-bold"
              onClick={() => action(controlClock(gameId, 'start'), 'clock start')}
            >
              ▶ Start
            </button>
            <button
              className="px-3 py-2 bg-red-600 text-white rounded-sm font-bold"
              onClick={() => action(controlClock(gameId, 'stop'), 'clock stop')}
            >
              ■ Stop
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[600, 480, 300].map((s) => (
              <button
                key={s}
                className="px-2 py-1 text-xs border border-border rounded-sm hover:bg-secondary"
                onClick={() =>
                  action(
                    controlClock(gameId, 'set', s),
                    `clock ${fmt(s)}`,
                  )
                }
              >
                {fmt(s)}
              </button>
            ))}
          </div>
          <button
            className="w-full mt-2 px-3 py-2 border border-border rounded-sm hover:bg-secondary text-sm"
            onClick={() => action(advancePeriod(gameId, 'next'), 'next period')}
          >
            Next Period →
          </button>
        </div>

        {/* Score controls — home */}
        <div className="panel p-4">
          <h2 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-2">
            Home · {game.home_team?.name ?? 'Home'}
          </h2>
          <div className="stat-numeral text-5xl text-center mb-3">
            {overlay?.home_score ?? 0}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() =>
                  action(adjustScore(gameId, 'home', { delta: n }), `+${n} home`)
                }
                className="px-3 py-2 bg-primary text-primary-foreground rounded-sm font-bold"
              >
                +{n}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 px-3 py-1 text-xs border border-border rounded-sm hover:bg-secondary"
              onClick={() =>
                action(adjustScore(gameId, 'home', { delta: -1 }), '-1 home')
              }
            >
              -1
            </button>
            <button
              className="flex-1 px-3 py-1 text-xs border border-border rounded-sm hover:bg-secondary"
              onClick={() => action(adjustFoul(gameId, 'home', { delta: 1 }), 'home foul')}
            >
              +foul ({overlay?.home_fouls ?? 0})
            </button>
            <button
              className="flex-1 px-3 py-1 text-xs border border-border rounded-sm hover:bg-secondary"
              onClick={() =>
                action(
                  patchOverlay(gameId, {
                    possession: 'home',
                  }),
                  'home possession',
                )
              }
            >
              Poss.
            </button>
          </div>
        </div>
      </div>

      {/* Lower third + event ticker */}
      <div className="mt-6 panel p-4">
        <h2 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-2">
          Announce · Lower third
        </h2>
        <LowerThirdEditor
          gameId={gameId}
          current={overlay}
          onRefresh={() => query.refetch()}
        />
      </div>

      {/* Highlight marker */}
      <div className="mt-6 panel p-4">
        <h2 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-2">
          Highlights
        </h2>
        <HighlightMarker gameId={gameId} />
      </div>

      {/* OBS control */}
      <div className="mt-6 panel p-4">
        <h2 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-2">
          OBS control
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Commands are placed on a queue and consumed by the on-site obs-agent
          process. Requires <code>OBS_AGENT_TOKEN</code> to be set on the
          broadcast workstation.
        </p>
        <div className="flex flex-wrap gap-2">
          <ObsButton kind="start_stream" label="Start Stream" gameId={gameId} />
          <ObsButton kind="stop_stream"  label="Stop Stream"  gameId={gameId} />
          <ObsButton kind="start_record" label="Start Record" gameId={gameId} />
          <ObsButton kind="stop_record"  label="Stop Record"  gameId={gameId} />
          <ObsButton
            kind="refresh_browser_source"
            label="Refresh Overlay"
            gameId={gameId}
            payload={{ source: 'scoreboard_overlay' }}
          />
        </div>
      </div>

      <div className="mt-6 flex gap-2 flex-wrap">
        <button
          className="px-4 py-2 border border-border rounded-sm hover:bg-secondary text-sm"
          onClick={() => action(resetOverlay(gameId), 'overlay reset')}
        >
          Reset overlay
        </button>
        <button
          className="px-4 py-2 border border-border rounded-sm hover:bg-secondary text-sm"
          onClick={() =>
            action(
              patchOverlay(gameId, { show_sponsor_bug: !overlay?.show_sponsor_bug }),
              'sponsor bug toggled',
            )
          }
        >
          Sponsor bug: {overlay?.show_sponsor_bug ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}

function LowerThirdEditor({
  gameId,
  current,
  onRefresh,
}: {
  gameId: string;
  current: OverlayPayload['overlay'];
  onRefresh: () => void;
}) {
  const [title, setTitle] = useState(current?.lower_third_text ?? '');
  const [subtitle, setSubtitle] = useState(current?.lower_third_subtext ?? '');

  useEffect(() => {
    setTitle(current?.lower_third_text ?? '');
    setSubtitle(current?.lower_third_subtext ?? '');
  }, [current?.lower_third_text, current?.lower_third_subtext]);

  return (
    <div className="flex flex-col gap-2">
      <input
        className="px-3 py-2 bg-background border border-border rounded-sm text-sm"
        placeholder="Headline (e.g., Player of the Game)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="px-3 py-2 bg-background border border-border rounded-sm text-sm"
        placeholder="Subtitle"
        value={subtitle}
        onChange={(e) => setSubtitle(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="px-4 py-2 bg-primary text-primary-foreground rounded-sm text-sm font-bold"
          onClick={async () => {
            await patchOverlay(gameId, {
              lower_third_text: title || null,
              lower_third_subtext: subtitle || null,
              show_lower_third: true,
            });
            onRefresh();
            toast.success('Lower third shown');
          }}
        >
          Show
        </button>
        <button
          className="px-4 py-2 border border-border rounded-sm text-sm"
          onClick={async () => {
            await patchOverlay(gameId, { show_lower_third: false });
            onRefresh();
            toast.success('Hidden');
          }}
        >
          Hide
        </button>
      </div>
    </div>
  );
}

function ObsButton({
  kind,
  label,
  gameId,
  payload,
}: {
  kind: string;
  label: string;
  gameId: string;
  payload?: Record<string, unknown>;
}) {
  return (
    <button
      className="px-3 py-2 border border-border rounded-sm text-sm hover:bg-secondary"
      onClick={async () => {
        try {
          await enqueueObsCommand({ kind, payload, game_id: gameId });
          toast.success(`Queued: ${label}`);
        } catch (err) {
          toast.error(`${label}: ${(err as Error).message}`);
        }
      }}
    >
      {label}
    </button>
  );
}
