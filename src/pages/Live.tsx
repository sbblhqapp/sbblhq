import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { Navigate } from 'react-router-dom';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '@/contexts/AppContext';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useBag } from '@/contexts/BagContext';
import { useAuth } from '@/hooks/use-auth';
import { getSupabaseClient } from '@/lib/supabase/client';
import { useLiveAccess } from '@/hooks/useLiveAccess';
import { apiFetch, getAuthToken } from '@/lib/api/client';
import { LiveStreamPlayer } from '@/components/LiveStreamPlayer';
import { PaywallGate } from '@/components/live/PaywallGate';
import { PlayerErrorBoundary } from '@/components/PlayerErrorBoundary';
import { ViewerPreflight } from '@/components/preflight/ViewerPreflight';
import { TokenWalletBadge } from '@/components/tokens/TokenWalletBadge';
import { TokenPurchaseModal } from '@/components/tokens/TokenPurchaseModal';
import { TokenAwardPanel, type AwardablePlayer } from '@/components/tokens/TokenAwardPanel';
import { TokenLeaderboard } from '@/components/tokens/TokenLeaderboard';
import { BiometricDualOverlay } from '@/components/biometrics/BiometricDualOverlay';
import { MicUpIntroSting } from '@/components/micup/MicUpIntroSting';
import { MicUpLowerThird } from '@/components/micup/MicUpLowerThird';
import { TrashTalkBanner } from '@/components/micup/TrashTalkBanner';
import CheerMeter from '@/components/CheerMeter';
import { CASLNudge } from '@/components/CASLNudge';
import { fetchPublicHome } from '@/lib/api/public';
import { fetchPreflightSnapshot } from '@/lib/api/preflight';
import { isBiometricOverlayEnabled, isFanTokenSystemEnabled, isMicUpSeriesEnabled, isViewerPreflightEnabled } from '@/lib/feature-flags';
import { fetchLatestBiometrics } from '@/lib/api/biometrics';
import { fetchLeaderboardByGame, fetchTokenCategories, fetchTokenProducts, fetchTokenWallet, startTokenPurchase, awardTokens } from '@/lib/api/tokens';
import { useTokenLeaderboardRealtime } from '@/hooks/useTokenLeaderboardRealtime';
import { useBiometricRealtime } from '@/hooks/useBiometricRealtime';
import {
  fetchAdminStreamConfig,
  fetchPublicStreamStatus,
  fetchStreamComments,
  generateCompCode,
  goLive,
  moderateStreamComment,
  postStreamComment,
  resetStreamReactions,
  setStreamLive,
  updateStreamConfig,
} from '@/lib/api/stream';
import { detectStreamUrlType, getStreamTypeAdvisory, STREAM_TYPE_LABELS, toPlayableUrl } from '@/lib/stream/url-detector';
import { useWhipIngest } from '@/hooks/use-whip-ingest';
import {
  MessageSquare, Share2, Scissors, ShoppingBag, Check,
  ChevronLeft, ChevronRight, Tag,
  Radio, Eye, DollarSign, Settings, X, Ticket, Copy,
  Upload, Wifi, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Game, PlayerProfile, Product } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────
const LEAGUE_IDS = ['sbbl', 'wbl', 'tgifbl'];

interface LeaderboardLeader {
  id: string;
  name: string;
  avatar: string | null;
  position: string;
  pts: number;
  league_id: string;
}

function mapHomeGameToUi(row: Record<string, unknown>): Game {
  const homeTeam = (row.home_team as Record<string, unknown> | null) ?? {};
  const awayTeam = (row.away_team as Record<string, unknown> | null) ?? {};
  const leagueCode = String(row.league_code ?? 'SBBL').toLowerCase();
  const leagueId = leagueCode === 'wbl' ? 'wbl' : leagueCode === 'tgifbl' ? 'tgifbl' : 'sbbl';
  return {
    id: String(row.id),
    leagueId,
    homeTeam: { id: String(row.home_team_id ?? 'home'), name: String(homeTeam.name ?? 'Home'), leagueId, division: 'N/A', record: { wins: 0, losses: 0 } },
    awayTeam: { id: String(row.away_team_id ?? 'away'), name: String(awayTeam.name ?? 'Away'), leagueId, division: 'N/A', record: { wins: 0, losses: 0 } },
    venue: String(row.venue ?? 'TBA'),
    court: String(row.court ?? 'Main Court'),
    date: String(row.scheduled_at ?? ''),
    time: String(row.scheduled_at ?? ''),
    status: String(row.status ?? 'upcoming') as Game['status'],
    score: { home: Number(row.home_score ?? 0), away: Number(row.away_score ?? 0) },
    ppvPrice: 3.99,
  };
}

// ── Admin Stream Overlay ──────────────────────────────────────────────────
// Single source of truth for stream management. Renders as a gear-icon
// dropdown overlay on the video wrapper — no duplicate controls anywhere.
// Visible only to super_admin.
function AdminStreamOverlay({
  isLive, setIsLive,
  streamTitle, setStreamTitle,
  viewerCount,
  customStreamUrl, setCustomStreamUrl,
  activeGameId,
  onGoLive,
}: {
  isLive: boolean;
  setIsLive: (v: boolean) => void;
  streamTitle: string;
  setStreamTitle: (v: string) => void;
  viewerCount: number;
  customStreamUrl: string;
  setCustomStreamUrl: (v: string) => void;
  activeGameId: string | null;
  /** Called after each successful Go Live / End Stream save — parent uses this
   *  to increment a key that forces the player to remount and re-fetch the
   *  newly saved stream URL from the database. */
  onGoLive?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [compNote, setCompNote] = useState('');
  const [compHours, setCompHours] = useState('24');
  const [compGenerating, setCompGenerating] = useState(false);
  const [compCode, setCompCode] = useState<string | null>(null);
  const [compExpiresAt, setCompExpiresAt] = useState<string | null>(null);
  const [compCopied, setCompCopied] = useState(false);
  const [streamUrlError, setStreamUrlError] = useState<string | null>(null);
  const [urlTypeAdvisory, setUrlTypeAdvisory] = useState<string | null>(null);
  // Local file preview state. Creating a blob: URL lets the admin instantly
  // review any highlight clip before Go Live. The preview URL is what drops
  // into the Stream URL input; on save, the admin either points viewers at
  // the same CDN-hosted file OR starts WHIP ingest to fan the preview out
  // as a live broadcast.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewBlobRef = useRef<string | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  // WHIP broadcast: capture the previewed local file (or webcam) and push
  // to MediaMTX which re-emits as WHEP. Admin clicks Broadcast to start;
  // the hook tears down peer connection + releases the resource on stop.
  const [broadcastStream, setBroadcastStream] = useState<MediaStream | null>(null);
  const [broadcastSource, setBroadcastSource] = useState<'file' | 'camera' | null>(null);
  const whipEndpoint = broadcastStream
    ? `https://stream.sbbl-hq.icu/whip/${activeGameId ?? 'broadcast'}`
    : null;
  const whip = useWhipIngest({ whipUrl: whipEndpoint, stream: broadcastStream });

  const handleLoadLocalFile = () => fileInputRef.current?.click();

  const handleLocalFileChange = (evt: React.ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    // Revoke the previous blob URL to prevent memory pressure on repeated
    // selections — browsers keep the backing file pinned until revoke.
    if (previewBlobRef.current) {
      URL.revokeObjectURL(previewBlobRef.current);
      previewBlobRef.current = null;
    }
    const blobUrl = URL.createObjectURL(file);
    previewBlobRef.current = blobUrl;
    setLocalFileName(file.name);
    setCustomStreamUrl(blobUrl);
    setUrlTypeAdvisory(getStreamTypeAdvisory(detectStreamUrlType(blobUrl)).message || null);
    if (streamUrlError) setStreamUrlError(null);
    // Reset the input so selecting the same file again still fires change.
    evt.target.value = '';
  };

  const handleStopBroadcast = useCallback(async () => {
    await whip.stop();
    if (broadcastStream) {
      broadcastStream.getTracks().forEach((t) => t.stop());
    }
    setBroadcastStream(null);
    setBroadcastSource(null);
  }, [broadcastStream, whip]);

  const handleStartFileBroadcast = async () => {
    if (broadcastStream) {
      await handleStopBroadcast();
      return;
    }
    const video = previewVideoRef.current;
    if (!video) {
      toast.error('Load a local file first, then press Broadcast.');
      return;
    }
    try {
      // captureStream() returns a MediaStream piped from the playing video.
      // This is the one call that turns a local file into a broadcastable
      // live stream — MediaMTX re-emits the WebRTC frames as WHEP so every
      // viewer sees the same timeline as the admin.
      const candidate = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
      };
      const capture = candidate.captureStream ?? candidate.mozCaptureStream;
      if (!capture) throw new Error('captureStream_unsupported');
      const ms = capture.call(video);
      if (!ms || ms.getTracks().length === 0) throw new Error('no_tracks');
      try {
        await video.play();
      } catch {
        /* autoplay restrictions — muted playback should still capture */
      }
      setBroadcastStream(ms);
      setBroadcastSource('file');
      toast.success('WHIP ingest starting — viewers will see this clip live.');
    } catch (err) {
      toast.error(`Cannot start broadcast: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStartCameraBroadcast = async () => {
    if (broadcastStream) {
      await handleStopBroadcast();
      return;
    }
    try {
      const ms = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: true,
      });
      setBroadcastStream(ms);
      setBroadcastSource('camera');
      toast.success('WHIP ingest starting — you are live from this camera.');
    } catch (err) {
      toast.error(`Camera access denied: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Revoke any pending blob URL on unmount.
  useEffect(() => () => {
    if (previewBlobRef.current) URL.revokeObjectURL(previewBlobRef.current);
  }, []);

  // Auto-stop broadcast when the component closes / unmounts.
  useEffect(() => () => {
    if (broadcastStream) broadcastStream.getTracks().forEach((t) => t.stop());
  }, [broadcastStream]);

  const handleGenerateCompCode = async () => {
    const gameId = activeGameId ?? 'broadcast';
    setCompGenerating(true);
    try {
      const token = await getAuthToken();
      const hours = Number(compHours);
      const expiresInHours = Number.isFinite(hours) && hours > 0 ? Math.min(168, hours) : 24;
      const res = await generateCompCode(
        gameId,
        token,
        { note: compNote.trim() || undefined, expiresInHours },
      );
      if (res.ok) {
        setCompCode(res.code);
        setCompExpiresAt(res.expiresAt);
        toast.success('Comp access code generated');
      }
    } catch (err) {
      toast.error(`Could not generate comp code: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCompGenerating(false);
    }
  };

  const handleCopyCompCode = async () => {
    if (!compCode) return;
    await navigator.clipboard.writeText(compCode);
    setCompCopied(true);
    setTimeout(() => setCompCopied(false), 2500);
    toast.success('Comp code copied to clipboard');
  };

  const handleResetCompCode = () => {
    setCompCode(null);
    setCompExpiresAt(null);
    setCompNote('');
    setCompCopied(false);
  };

  const handleGoLive = async () => {
    const nextLive = !isLive;
    const trimmedUrl = customStreamUrl.trim();
    if (streamUrlError) setStreamUrlError(null);
    // Normalize YouTube short URLs to canonical watch URL before persisting
    const normalizedUrl = trimmedUrl ? (toPlayableUrl(trimmedUrl).url || trimmedUrl) : trimmedUrl;
    setSaving(true);
    try {
      const token = await getAuthToken();
      let atomicSuccess = false;
      // RC-6: Try atomic go-live endpoint first
      try {
        const goLivePayload = activeGameId
          ? { isLive: nextLive, collectionId: normalizedUrl, title: streamTitle, activeGameId }
          : { isLive: nextLive, collectionId: normalizedUrl, title: streamTitle, activeGameId: null };
        const res = await goLive(goLivePayload, token);
        if (res.ok) {
          atomicSuccess = true;
          setIsLive(nextLive);
          // Nonce only increments on confirmed DB commit
          onGoLive?.();
          toast.success(nextLive ? 'Stream is LIVE' : 'Stream ended');
          if (nextLive) setOpen(false);
        // Sync stream_sessions + stream_sources so non-admin RLS queries resolve.
        // This is additive — it runs after the primary stream_admin_config write.
        // Non-fatal: a failure here does not roll back the go-live action.
        try {
          const supabase = getSupabaseClient();
          if (supabase) {
            await supabase.rpc('admin_sync_broadcast_to_sessions', {
              p_game_id:       activeGameId ?? null,
              p_stream_url:    nextLive ? (normalizedUrl || null) : null,
              p_is_going_live: nextLive,
            });
          }
        } catch {
          // Non-fatal: primary broadcast state already saved above.
        }

        }
      } catch {
        // Atomic endpoint not yet deployed — fall back to sequential calls
      }

      if (!atomicSuccess) {
        // Fallback: sequential calls with 500ms delay before nonce increment
        await updateStreamConfig({ collectionId: normalizedUrl, title: streamTitle }, token);
        try {
          await setStreamLive(nextLive, token);
        } catch (liveErr) {
          toast.error(`Config saved, but live toggle failed: ${liveErr instanceof Error ? liveErr.message : String(liveErr)}. Try again.`);
          setSaving(false);
          return;
        }
        setIsLive(nextLive);
        // RC-6: 500ms delay before nonce increment to let the DB commit settle
        setTimeout(() => { onGoLive?.(); }, 500);
        toast.success(nextLive ? 'Stream is LIVE' : 'Stream ended');
        if (nextLive) setOpen(false);
        // Sync stream_sessions + stream_sources so non-admin RLS queries resolve.
        // This is additive — it runs after the primary stream_admin_config write.
        // Non-fatal: a failure here does not roll back the go-live action.
        try {
          const supabase = getSupabaseClient();
          if (supabase) {
            await supabase.rpc('admin_sync_broadcast_to_sessions', {
              p_game_id:       activeGameId ?? null,
              p_stream_url:    nextLive ? (normalizedUrl || null) : null,
              p_is_going_live: nextLive,
            });
          }
        } catch {
          // Non-fatal: primary broadcast state already saved above.
        }

      }
    } catch (err) {
      toast.error(`Failed to save config: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Gear button — always visible in top-left of video wrapper */}
      <button
        onClick={() => setOpen(o => !o)}
        className="absolute top-3 left-3 z-30 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center hover:bg-black/80 transition-colors group"
        title="Stream controls"
      >
        <Settings className={`w-4.5 h-4.5 text-white/80 group-hover:text-white transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {/* Live badge — top-right */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm ${
          isLive ? 'bg-red-600/90 text-white' : 'bg-black/60 text-white/70'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-white animate-pulse' : 'bg-white/50'}`} />
          {isLive ? 'Live' : 'Offline'}
        </span>
        {viewerCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold bg-black/60 text-white/80 backdrop-blur-sm">
            <Eye className="w-3 h-3" /> {viewerCount}
          </span>
        )}
      </div>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-14 left-3 z-30 w-80 max-w-[calc(100%-24px)] max-h-[calc(100%-70px)] overflow-y-auto bg-black/90 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="font-display font-bold text-xs uppercase tracking-wider text-white/90">Broadcast Controls</span>
            <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-1.5 bg-white/5 rounded">
                <Radio className={`w-3 h-3 mx-auto mb-0.5 ${isLive ? 'text-red-400' : 'text-white/40'}`} />
                <p className="stat-numeral text-xs text-white/90">{isLive ? 'LIVE' : 'OFF'}</p>
              </div>
              <div className="text-center p-1.5 bg-white/5 rounded">
                <Eye className="w-3 h-3 mx-auto mb-0.5 text-white/40" />
                <p className="stat-numeral text-xs text-white/90">{viewerCount}</p>
              </div>
              <div className="text-center p-1.5 bg-white/5 rounded">
                <DollarSign className="w-3 h-3 mx-auto mb-0.5 text-white/40" />
                <p className="stat-numeral text-xs text-white/90">$0</p>
              </div>
            </div>

            {/* Stream URL */}
            <div>
              <label className="text-[9px] uppercase tracking-wider text-white/50 block mb-1">Stream URL</label>
              <div className="relative">
                <input
                  type="text"
                  value={customStreamUrl}
                  onChange={e => {
                    const val = e.target.value;
                    setCustomStreamUrl(val);
                    if (streamUrlError) setStreamUrlError(null);
                    // URL type detection + centralized advisory
                    if (val.trim()) {
                      const advisory = getStreamTypeAdvisory(detectStreamUrlType(val.trim()));
                      setUrlTypeAdvisory(advisory.message || null);
                    } else {
                      setUrlTypeAdvisory(null);
                    }
                  }}
                  className="w-full bg-white/10 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-primary/50 pr-16"
                  placeholder="Paste any link — Twitch, YouTube, HLS, WHEP, MP4, or drag a local video…"
                />
                {customStreamUrl.trim() && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/15 text-white/70 pointer-events-none">
                    {STREAM_TYPE_LABELS[detectStreamUrlType(customStreamUrl.trim())]}
                  </span>
                )}
              </div>
              {streamUrlError && (
                <p className="mt-1 text-[10px] text-red-300">{streamUrlError}</p>
              )}
              {urlTypeAdvisory && !streamUrlError && (() => {
                const advisory = getStreamTypeAdvisory(detectStreamUrlType(customStreamUrl.trim()));
                return (
                  <p className={`mt-1 text-[10px] leading-relaxed ${
                    advisory.level === 'warn' ? 'text-amber-400' : 'text-white/50'
                  }`}>{urlTypeAdvisory}</p>
                );
              })()}
              {/* Local file loader + hidden <input type="file"> + offscreen
                  preview video element. The video element must be mounted so
                  the DOM has something to attach the blob: src to and so that
                  captureStream() has a live frame source when Broadcast starts.
                  opacity/height keeps it invisible without removing it from
                  the render tree (otherwise captureStream() fires on nothing). */}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLoadLocalFile}
                  className="text-[10px] inline-flex items-center gap-1 px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-white/80 border border-white/10"
                  title="Load a local highlight clip (plays instantly; viewers see it only after Broadcast)"
                >
                  <Upload className="w-3 h-3" /> Load Local File
                </button>
                {localFileName && (
                  <span className="text-[10px] text-white/50 truncate max-w-[180px]">{localFileName}</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleLocalFileChange}
                className="hidden"
              />
              {customStreamUrl.startsWith('blob:') && (
                <video
                  ref={previewVideoRef}
                  src={customStreamUrl}
                  controls
                  muted
                  playsInline
                  className="mt-2 w-full rounded border border-white/10 bg-black"
                  style={{ maxHeight: 140 }}
                />
              )}
            </div>

            {/* WHIP Broadcast — publish the current source to MediaMTX so all
                viewers see it via WHEP. Two flows: local-file broadcast (uses
                captureStream() on the preview video) and camera broadcast
                (uses getUserMedia). The single "Stop" button tears both down
                plus DELETEs the WHIP resource. */}
            <div className="rounded border border-white/10 bg-white/5 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-wider text-white/60 inline-flex items-center gap-1">
                  <Wifi className="w-3 h-3" /> WHIP Broadcast
                </span>
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    whip.status === 'publishing'
                      ? 'bg-red-500/20 text-red-300'
                      : whip.status === 'connecting'
                        ? 'bg-amber-500/20 text-amber-300'
                        : whip.status === 'error'
                          ? 'bg-red-900/40 text-red-200'
                          : 'bg-white/10 text-white/50'
                  }`}
                >
                  {whip.status}
                </span>
              </div>
              {broadcastStream ? (
                <button
                  type="button"
                  onClick={() => { void handleStopBroadcast(); }}
                  className="w-full py-1.5 font-display font-bold text-[10px] uppercase tracking-wider rounded bg-red-600 text-white hover:bg-red-500"
                >
                  Stop Broadcast ({broadcastSource})
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleStartFileBroadcast(); }}
                    disabled={!customStreamUrl.startsWith('blob:')}
                    className="py-1.5 font-display font-bold text-[10px] uppercase tracking-wider rounded bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-30"
                    title="Push the loaded local file to viewers"
                  >
                    Broadcast File
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleStartCameraBroadcast(); }}
                    className="py-1.5 font-display font-bold text-[10px] uppercase tracking-wider rounded bg-white/10 text-white hover:bg-white/15 border border-white/10"
                    title="Publish your webcam + mic"
                  >
                    Broadcast Camera
                  </button>
                </div>
              )}
              {whip.error && (
                <p className="text-[10px] text-red-300 leading-relaxed">{whip.error}</p>
              )}
              <p className="text-[9px] text-white/40 leading-relaxed">
                Uses MediaMTX WHIP ingest — viewers auto-connect via WHEP. Paste
                <code className="mx-1 text-white/60">https://stream.sbbl-hq.icu/whep/{activeGameId ?? 'broadcast'}</code>
                into Stream URL once publishing to gate access.
              </p>
              <p className="text-[11px] text-muted-foreground" data-testid="broadcast-only-mode-copy">
                {activeGameId ? 'Game-bound PPV mode selected.' : 'Broadcast-only / no bound game — owner go-live will use activeGameId null.'}
              </p>
            </div>

            {/* Stream Title */}
            <div>
              <label className="text-[9px] uppercase tracking-wider text-white/50 block mb-1">Broadcast Title</label>
              <input
                type="text"
                value={streamTitle}
                onChange={e => setStreamTitle(e.target.value)}
                className="w-full bg-white/10 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-primary/50"
                placeholder="e.g. SBBL Finals Game 3"
              />
            </div>

            {/* Non-blocking broadcast readiness checklist (alert-only). */}
            <div className="rounded border border-white/10 bg-white/5 p-2.5 space-y-1.5">
              <p className="text-[9px] uppercase tracking-wider text-white/60">Broadcast Alerts (Never Blocking)</p>
              <p className={`text-[10px] ${customStreamUrl.trim() ? 'text-emerald-300' : 'text-amber-300'}`}>
                {customStreamUrl.trim() ? '✓ Stream link is configured' : '⚠ Add a stream link for immediate playback'}
              </p>
              <p className={`text-[10px] ${isLive ? 'text-emerald-300' : 'text-white/60'}`}>
                {isLive ? '✓ Broadcast is currently live' : '• Broadcast remains offline until owner presses Go Live'}
              </p>
              <p className={`text-[10px] ${viewerCount > 0 ? 'text-emerald-300' : 'text-white/60'}`}>
                {viewerCount > 0 ? `✓ ${viewerCount} active viewers detected` : '• No active viewers yet'}
              </p>
            </div>

            {/* Go Live / End Stream control. Alerts above are advisory only. */}
            <button
              onClick={handleGoLive}
              disabled={saving}
              className={`w-full py-2.5 font-display font-bold text-xs uppercase tracking-wider rounded transition-colors disabled:opacity-40 ${
                isLive
                  ? 'bg-red-600 text-white hover:bg-red-500'
                  : 'bg-green-600 text-white hover:bg-green-500'
              }`}
            >
              {saving ? 'Saving…' : isLive ? 'End Stream' : 'Go Live'}
            </button>

            {/* ── Comp Access Code Generator ──────────────────────────────
                Super-admin-only widget. Generates an unlimited, single-use,
                IP-locked access code. Redeemer gets the same 6-hour capped,
                one-device-enforced session as a paid PPV purchase. */}
            <div className="border-t border-white/10 pt-3 mt-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] uppercase tracking-wider text-white/50 flex items-center gap-1.5">
                  <Ticket className="w-3 h-3" /> Comp Access Code
                </span>
                {compCode && (
                  <button
                    onClick={handleResetCompCode}
                    className="text-[9px] uppercase tracking-wider text-white/40 hover:text-white/70"
                    title="Generate another"
                  >
                    New
                  </button>
                )}
              </div>

              {compCode ? (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-[11px] text-amber-300 break-all leading-tight">
                      {compCode}
                    </code>
                    <button
                      onClick={handleCopyCompCode}
                      className="p-1.5 rounded hover:bg-white/10 transition-colors shrink-0"
                      title="Copy code"
                      aria-label="Copy comp code"
                    >
                      {compCopied
                        ? <Check className="w-3.5 h-3.5 text-green-400" />
                        : <Copy className="w-3.5 h-3.5 text-white/70" />}
                    </button>
                  </div>
                  {compExpiresAt && (
                    <p className="text-[9px] text-white/50">
                      Redeemable until {new Date(compExpiresAt).toLocaleString()} ·
                      6h session cap · one-device · IP-locked
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={compNote}
                    onChange={e => setCompNote(e.target.value)}
                    maxLength={200}
                    className="w-full bg-white/10 border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50 mb-2"
                    placeholder="Note (optional) — e.g. 'Comped for J. Smith'"
                  />
                  <div className="flex gap-2 mb-2">
                    <label className="text-[9px] uppercase tracking-wider text-white/40 flex items-center gap-1.5 flex-1">
                      Expires in
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={compHours}
                        onChange={e => setCompHours(e.target.value)}
                        className="flex-1 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/50"
                      />
                      hrs
                    </label>
                  </div>
                  <button
                    onClick={handleGenerateCompCode}
                    disabled={compGenerating}
                    className="w-full py-2 font-display font-bold text-[11px] uppercase tracking-wider rounded bg-amber-500 text-black hover:bg-amber-400 transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                  >
                    <Ticket className="w-3 h-3" />
                    {compGenerating ? 'Generating…' : 'Generate Comp Code'}
                  </button>
                  <p className="text-[9px] text-white/40 mt-1.5 leading-relaxed">
                    Single-use · IP-locked · 6h session · one-device
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Live Page Skeleton ────────────────────────────────────────────────────
// Shown while useAuth() resolves on cold load. Mirrors the page layout so
// there is no layout shift when real content mounts.
function LivePageSkeleton() {
  return (
    <div className="min-h-screen">
      <div className="lg:container lg:py-4">
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">
          <div className="lg:col-span-2 flex flex-col">
            {/* Video area */}
            <div className="aspect-video bg-muted animate-pulse lg:rounded-sm" />
            <div className="container lg:px-0 py-4 space-y-3">
              {/* Reaction bar */}
              <div className="h-9 bg-muted animate-pulse rounded" />
              {/* Chat panel */}
              <div className="h-64 bg-muted animate-pulse rounded" />
            </div>
          </div>
          <div className="hidden lg:block space-y-4">
            {/* Sidebar panels */}
            <div className="aspect-square bg-muted animate-pulse rounded" />
            <div className="h-48 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Live Page ─────────────────────────────────────────────────────────
const LivePage = () => {
  const { hasPremiumPlayerAccess } = useApp();
  const { addToBag } = useBag();

  // --- Top Performers Carousel Logic ---

  const [activeLeagueIdx, setActiveLeagueIdx] = useState(0);
  // leagueIds is moved outside to avoid dependency array issues

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveLeagueIdx((prev) => (prev + 1) % LEAGUE_IDS.length);
    }, 60000); // 60 seconds
    return () => clearInterval(interval);
  }, []);

  const {
    data: leaderboardsData = [],
    isLoading: performersLoading,
    isError: performersError,
  } = useQuery({
    queryKey: ['public-leaderboards', LEAGUE_IDS[activeLeagueIdx]],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('get_leaderboards', { p_filters: { league: LEAGUE_IDS[activeLeagueIdx] } });
      if (error) throw new Error(error.message);
      return (data as { leaders?: LeaderboardLeader[] } | null)?.leaders ?? [];
    },
    staleTime: 1000 * 60 * 5, // 5 min
    retry: 1,
  });

  const topPerformers = useMemo(() => {
    // leaderboardsData is already sorted by points descending from the RPC.
    return leaderboardsData.slice(0, 3).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar, // the RPC does not currently return avatar_url, but we map what we have or let fallback handle it
      position: p.position || 'N/A',
      pts: p.pts || 0,
      league_id: p.league_id,
    }));
  }, [leaderboardsData]);

  const { user, session, roles, needsOnboarding, loading: authLoading } = useAuth();
  const { access, config: liveAccessConfig } = useLiveAccess();
  const isSuperAdmin = roles.includes('super_admin');
  const canModerateLive = roles.includes('super_admin') || roles.includes('league_admin');
  // Any privileged role (roster player, paid fan, or super admin) gets the
  // camera-only broadcast fallback when the admin has flipped the stream live
  // but no real live game row exists yet. Non-privileged fans still need a
  // real game + PPV entitlement.
  const hasPrivilegedBroadcastAccess =
    roles.includes('player') || roles.includes('paid_fan') || isSuperAdmin;
  const hasBroadcastFallbackAccess = hasPrivilegedBroadcastAccess || access === 'paid';
  const [liveGame, setLiveGame] = useState<Game | null>(null);
  // Incremented each time the admin saves a Go Live / End Stream action.
  // Used as React key on PlayerErrorBoundary to force a fresh session fetch
  // so the player picks up the newly saved stream URL without a full reload.
  const [streamNonce, setStreamNonce] = useState(0);

  // Admin stream state — fetched from backend (single source of truth)
  const [isStreamLive, setIsStreamLive] = useState(false);
  const [streamTitle, setStreamTitle] = useState('Live Game Broadcast');
  const [viewerCount, setViewerCount] = useState(0);
  const [customStreamUrl, setCustomStreamUrl] = useState('');
  const [activeGameId, setActiveGameId] = useState<string | null>(null);

  // FIX #2: Track whether the initial poll has completed and whether it errored.
  // initialPollDone prevents the page from showing content before the first
  // fetch attempt resolves. initialPollError surfaces a toast so the viewer
  // knows the page failed to load live status rather than silently sitting
  // on the empty state indefinitely.
  const [initialPollDone, setInitialPollDone] = useState(false);
  const [initialPollError, setInitialPollError] = useState(false);

  // ── Broadcast oracle (non-admin path) ──────────────────────────────────────
  // get_active_broadcast() resolves all paywall signals server-side.
  // stream_url is withheld for unpermitted users — no client-side-only guard.
  // Admin users skip this and use fetchAdminStreamConfig directly.
  const broadcastQuery = useQuery({
    queryKey: ['get-active-broadcast', streamNonce],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('supabase_client_unavailable');
      }
      const { data, error } = await supabase.rpc('get_active_broadcast');
      if (error) throw new Error(error.message);
      return data as {
        is_live: boolean;
        stream_url: string | null;
        title: string | null;
        active_game_id: string | null;
        live_started_at: string | null;
        requires_payment: boolean;
        is_subscribed: boolean;
        has_entitlement: boolean;
        user_registered: boolean;
      } | null;
    },
    enabled: !isSuperAdmin,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const broadcast = broadcastQuery.data ?? null;
  const broadcastOracleBroken = !isSuperAdmin && broadcastQuery.isError;

  const handleBroadcastRefetch = () => {
    setStreamNonce(n => n + 1);
  };

  // Auto-sync stream status from backend
  useEffect(() => {
    let active = true;
    let isFirstFetch = true;
    const fetchStatus = async () => {
      try {
        const home = await fetchPublicHome();
        const liveRows = (home.data?.liveGames ?? []) as Array<Record<string, unknown>>;
        const upcomingRows = (home.data?.upcomingGames ?? []) as Array<Record<string, unknown>>;
        const selected = liveRows[0] ?? (!isSuperAdmin ? upcomingRows[0] : null) ?? null;
        if (active && selected) {
          setLiveGame(mapHomeGameToUi(selected));
          setActiveGameId(String(selected.id));
        }
        if (isSuperAdmin) {
          // Admin needs full config — pass null so apiFetch uses getAuthToken()
          // which auto-refreshes expired JWTs. Never pass an explicit token from
          // a React closure here; it goes stale and causes endless 401 loops.
          const res = await fetchAdminStreamConfig(null);
          if (active && res?.config) {
            setIsStreamLive(res.config.isLive);
            setStreamTitle(res.config.title);
            setCustomStreamUrl(res.config.collectionId || ''); // collectionId stores the stream URL
          }
        } else {
          // Public poller
          const res = await fetchPublicStreamStatus();
          if (active && res?.ok) {
            setIsStreamLive(Boolean(res.isLive));
            setStreamTitle(typeof res.title === 'string' ? res.title : 'Live Game Broadcast');
            setViewerCount(typeof res.viewerCount === 'number' && res.viewerCount >= 0 ? res.viewerCount : 0);
          }
        }
        // Mark initial poll done on first successful fetch
        if (active && isFirstFetch) {
          setInitialPollDone(true);
          isFirstFetch = false;
        }
      } catch {
        // Subsequent poll errors are non-fatal; next tick retries with a fresh token.
        // First-load error: surface a toast so the viewer knows something went wrong.
        if (active && isFirstFetch) {
          setInitialPollDone(true);
          setInitialPollError(true);
          isFirstFetch = false;
          toast.error('Could not load live status. Retrying…', { id: 'live-poll-error' });
        }
      }
    };

    void fetchStatus();
    // Poll every 15 seconds for viewers
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus();
      }
    }, 15000);
    return () => { active = false; clearInterval(id); };
  }, [isSuperAdmin]);

  // Clean up ?ppv=success from URL after Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ppv') === 'success') {
      window.history.replaceState({}, '', '/live');
    }
  }, []);

  const [comments, setComments] = useState<Array<{ id: string; user: string; text: string; status: 'active' | 'hidden' }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [preflightReady, setPreflightReady] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenBusyProductId, setTokenBusyProductId] = useState<string | null>(null);
  const [overlayLowerThird, setOverlayLowerThird] = useState<{ playerName: string; teamName?: string; statLine?: string } | null>(null);
  const [overlayTrashTalk, setOverlayTrashTalk] = useState<string | null>(null);

  // ── Real reactions (persisted + Realtime-broadcast) ──────────────────────
  const [reactions, setReactions] = useState({ fire: 0, heart: 0, clap: 0 });

  // Fetch initial counts whenever the active game is known.
  // Skip the 'broadcast' alias — it has no real game row in the DB so
  // reaction counts would always 404 / return empty.
  useEffect(() => {
    if (!activeGameId || activeGameId === 'broadcast') return;
    void apiFetch<{ ok: boolean; fire: number; heart: number; clap: number }>(
      `/api/streams/${activeGameId}/reactions`,
    ).then(data => {
      if (data.ok) setReactions({ fire: data.fire, heart: data.heart, clap: data.clap });
    }).catch(() => {});
  }, [activeGameId]);

  // Subscribe to Supabase Realtime — broadcast every new reaction to all viewers.
  // Skip the 'broadcast' alias for the same reason as above.
  useEffect(() => {
    if (!activeGameId || activeGameId === 'broadcast') return;
    const client = getSupabaseClient();
    if (!client) return;

    const channel = client
      .channel(`stream-reactions-${activeGameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'stream_reactions', filter: `game_id=eq.${activeGameId}` },
        (payload) => {
          const type = (payload.new as { reaction_type: string }).reaction_type as 'fire' | 'heart' | 'clap';
          if (['fire', 'heart', 'clap'].includes(type)) {
            setReactions(r => ({ ...r, [type]: r[type] + 1 }));
          }
        },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [activeGameId]);

  const postReaction = useCallback(async (type: 'fire' | 'heart' | 'clap') => {
    // Optimistic update immediately
    setReactions(r => ({ ...r, [type]: r[type] + 1 }));
    // Persist to DB (auth required; skip for broadcast alias which has no DB row)
    if (!user?.id || !activeGameId || activeGameId === 'broadcast' || !session) return;
    try {
      await apiFetch(`/api/streams/${activeGameId}/react`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
    } catch {
      // non-critical — optimistic update already applied
    }
  }, [activeGameId, user?.id, session]);

  const serverGrantedBroadcastAccess = Boolean(broadcast?.stream_url);
  const fallbackBroadcastGame = useMemo<Game | null>(() => {
    // Universal live playback contract: when the broadcast oracle grants a
    // stream URL, playback uses the game-agnostic broadcast session. Score rows
    // and optional active_game_id are metadata only and must not re-route the
    // viewer into stricter game-specific PPV/session paths.
    if (!(hasBroadcastFallbackAccess || serverGrantedBroadcastAccess) || !isStreamLive) return null;
    return {
      id: 'broadcast',
      leagueId: 'sbbl',
      homeTeam: { id: 'broadcast-home', name: 'SBBL', leagueId: 'sbbl', division: 'N/A', record: { wins: 0, losses: 0 } },
      awayTeam: { id: 'broadcast-away', name: 'Live', leagueId: 'sbbl', division: 'N/A', record: { wins: 0, losses: 0 } },
      venue: 'SBBL HQ',
      court: 'Main Feed',
      date: new Date().toISOString(),
      time: new Date().toISOString(),
      status: 'live',
      score: { home: 0, away: 0 },
      ppvPrice: 0,
    };
  }, [hasBroadcastFallbackAccess, isStreamLive, serverGrantedBroadcastAccess]);
  const playerGame = useMemo<Game | null>(() => {
    // Server-granted broadcast access is universal: always use /api/broadcast/*
    // for playback and let liveGame continue to drive surrounding metadata.
    if (serverGrantedBroadcastAccess && fallbackBroadcastGame) return fallbackBroadcastGame;
    return liveGame ?? fallbackBroadcastGame;
  }, [fallbackBroadcastGame, liveGame, serverGrantedBroadcastAccess]);
  const showPreflight = isViewerPreflightEnabled() && !!activeGameId && activeGameId !== 'broadcast' && !serverGrantedBroadcastAccess && !preflightReady;
  const tokenEnabled = isFanTokenSystemEnabled();
  const biometricsEnabled = isBiometricOverlayEnabled();
  const micUpEnabled = isMicUpSeriesEnabled();
  const [clipSaved, setClipSaved] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const storeQuery = useQuery({
    queryKey: ['public-products'],
    queryFn: () => apiFetch<{ ok: boolean; data: Product[] }>('/api/public/products'),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const featuredProducts = useMemo<Product[]>(() => {
    const storeProducts = storeQuery.data?.data ?? [];
    return storeProducts.filter(p => p.badge === 'SALE');
  }, [storeQuery.data]);

  const [carouselIdx, setCarouselIdx] = useState(0);
  const carouselProduct = featuredProducts[carouselIdx] ?? featuredProducts[0];

  useEffect(() => {
    if (featuredProducts.length <= 1) return;
    const id = setInterval(() => setCarouselIdx(i => (i + 1) % featuredProducts.length), 4000);
    return () => clearInterval(id);
  }, [featuredProducts.length]);

  useEffect(() => {
    if (!liveGame?.id) return;
    let active = true;
    const fetchComments = async () => {
      try {
        const res = await fetchStreamComments(liveGame.id, 60, {
          includeHidden: canModerateLive,
          token: session?.access_token ?? null,
        });
        if (!active) return;
        setComments(res.comments.map((comment) => ({
          id: comment.id,
          user: comment.userDisplayName ?? 'Fan',
          text: comment.message,
          status: comment.status ?? 'active',
        })));
      } catch {
        // non-blocking for playback UX
      }
    };
    void fetchComments();

    // Realtime push for new chat messages + moderation updates.
    // The periodic refetch below is a 30 s correction pass, not a primary
    // delivery channel — instant messages arrive via this subscription.
    const client = getSupabaseClient();
    const channel = client
      ? client
          .channel(`stream-chat-${liveGame.id}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'stream_chat_messages',
              filter: `game_id=eq.${liveGame.id}`,
            },
            () => {
              if (!active) return;
              void fetchComments();
            },
          )
          .subscribe()
      : null;

    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchComments();
      }
    }, 30_000);
    return () => {
      active = false;
      clearInterval(id);
      if (channel) void client?.removeChannel(channel);
    };
  }, [canModerateLive, liveGame?.id, session?.access_token]);

  const handleShare = async () => {
    if (!liveGame) return;
    const shareData = {
      title: `${liveGame.homeTeam.name} vs ${liveGame.awayTeam.name} — Live on SBBL HQ`,
      text: `Watch the game live: ${liveGame.score?.home}–${liveGame.score?.away} in Q4`,
      url: window.location.href,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard');
    }
  };

  const handleClip = () => {
    setClipSaved(true);
    toast.success('Clip saved to your Media library');
    setTimeout(() => setClipSaved(false), 2500);
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text || !liveGame?.id || !session) return;
    void postStreamComment(liveGame.id, text, session.access_token ?? null)
      .then((res) => {
        setComments(prev => [...prev, {
          id: res.comment.id,
          user: 'You',
          text: res.comment.message,
          status: 'active',
        }]);
        setChatInput('');
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'chat_failed';
        if (message === 'rate_limited') {
          toast.error('Chat is rate-limited. Please slow down.');
        } else {
          toast.error('Could not send message.');
        }
      });
  };

  const handleModerateComment = (commentId: string, action: 'hide' | 'restore') => {
    if (!liveGame?.id || !session || !canModerateLive) return;
    void moderateStreamComment(liveGame.id, commentId, action, session.access_token ?? null)
      .then(() => {
        // Keep moderated rows visible to admins so they can restore in-place.
        setComments((prev) => prev.map((comment) => (
          comment.id === commentId
            ? { ...comment, status: action === 'hide' ? 'hidden' : 'active' }
            : comment
        )));
        toast.success(action === 'hide' ? 'Comment hidden' : 'Comment restored');
      })
      .catch(() => {
        toast.error('Could not moderate comment.');
      });
  };

  const handleResetReactions = () => {
    if (!activeGameId || !session || !canModerateLive) return;
    void resetStreamReactions(activeGameId, session.access_token ?? null)
      .then(() => {
        setReactions({ fire: 0, heart: 0, clap: 0 });
        toast.success('Reactions reset');
      })
      .catch(() => {
        toast.error('Could not reset reactions.');
      });
  };

  const preflightQuery = useQuery({
    queryKey: ['preflight-snapshot', activeGameId],
    queryFn: () => fetchPreflightSnapshot(activeGameId as string),
    enabled: showPreflight,
    retry: 1,
  });

  const tokenWalletQuery = useQuery({
    queryKey: ['fan-token-wallet'],
    queryFn: fetchTokenWallet,
    enabled: tokenEnabled && !!session,
    retry: 1,
  });
  const tokenProductsQuery = useQuery({
    queryKey: ['fan-token-products'],
    queryFn: fetchTokenProducts,
    enabled: tokenEnabled,
    staleTime: 300_000,
  });
  const tokenCategoriesQuery = useQuery({
    queryKey: ['fan-token-categories'],
    queryFn: fetchTokenCategories,
    enabled: tokenEnabled,
    staleTime: 300_000,
  });
  const tokenLeaderboardQuery = useQuery({
    queryKey: ['fan-token-leaderboard', activeGameId],
    queryFn: () => fetchLeaderboardByGame(activeGameId as string),
    enabled: tokenEnabled && !!activeGameId && activeGameId !== 'broadcast',
    retry: 1,
  });
  const { entries: tokenEntries } = useTokenLeaderboardRealtime(activeGameId, tokenLeaderboardQuery.data ?? []);

  const biometricsQuery = useQuery({
    queryKey: ['biometric-latest', activeGameId],
    queryFn: () => fetchLatestBiometrics(activeGameId as string),
    enabled: biometricsEnabled && !!activeGameId && activeGameId !== 'broadcast',
    retry: 1,
  });
  const { snapshots: biometricSnapshots } = useBiometricRealtime(activeGameId, biometricsQuery.data ?? []);
  const awardablePlayers = useMemo<AwardablePlayer[]>(() => topPerformers.map((p) => ({
    id: p.id,
    displayName: p.name,
    avatarUrl: p.avatar,
    teamLabel: p.league_id.toUpperCase(),
  })), [topPerformers]);

  useEffect(() => {
    if (!micUpEnabled || !activeGameId || activeGameId === 'broadcast') return;
    const client = getSupabaseClient();
    if (!client) return;
    const channel = client
      .channel(`overlay:${activeGameId}`)
      .on('broadcast', { event: 'lower_third' }, (msg) => {
        const payload = (msg.payload ?? {}) as Record<string, unknown>;
        setOverlayLowerThird({
          playerName: String(payload.playerName ?? payload.player_name ?? 'MIC UP'),
          teamName: payload.teamName ? String(payload.teamName) : undefined,
          statLine: payload.statLine ? String(payload.statLine) : undefined,
        });
      })
      .on('broadcast', { event: 'trash_talk' }, (msg) => {
        const payload = (msg.payload ?? {}) as Record<string, unknown>;
        setOverlayTrashTalk(String(payload.label ?? 'TRASH TALK DETECTED'));
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeGameId, micUpEnabled]);

  const submitTokenAward = async (args: { recipientPlayerId: string; amount: number; categorySlug: string; idempotencyKey: string; }) => {
    if (!activeGameId || activeGameId === 'broadcast') throw new Error('No active game');
    await awardTokens({ ...args, gameId: activeGameId });
    await Promise.all([tokenWalletQuery.refetch(), tokenLeaderboardQuery.refetch()]);
  };

  // FIX #1: Show skeleton while auth is resolving to prevent flash of
  // "No Active Broadcast" before we know the user's role or stream state.
  // Priority: skeleton → onboarding redirect → full page.
  if (authLoading || !initialPollDone) {
    return <LivePageSkeleton />;
  }

  // Fan who registered but hasn't completed onboarding must finish it before
  // reaching the PPV paywall.
  if (!authLoading && needsOnboarding) {
    return <Navigate to='/onboarding?intent=fan&redirect=/live' replace />;
  }

  const sidebar = (
    <div className="space-y-4">
      {tokenEnabled && (
        <>
          <div className="panel p-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Fan Tokens</span>
            <TokenWalletBadge
              balance={tokenWalletQuery.data?.balance ?? 0}
              loading={tokenWalletQuery.isLoading}
              onClick={() => setTokenModalOpen(true)}
            />
          </div>
          <TokenAwardPanel
            players={awardablePlayers}
            categories={tokenCategoriesQuery.data ?? []}
            walletBalance={tokenWalletQuery.data?.balance ?? 0}
            busy={tokenWalletQuery.isFetching}
            onAward={submitTokenAward}
          />
          <TokenLeaderboard entries={tokenEntries} />
        </>
      )}
      {/* Featured Merch Carousel */}
      {featuredProducts.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="relative aspect-square overflow-hidden bg-secondary">
            <img
              key={carouselProduct.id}
              src={carouselProduct.image}
              alt={carouselProduct.name}
              width={512}
              height={512}
              className="w-full h-full object-contain"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
            <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 bg-primary text-primary-foreground text-[9px] font-bold uppercase tracking-wider rounded-sm">
              <Tag className="w-2.5 h-2.5" /> Sale
            </span>
            {featuredProducts.length > 1 && (
              <>
                <button
                  onClick={() => setCarouselIdx(i => (i - 1 + featuredProducts.length) % featuredProducts.length)}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-background/70 backdrop-blur-sm flex items-center justify-center hover:bg-background/90 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCarouselIdx(i => (i + 1) % featuredProducts.length)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-background/70 backdrop-blur-sm flex items-center justify-center hover:bg-background/90 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                  {featuredProducts.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setCarouselIdx(i)}
                      className={`h-1.5 rounded-full transition-all ${i === carouselIdx ? 'bg-primary w-3' : 'bg-foreground/30 w-1.5'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="p-4">
            <p className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold">Featured Merch · {carouselIdx + 1}/{featuredProducts.length}</p>
            <p className="font-display font-bold text-sm mt-1 truncate">{carouselProduct.name}</p>
            {carouselProduct.colors && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{carouselProduct.colors[0]}</p>
            )}
            <button
              onClick={() => addToBag(carouselProduct.id)}
              className="mt-3 w-full gold-bg py-2.5 font-display font-bold text-xs uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              {carouselProduct.price > 0 ? `Add to Bag — $${carouselProduct.price.toLocaleString()}` : 'Claim Reward'}
            </button>
          </div>
        </div>
      )}

      {/* Top Performers */}
      <div className="panel p-4">
        <h3 className="font-display font-bold text-sm mb-3">Top Performers</h3>
        {performersLoading ? (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : performersError ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Could not load top performers.</p>
        ) : topPerformers.length > 0 ? topPerformers.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
            <PlayerAvatar src={p.avatar} alt={p.name} className="w-8 h-8" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                 <p className="text-xs font-medium truncate">{p.name || 'Unknown Player'}</p>
                 <span className="text-[8px] px-1 py-0.5 rounded-sm bg-muted text-muted-foreground uppercase">{p.league_id}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">{p.position}</p>
            </div>
            <span className="stat-numeral text-sm text-primary">{p.pts ? p.pts.toFixed(1) : '0.0'} PTS</span>
          </div>
        )) : (
          <p className="text-xs text-muted-foreground py-4 text-center">No top performers yet.</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <div className="lg:container lg:py-4">
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">

          {/* LEFT: broadcast area + actions + chat */}
          <div className="lg:col-span-2 flex flex-col">

            {/* Broadcast Area — admin overlay + access-gate player */}
            <div className="relative aspect-video bg-muted overflow-hidden lg:rounded-sm">
              {/* Admin stream overlay — inside the video wrapper, super_admin only */}
              {isSuperAdmin && (
                  <AdminStreamOverlay
                    isLive={isStreamLive}
                    setIsLive={setIsStreamLive}
                    streamTitle={streamTitle}
                    setStreamTitle={setStreamTitle}
                    viewerCount={viewerCount}
                    customStreamUrl={customStreamUrl}
                    setCustomStreamUrl={setCustomStreamUrl}
                    activeGameId={activeGameId}
                    onGoLive={() => setStreamNonce(n => n + 1)}
                  />
                )}

              {showPreflight ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4">
                  <ViewerPreflight
                    title={streamTitle}
                    snapshot={preflightQuery.data ?? null}
                    snapshotError={(preflightQuery.error as Error | null) ?? null}
                    onRemediate={(result) => {
                      const action = result.remediation?.action;
                      if (action === 'sign_in') window.location.assign('/login?redirect=/live');
                      if (action === 'purchase_ppv' || action === 'buy_replay') window.location.assign('/billing?redirect=/live');
                      if (action === 'displace_session' || action === 'retry') window.location.reload();
                    }}
                    onReady={() => setPreflightReady(true)}
                    onRetry={() => void preflightQuery.refetch()}
                  />
                </div>
              ) : playerGame ? (
               <PlayerErrorBoundary key={streamNonce}>
                  <LiveStreamPlayer
                    game={playerGame}
                    userId={user?.id ?? null}
                    roles={roles}
                    hasPremiumPlayerAccess={hasPremiumPlayerAccess}
                    isStreamLive={isStreamLive}
                    serverGrantedAccess={serverGrantedBroadcastAccess}
                  />
              </PlayerErrorBoundary>
              ) : broadcastOracleBroken && !serverGrantedBroadcastAccess ? (
                <div data-testid="live-misconfigured" className="absolute inset-0 flex flex-col items-center justify-center text-center bg-black/80 px-6">
                  <div className="w-14 h-14 rounded-full bg-destructive/50 flex items-center justify-center mb-3">
                    <AlertTriangle className="w-6 h-6 text-destructive" />
                  </div>
                  <p className="text-sm text-red-400 font-medium">Live service unavailable</p>
                  <p className="text-xs text-white/40 mt-1">
                    The broadcast service could not be reached. Try again in a few minutes.
                  </p>
                  <button
                    type="button"
                    onClick={handleBroadcastRefetch}
                    className="mt-3 px-4 py-2 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : !isSuperAdmin && broadcast?.is_live && !broadcast?.stream_url ? (
                // Broadcast is live but user is not permitted server-side.
                // RULE 2: anon → register CTA.
                // RULE 5: registered non-subscriber → code + purchase panels.
                !user ? (
                  <PaywallGate
                    isAnon
                    title={broadcast.title}
                    isLive={broadcast.is_live}
                    onWatchClick={() => {
                      window.location.assign('/onboarding?intent=fan&redirect=/live');
                    }}
                  />
                ) : (
                  <PaywallGate
                    gameId={broadcast.active_game_id}
                    title={broadcast.title}
                    isLive={broadcast.is_live}
                    onSuccess={handleBroadcastRefetch}
                  />
                )
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-black/80 px-6">
                  <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mb-3">
                    <Radio className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-white/70 font-medium">No Active Broadcast</p>
                  <p className="text-xs text-white/40 mt-1">
                    {initialPollError
                      ? 'Could not reach the server. Retrying in the background…'
                      : 'Check back when a game is scheduled or a stream goes live.'}
                  </p>
                </div>
              )}
              {micUpEnabled && activeGameId && activeGameId !== 'broadcast' && (
                <MicUpIntroSting
                  gameId={activeGameId}
                  leftPlayerLabel={liveGame?.homeTeam.name ?? 'HOME'}
                  rightPlayerLabel={liveGame?.awayTeam.name ?? 'AWAY'}
                />
              )}
              {overlayLowerThird && (
                <MicUpLowerThird
                  playerName={overlayLowerThird.playerName}
                  teamName={overlayLowerThird.teamName}
                  statLine={overlayLowerThird.statLine}
                  onDismiss={() => setOverlayLowerThird(null)}
                />
              )}
              {overlayTrashTalk && (
                <TrashTalkBanner
                  label={overlayTrashTalk}
                  onDismiss={() => setOverlayTrashTalk(null)}
                />
              )}
              {biometricsEnabled && activeGameId && activeGameId !== 'broadcast' && awardablePlayers.length >= 2 && (
                <BiometricDualOverlay
                  snapshots={biometricSnapshots}
                  leftPlayer={{ playerId: awardablePlayers[0].id, label: awardablePlayers[0].displayName }}
                  rightPlayer={{ playerId: awardablePlayers[1].id, label: awardablePlayers[1].displayName }}
                />
              )}
              {/* RC-1: LiveGate removed — LiveStreamPlayer is the single source of
                  truth for access gating (unregistered, privileged, PPV, invite, paywall).
                  useLiveAccess() is kept for isLive badge + title chrome only. */}
            </div>

            {/* Actions + Chat */}
            <div className="container lg:px-0 py-4 space-y-4">
              {/* Reaction bar */}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => postReaction('fire')} className="panel px-3 py-2 text-xs flex items-center gap-1.5 hover:border-primary/30 transition-colors">
                  🔥 <span className="stat-numeral">{reactions.fire}</span>
                </button>
                <button onClick={() => postReaction('heart')} className="panel px-3 py-2 text-xs flex items-center gap-1.5 hover:border-primary/30 transition-colors">
                  ❤️ <span className="stat-numeral">{reactions.heart}</span>
                </button>
                <button onClick={() => postReaction('clap')} className="panel px-3 py-2 text-xs flex items-center gap-1.5 hover:border-primary/30 transition-colors">
                  👏 <span className="stat-numeral">{reactions.clap}</span>
                </button>
                {canModerateLive && (
                  <button
                    onClick={handleResetReactions}
                    disabled={!activeGameId || !session}
                    className="panel px-3 py-2 text-xs flex items-center gap-1.5 hover:border-primary/30 disabled:opacity-40 transition-colors"
                  >
                    Reset Reactions
                  </button>
                )}
                <button
                  onClick={handleClip}
                  className={`panel px-3 py-2 text-xs flex items-center gap-1.5 transition-colors ${clipSaved ? 'border-primary/50 text-primary' : 'hover:border-primary/30'}`}
                >
                  {clipSaved ? <Check className="w-3.5 h-3.5" /> : <Scissors className="w-3.5 h-3.5" />}
                  {clipSaved ? 'Saved' : 'Clip'}
                </button>
                <button onClick={handleShare} className="panel px-3 py-2 text-xs flex items-center gap-1.5 hover:border-primary/30 transition-colors">
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
              </div>

              {/* Aggregate cheer meter — last 30 s across all viewers */}
              {activeGameId && activeGameId !== 'broadcast' && (
                <CheerMeter gameId={activeGameId} variant="inline" />
              )}

              {/* Live Chat */}
              <div className="panel">
                <div className="p-4 border-b border-border flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Live Chat</span>
                </div>
                <div className="p-4 space-y-3 max-h-[300px] overflow-y-auto">
                  {comments.map((c) => (
                    <div key={c.id} className="flex gap-2">
                      <span className="text-xs font-semibold shrink-0 text-primary">{c.user}</span>
                      <span className={`text-xs ${c.status === 'hidden' ? 'text-muted-foreground italic' : 'text-foreground'}`}>{c.text}</span>
                      {canModerateLive && (
                        <button
                          onClick={() => handleModerateComment(c.id, c.status === 'hidden' ? 'restore' : 'hide')}
                          className="text-[10px] text-muted-foreground hover:text-primary"
                        >
                          {c.status === 'hidden' ? 'Restore' : 'Hide'}
                        </button>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div className="p-3 border-t border-border flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSendChat(); }}
                    placeholder="Send a message..."
                    className="flex-1 bg-secondary px-3 py-2 text-xs rounded-sm border border-border focus:outline-none focus:border-primary/50"
                  />
                  <button
                    onClick={handleSendChat}
                    disabled={!chatInput.trim() || !session || !liveGame?.id}
                    className="px-3 py-2 text-xs bg-primary text-primary-foreground rounded-sm font-medium disabled:opacity-40 transition-opacity"
                  >
                    Send
                  </button>
                </div>
              </div>

              {/* Mobile-only sidebar */}
              <div className="lg:hidden">{sidebar}</div>
            </div>
          </div>

          {/* RIGHT: sticky sidebar */}
          <div className="hidden lg:block sticky top-[73px]">
            {sidebar}
          </div>

        </div>
      </div>

      {/* CASL nudge — one-time per session, bottom-right, easy dismiss */}
      <CASLNudge roles={roles} />
      <TokenPurchaseModal
        open={tokenModalOpen}
        products={tokenProductsQuery.data ?? []}
        busyProductId={tokenBusyProductId}
        onClose={() => setTokenModalOpen(false)}
        onPurchase={(productId) => {
          setTokenBusyProductId(productId);
          void startTokenPurchase(productId)
            .then((res) => { window.location.assign(res.checkoutUrl); })
            .finally(() => setTokenBusyProductId(null));
        }}
      />
    </div>
  );
};

export default LivePage;
