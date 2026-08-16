import { parseCsv } from '@/lib/parseCsv';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useOpsCsvUpload } from '@/hooks/useOpsCsvUpload';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, Upload, Loader2, CheckCircle2, AlertCircle, Trophy, Image as ImageIcon, Save, Trash2, ArrowUp, ArrowDown, Activity, Zap, PlusCircle, Radio, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { PotgCard } from '@/components/ui/PotgCard';
import { MediaLibraryTab } from '@/components/OpsMediaLibrary';
import {
  fetchOpsBootstrap, fetchImportHistory, fetchPipelineHealth, mergePlayerIdentities,
  parseEventImage, parsePotgImage, manualOpsAction, fetchOpsList, findOrCreatePlayer,
  ingestPresign, ingestSubmit, ingestApprove, ingestReject,
  parseRosterImage, importRoster, type ParsedRosterPlayer,
  type MediaPublicationStatus, type OpsMediaPublication,
  type LeagueRef, type SeasonRef, type DivisionRef,
  type TeamRef, type PlayerRef, type EventRef, type ScheduleRef,
} from '@/lib/api/ops';
import { LEAGUE_REGISTRY } from '@/lib/leagues';
import { canAccessOps, type AppRole } from '@/lib/auth/roles';
import { Link } from 'react-router-dom';
import { resizeImageToFit, inferTargetDimensions } from '@/lib/imageResize';
import { fetchScores, submitScoreManual, parseScoreboardImage } from '@/lib/api/scores';
import { fetchOverlay } from '@/lib/api/overlay';
import type { ScoreCategory, LeagueId, GameStatus } from '@/types';
import { LiveScoreboard } from '@/components/LiveScoreboard/LiveScoreboard';
import { CourtsideQuickControls } from '@/components/LiveScoreboard/CourtsideQuickControls';
import { PlayerStatsTracker } from '@/components/LiveScoreboard/PlayerStatsTracker';

type Tab = 'overview' | 'scores' | 'scoreboard' | 'teams' | 'players' | 'schedules' | 'events' | 'store' | 'potg' | 'roster' | 'media' | 'history';

/**
 * Tabs a regular admin (`league_admin`) must NOT see. Store media upload and
 * edit are super-admin only; the server enforces this independently via
 * STORE_ONLY_TABLES, this list just avoids rendering a tab that would 403.
 */
const SUPER_ADMIN_ONLY_TABS: ReadonlySet<Tab> = new Set<Tab>(['store']);

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview',   label: 'Overview'        },
  { id: 'scores',     label: 'Scores'          },
  { id: 'scoreboard', label: 'Live Tabulation' },
  { id: 'teams',      label: 'Teams'           },
  { id: 'players',    label: 'Players'         },
  { id: 'schedules',  label: 'Schedules'       },
  { id: 'events',     label: 'Events'          },
  { id: 'store',      label: 'Store Media'     },
  { id: 'potg',       label: 'POTG Parser'     },
  { id: 'roster',     label: 'Roster Import'   },
  { id: 'media',      label: 'Media Library'   },
  { id: 'history',    label: 'Import History'  },
];

export const isOpsAuthError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : '';
  // 'forbidden' = authenticated but wrong role (403) — NOT a session loss.
  // Only true session loss ('unauthorized', 'reauth_required') should wipe the UI.
  return message === 'unauthorized' || message === 'reauth_required';
};

export const shouldRetryOpsQuery = (failureCount: number, error: unknown): boolean =>
  !isOpsAuthError(error) && failureCount < 2;

export const assertOpsAccess = (canRunOps: boolean) => {
  if (!canRunOps) throw new Error('reauth_required');
};

export const isSessionFresh = (
  session: { expires_at?: number | null } | null | undefined,
  nowMs: number = Date.now(),
): boolean => {
  if (!session) return false;
  if (!session.expires_at) return true;
  return session.expires_at * 1000 > nowMs;
};

type OpsCsvImportSectionProps = {
  kind: 'teams' | 'players' | 'schedules' | 'events' | 'scores';
  csvUpload: ReturnType<typeof useOpsCsvUpload>;
  csvLeagueId: string;
  setCsvLeagueId: (id: string) => void;
  /** True when the signed-in user may run ops writes (league_admin or higher). */
  canOperate: boolean;
};

function OpsCsvImportSection({ kind, csvUpload, csvLeagueId, setCsvLeagueId, canOperate }: OpsCsvImportSectionProps) {
  const [localRows, setLocalRows] = useState<Record<string, string>[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const raw = await file.text();
    setLocalRows(parseCsv(raw));
  };

  const handleUpload = async () => {
    const format = 'v1';
    const rowsWithLeague = kind === 'scores' 
      ? localRows 
      : localRows.map(r => ({ ...r, league_id: r.league_id ?? csvLeagueId }));

    const res = await csvUpload.performUpload(kind, { rows: rowsWithLeague, format });
    if (res.ok) {
      setLocalRows([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="panel p-4 space-y-3 max-w-2xl">
      <div>
        <h2 className="font-display text-xl uppercase tracking-wide">
          {kind} CSV Bulk Import
        </h2>
        {kind === 'scores' ? (
          <p className="text-xs text-muted-foreground mt-1">
            Required columns: <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">category, home_label, away_label, status</code>.
            Optional: <code className="text-[10px] bg-secondary px-1 py-0.5 rounded">league_id, home_score, away_score, game_date, event_name, notes</code>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-1">
            All imported rows will be validated against the {kind} schema (format=v1).
          </p>
        )}
      </div>

      {kind !== 'scores' && (
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Target League</label>
          <div className="flex gap-1 p-1 bg-secondary rounded-sm w-fit">
            {LEAGUE_REGISTRY.map(l => (
              <button
                key={l.id}
                type="button"
                onClick={() => setCsvLeagueId(l.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors ${csvLeagueId === l.id ? `bg-card ${l.accentClass} border border-current/20` : 'text-muted-foreground hover:text-foreground'}`}
              >
                <img src={l.logo} alt="" width={12} height={12} className="flex-shrink-0 opacity-80" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                {l.shortName}
              </button>
            ))}
          </div>
        </div>
      )}

      <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} />
      <p className="text-xs text-muted-foreground">Rows loaded: {localRows.length}</p>

      {localRows.length > 0 && (
        <div className="max-h-44 overflow-auto text-xs bg-secondary p-2 rounded-sm border border-border">
          {localRows.slice(0, 6).map((row, i) => <pre key={i} className="truncate">{JSON.stringify(row)}</pre>)}
          {localRows.length > 6 && <p className="text-muted-foreground mt-1">…and {localRows.length - 6} more</p>}
        </div>
      )}

      <button
        disabled={(!canOperate && kind === 'scores') || localRows.length === 0 || csvUpload.isUploading}
        className="gold-bg px-4 py-2 rounded-sm text-sm font-semibold disabled:opacity-60"
        onClick={handleUpload}
      >
        {csvUpload.isUploading ? 'Importing…' : `Import ${localRows.length} Row${localRows.length !== 1 ? 's' : ''}`}
      </button>

      {csvUpload.uploadError && <p className="text-xs text-destructive">{csvUpload.uploadError.message}</p>}
      {csvUpload.uploadResult && (
        <p className="text-xs text-success">
          Success! Inserted: {csvUpload.uploadResult.inserted} · Failed: {csvUpload.uploadResult.failed}
        </p>
      )}

      {csvUpload.validationErrors.length > 0 && (
        <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 text-xs text-destructive rounded-sm max-h-40 overflow-auto">
          <p className="font-semibold mb-1">Validation Errors:</p>
          {csvUpload.validationErrors.map((err, i) => (
            <div key={i}>
              Row {err.row}{err.field ? ` [${err.field}]` : ''}: {err.message}
            </div>
          ))}
        </div>
      )}

      {/* Offline Ingest Queue */}
      {csvUpload.queue.filter(q => q.type === kind).length > 0 && (
        <div className="mt-4 p-3 bg-secondary rounded-sm border border-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" />
              Offline Ingest Queue ({csvUpload.queue.filter(q => q.type === kind).length})
            </h3>
            <button
              onClick={() => csvUpload.flushQueue()}
              disabled={csvUpload.isUploading}
              className="text-2xs font-semibold px-2 py-1 bg-primary text-primary-foreground rounded-sm hover:opacity-90 disabled:opacity-50"
            >
              Flush Queue
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-auto">
            {csvUpload.queue.filter(q => q.type === kind).map((item) => (
              <div key={item.id} className="flex items-center justify-between text-2xs bg-card p-2 rounded-sm border border-border/50">
                <div className="flex-1 min-w-0 pr-2">
                  <div className="font-semibold text-foreground truncate uppercase">{item.type} Upload</div>
                  <div className="text-muted-foreground truncate">
                    {item.payload.rows?.length || 0} rows · attempts: {item.attempts}
                  </div>
                  {item.error_message && (
                    <div className="text-destructive truncate mt-0.5 font-mono">{item.error_message}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => csvUpload.retryQueueItem(item.id)}
                    disabled={csvUpload.isUploading}
                    className="px-2 py-0.5 bg-secondary text-secondary-foreground hover:bg-muted rounded-sm border border-border"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => csvUpload.deleteQueueItem(item.id)}
                    disabled={csvUpload.isUploading}
                    className="p-1 text-destructive hover:bg-destructive/10 rounded-sm"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── UUID-free Ops Console pickers ───────────────────────────────────────────
//
// Every one of these submits the value the field is FOR (a league slug, a
// real team/player/event/schedule UUID selected from a list) — never a value
// the operator has to already know and type. League fields submit the
// LEAGUE_REGISTRY slug ('wbl'/'sbbl'/'tgifbl'), matching the pattern already
// proven by the POTG form; the worker resolves it server-side via
// resolveLeagueId (CLAUDE.md rule 10). Season/Team dropdowns need the
// league's real UUID purely to CLIENT-SIDE filter their own options — see
// leagueUuidForSlug — that UUID is never something the operator sees or types.
const SELECT_CLASS = "w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm";

function leagueUuidForSlug(leagues: LeagueRef[], slug: string): string | null {
  const entry = LEAGUE_REGISTRY.find((l) => l.id === slug);
  if (!entry) return null;
  return leagues.find((l) => l.code?.toUpperCase() === entry.code.toUpperCase())?.id ?? null;
}

function LeagueSelect({ value, onChange, allowNone }: {
  value: string;
  onChange: (slug: string) => void;
  /** Include a blank "No League" option for optional-league fields (Events). */
  allowNone?: boolean;
}) {
  return (
    <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">No League</option>}
      {LEAGUE_REGISTRY.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  );
}

function SeasonSelect({ seasons, leagues, leagueSlug, value, onChange }: {
  seasons: SeasonRef[];
  leagues: LeagueRef[];
  leagueSlug: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const leagueUuid = leagueUuidForSlug(leagues, leagueSlug);
  // seasons ref data is ordered most-recently-created first — there's no
  // "current season" flag in the schema, so "most recent" is the best
  // available default (see docs/ops/... investigation, no is_active column).
  const filtered = leagueUuid ? seasons.filter((s) => s.league_id === leagueUuid) : [];
  return (
    <select className={SELECT_CLASS} value={value} disabled={!leagueUuid} onChange={(e) => onChange(e.target.value)}>
      <option value="">
        {!leagueUuid ? 'Select a league first' : filtered.length === 0 ? 'No seasons found for this league' : 'Select Season *'}
      </option>
      {filtered.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}

function DivisionSelect({ divisions, seasonId, value, onChange }: {
  divisions: DivisionRef[];
  seasonId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const filtered = seasonId ? divisions.filter((d) => d.season_id === seasonId) : [];
  return (
    <select className={SELECT_CLASS} value={value} disabled={!seasonId} onChange={(e) => onChange(e.target.value)}>
      <option value="">{!seasonId ? 'Select a season first' : 'No Division'}</option>
      {filtered.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}

function TeamSelect({ teams, leagues, leagueSlug, value, onChange, placeholder }: {
  teams: TeamRef[];
  leagues: LeagueRef[];
  /** Omit to list every team across all leagues (used by Delete Team). */
  leagueSlug?: string;
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  const leagueUuid = leagueSlug ? leagueUuidForSlug(leagues, leagueSlug) : null;
  const filtered = leagueSlug
    ? (leagueUuid ? teams.filter((t) => t.league_id === leagueUuid) : [])
    : teams;
  const active = filtered.filter((t) => t.status !== 'archived');
  return (
    <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {active.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}

function playerLabel(p: PlayerRef): string {
  const name = p.display_name || `Unnamed (${p.user_id.slice(0, 8)}…)`;
  const team = p.team_name ? ` — ${p.team_name}` : '';
  const suspended = p.is_suspended ? ' [SUSPENDED]' : '';
  return `${name}${team}${suspended}`;
}

function PlayerSelect({ players, value, onChange, placeholder }: {
  players: PlayerRef[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  return (
    <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {players.map((p) => (
        <option key={p.id} value={p.id}>{playerLabel(p)}</option>
      ))}
    </select>
  );
}

function EventSelect({ events, value, onChange, placeholder }: {
  events: EventRef[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  return (
    <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {events.map((ev) => (
        <option key={ev.id} value={ev.id}>
          {ev.title}{ev.starts_at ? ` — ${new Date(ev.starts_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
        </option>
      ))}
    </select>
  );
}

function ScheduleSelect({ schedules, value, onChange, placeholder }: {
  schedules: ScheduleRef[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
}) {
  return (
    <select className={SELECT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {schedules.map((s) => (
        <option key={s.id} value={s.id}>
          {(s.league_code || s.league_name || 'League')} — {new Date(s.starts_at).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{s.status ? ` [${s.status}]` : ''}
        </option>
      ))}
    </select>
  );
}

const OpsPage = () => {
  const queryClient = useQueryClient();
  const { loading, session, user, roles } = useAuth();
  const csvUpload = useOpsCsvUpload();
  const [storeForm, setStoreForm] = useState({ title: '', price: '0', category: 'apparel', publishStatus: 'draft' as 'draft' | 'published', imageFile: null as File | null, sale: false });
  const [csvLeagueId, setCsvLeagueId] = useState<string>('wbl');
  const potgFileRef = useRef<HTMLInputElement>(null);
  const [potgParseState, setPotgParseState] = useState<'idle' | 'parsing' | 'parsed' | 'error'>('idle');
  const [potgParseError, setPotgParseError] = useState<string | null>(null);
  const [potgImageFile, setPotgImageFile] = useState<File | null>(null);
  const [potgForm, setPotgForm] = useState({ playerName: '', team: '', pts: '', rebs: '', assts: '', gameResult: '', leagueId: 'wbl', date: new Date().toISOString().split('T')[0] });
  const rosterFileRef = useRef<HTMLInputElement>(null);
  const [rosterParseState, setRosterParseState] = useState<'idle' | 'parsing' | 'parsed' | 'error'>('idle');
  const [rosterParseError, setRosterParseError] = useState<string | null>(null);
  const [rosterForm, setRosterForm] = useState({ teamName: '', leagueId: 'wbl', seasonId: '' });
  const [rosterPlayers, setRosterPlayers] = useState<Array<{ name: string; jerseyNumber: string; position: string }>>([]);
  const [rosterImportResult, setRosterImportResult] = useState<{ teamId: string; inserted: number; skipped: number; failed: number; warnings: string[]; errors: string[] } | null>(null);
  // Ops Console is a league_admin surface, not a super_admin one. Regular admins
  // run day-to-day operations for all three leagues (scores, schedules, stats,
  // rosters, teams, players, media, POTG, store). Gating entry on super_admin
  // made league_admin a role that could sign in and see only "Access denied".
  //
  // The genuinely super-admin-only surfaces (broadcast control, PPV comp codes,
  // access overrides, coach-request approval) do not live on this page — they
  // are gated server-side by requireSuperAdminSession and rendered elsewhere.
  const canOperateOps = canAccessOps(roles as AppRole[]);
  const isSuperAdmin = roles.includes('super_admin');
  const sessionFresh = isSessionFresh(session);
  const canRunOps = !loading && sessionFresh && canOperateOps;
  const visibleTabs = useMemo(
    () => (isSuperAdmin ? tabs : tabs.filter((t) => !SUPER_ADMIN_ONLY_TABS.has(t.id))),
    [isSuperAdmin],
  );
  const ensureOpsAccess = () => {
    assertOpsAccess(canRunOps);
  };

  // ── Admin CRUD form state ──────────────────────────────────────────────────
  const [scoreboardLeague, setScoreboardLeague] = useState<LeagueId>('wbl');
  const [scoreboardGameId, setScoreboardGameId] = useState<string>('');
  const [quickHomeTeam, setQuickHomeTeam] = useState('');
  const [quickAwayTeam, setQuickAwayTeam] = useState('');
  const [showQuickGameLauncher, setShowQuickGameLauncher] = useState(false);
  const [quickGameStatus, setQuickGameStatus] = useState<GameStatus>('live');
  const [teamForm, setTeamForm] = useState({ name: '', leagueId: 'wbl', seasonId: '', divisionId: '' });
  const [deleteTeamId, setDeleteTeamId] = useState('');

  const [playerForm, setPlayerForm] = useState({ name: '', teamId: '', leagueId: 'wbl', jerseyNumber: '', position: '' });
  const [deletePlayerId, setDeletePlayerId] = useState('');
  const [suspendPlayerId, setSuspendPlayerId] = useState('');
  const [suspendPlayerReason, setSuspendPlayerReason] = useState('');

  const [scheduleForm, setScheduleForm] = useState({ leagueId: 'wbl', seasonId: '', startsAt: '', endsAt: '' });
  const [deleteScheduleId, setDeleteScheduleId] = useState('');

  const [eventForm, setEventForm] = useState({ title: '', location: '', date: '', leagueId: '' });
  const [deleteEventId, setDeleteEventId] = useState('');

  const [storeBatchItems, setStoreBatchItems] = useState([
    { title: '', price: '', category: 'apparel' },
    { title: '', price: '', category: 'apparel' },
    { title: '', price: '', category: 'apparel' },
    { title: '', price: '', category: 'apparel' },
  ]);
  const [storeSuspendId, setStoreSuspendId] = useState('');
  const [storeDeleteId, setStoreDeleteId] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  // ── Scores state ──────────────────────────────────────────────────────────

  // --- Event Graphics Parser State ---
  const eventFileRef = useRef<HTMLInputElement>(null);
  const [eventParseState, setEventParseState] = useState<'idle' | 'parsing' | 'parsed' | 'error'>('idle');
  const [eventParseError, setEventParseError] = useState('');
  const [eventResizedBlob, setEventResizedBlob] = useState<Blob | null>(null);
  const [eventGraphicForm, setEventGraphicForm] = useState({
    title: '',
    location: '',
    date: '',
    leagueId: 'sbbl',
  });
  const scoreboardFileRef = useRef<HTMLInputElement>(null);
  const [scoreboardImageFile, setScoreboardImageFile] = useState<File | null>(null);
  const [scoreboardParseState, setScoreboardParseState] = useState<'idle' | 'parsing' | 'parsed' | 'error'>('idle');
  const [scoreboardParseError, setScoreboardParseError] = useState<string | null>(null);
  const defaultScoreForm = {
    category: 'league' as ScoreCategory,
    leagueId: 'sbbl',
    homeLabel: '',
    awayLabel: '',
    homeScore: '',
    awayScore: '',
    status: 'final',
    gameDate: new Date().toISOString().split('T')[0],
    eventName: '',
    notes: '',
  };
  const [scoresForm, setScoresForm] = useState(defaultScoreForm);
  const [ingestJob, setIngestJob] = useState<{ jobId: string; state: string } | null>(null);


  const updateStoreBatchItem = (i: number, field: string, value: string) =>
    setStoreBatchItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

  const handlePotgImageUpload = async (file: File) => {
    ensureOpsAccess();
    setPotgParseState('parsing');
    setPotgParseError(null);
    setPotgImageFile(file);
    try {
      // Pure base64 only — never pass a data: URI
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const imageBase64 = btoa(binary);

      const result = await parsePotgImage(imageBase64, file.type as string);
      if (result.ok && result.data) {
        setPotgForm(f => ({
          ...f,
          playerName: result.data.playerName ?? '',
          team: result.data.team ?? '',
          pts: String(result.data.pts ?? ''),
          rebs: String(result.data.rebs ?? ''),
          assts: String(result.data.assts ?? ''),
          gameResult: result.data.gameResult ?? '',
        }));
        setPotgParseState('parsed');
      } else {
        setPotgParseError('Parse failed — fill in manually');
        setPotgParseState('error');
      }
    } catch (e) {
      setPotgParseError(e instanceof Error ? e.message : 'Unknown error');
      setPotgParseState('error');
    }
  };

  const handleRosterImageUpload = async (file: File) => {
    ensureOpsAccess();
    setRosterParseState('parsing');
    setRosterParseError(null);
    setRosterImportResult(null);
    try {
      // Pure base64 only — never pass a data: URI
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const imageBase64 = btoa(binary);

      const result = await parseRosterImage(imageBase64, file.type as string);
      if (result.ok && result.data) {
        setRosterForm(f => ({ ...f, teamName: result.data.teamName ?? '' }));
        setRosterPlayers((result.data.players ?? []).map((p: ParsedRosterPlayer) => ({
          name: p.name ?? '',
          jerseyNumber: p.jerseyNumber != null ? String(p.jerseyNumber) : '',
          position: p.position ?? '',
        })));
        setRosterParseState('parsed');
      } else {
        setRosterParseError('Parse failed — add players manually');
        setRosterParseState('error');
      }
    } catch (e) {
      setRosterParseError(e instanceof Error ? e.message : 'Unknown error');
      setRosterParseState('error');
    }
  };

  const updateRosterPlayer = (i: number, field: 'name' | 'jerseyNumber' | 'position', value: string) =>
    setRosterPlayers(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  const addRosterPlayerRow = () => setRosterPlayers(prev => [...prev, { name: '', jerseyNumber: '', position: '' }]);
  const removeRosterPlayerRow = (i: number) => setRosterPlayers(prev => prev.filter((_, idx) => idx !== i));

  // Layout fix (2026-07-20): `tabs` was declared but never rendered — every
  // section stacked into one endless scroll. True tab navigation restored;
  // exactly one section mounts at a time.
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const bootstrapQuery = useQuery({
    queryKey: ['ops-bootstrap'],
    queryFn: fetchOpsBootstrap,
    enabled: canRunOps,
    retry: shouldRetryOpsQuery,
  });
  const historyQuery = useQuery({
    queryKey: ['ops-import-history'],
    queryFn: fetchImportHistory,
    enabled: canRunOps,
    retry: shouldRetryOpsQuery,
  });
  // Backs the Team/Player/Event/Schedule pickers so no Manual Ops form ever
  // requires the operator to paste a raw UUID.
  const teamsListQuery = useQuery({
    queryKey: ['ops-list-teams'],
    queryFn: () => fetchOpsList('teams'),
    enabled: canRunOps,
    retry: shouldRetryOpsQuery,
  });
  const playersListQuery = useQuery({
    queryKey: ['ops-list-players'],
    queryFn: () => fetchOpsList('players'),
    enabled: canRunOps,
    retry: shouldRetryOpsQuery,
  });
  const eventsListQuery = useQuery({
    queryKey: ['ops-list-events'],
    queryFn: () => fetchOpsList('events'),
    enabled: canRunOps,
    retry: shouldRetryOpsQuery,
  });
  const schedulesListQuery = useQuery({
    queryKey: ['ops-list-schedules'],
    queryFn: () => fetchOpsList('schedules'),
    enabled: canRunOps,
    retry: shouldRetryOpsQuery,
  });
  const teamsList = (teamsListQuery.data?.data ?? []) as TeamRef[];
  const playersList = (playersListQuery.data?.data ?? []) as PlayerRef[];
  const eventsList = (eventsListQuery.data?.data ?? []) as EventRef[];
  const schedulesList = (schedulesListQuery.data?.data ?? []) as ScheduleRef[];
  const leaguesRef = bootstrapQuery.data?.references?.leagues ?? [];
  const seasonsRef = bootstrapQuery.data?.references?.seasons ?? [];
  const divisionsRef = bootstrapQuery.data?.references?.divisions ?? [];
  const invalidateOpsLists = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['ops-bootstrap'] }),
    queryClient.invalidateQueries({ queryKey: ['ops-list-teams'] }),
    queryClient.invalidateQueries({ queryKey: ['ops-list-players'] }),
    queryClient.invalidateQueries({ queryKey: ['ops-list-events'] }),
    queryClient.invalidateQueries({ queryKey: ['ops-list-schedules'] }),
  ]);
  const pipelineHealthQuery = useQuery({
    queryKey: ['ops-pipeline-health'],
    queryFn: fetchPipelineHealth,
    enabled: canRunOps,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    // A health probe must never hammer or churn the page: no retries — the
    // next 60s tick is the retry. Failures just leave the cards blank.
    retry: false,
  });
  const [mergeSourceId, setMergeSourceId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const mergeMutation = useMutation({
    mutationFn: () => mergePlayerIdentities(mergeSourceId.trim(), mergeTargetId.trim()),
    onSuccess: async () => {
      setMergeSourceId(''); setMergeTargetId('');
      await invalidateOpsLists();
    },
  });



  const potgMutation = useMutation({
    mutationFn: async () => {
      if (!potgImageFile) throw new Error('Image is required');
      const dims = await inferTargetDimensions(potgImageFile);
      const resized = await resizeImageToFit(potgImageFile, dims.width, dims.height, dims.mode);

      const { signedUrl, objectPath } = await ingestPresign('potg', potgImageFile.name);
      const uploadResp = await fetch(signedUrl, { method: 'PUT', body: resized });
      if (!uploadResp.ok) throw new Error('Upload to signed URL failed: ' + uploadResp.status);

      return ingestSubmit({
        kind: 'potg',
        objectPath,
        publicUrl: objectPath,
        title: potgForm.playerName,
        leagueId: potgForm.leagueId,
        publishStatus: 'published',
        meta: {
          date: potgForm.date,
          playerName: potgForm.playerName,
          team: potgForm.team,
          pts: Number(potgForm.pts),
          rebs: Number(potgForm.rebs),
          assts: Number(potgForm.assts),
          gameResult: potgForm.gameResult,
        },
      });
    },
    onSuccess: async (data) => {
      setIngestJob(data as { jobId: string; state: string });
      await queryClient.invalidateQueries({ queryKey: ['ops-import-history'] });
      await queryClient.invalidateQueries({ queryKey: ['ops-bootstrap'] });
    },
  });

  const rosterImportMutation = useMutation({
    mutationFn: () => importRoster({
      leagueId: rosterForm.leagueId,
      seasonId: rosterForm.seasonId,
      teamName: rosterForm.teamName,
      players: rosterPlayers
        .filter(p => p.name.trim())
        .map(p => ({
          name: p.name.trim(),
          jerseyNumber: p.jerseyNumber.trim() || null,
          position: p.position.trim() || null,
        })),
    }),
    onSuccess: async (data) => {
      setRosterImportResult(data);
      await queryClient.invalidateQueries({ queryKey: ['ops-import-history'] });
      await queryClient.invalidateQueries({ queryKey: ['ops-bootstrap'] });
    },
  });

  const storeMutation = useMutation({
    mutationFn: async () => {
      ensureOpsAccess();
      if (!storeForm.imageFile) throw new Error('Image is required');
      const resized = await resizeImageToFit(storeForm.imageFile, 800, 800);

      const { signedUrl, objectPath } = await ingestPresign('store', storeForm.imageFile.name);
      const uploadResp = await fetch(signedUrl, { method: 'PUT', body: resized });
      if (!uploadResp.ok) throw new Error('Upload to signed URL failed: ' + uploadResp.status);

      return ingestSubmit({
        kind: 'store',
        objectPath,
        publicUrl: objectPath,
        title: storeForm.title,
        publishStatus: storeForm.publishStatus,
        meta: {
          price: Number(storeForm.price),
          category: storeForm.category,
          sale: storeForm.sale,
        },
      });
    },
    onSuccess: (data) => {
      setIngestJob(data);
      setStoreForm({
        title: '', price: '0', category: 'apparel',
        publishStatus: 'draft', imageFile: null, sale: false,
      });
    },
  });

  // Uploads the resized event graphic via ingest pipeline and writes
  // media_assets + media_publications (surface='event') so it appears on /media.
  const eventMediaMutation = useMutation({
    mutationFn: async () => {
      ensureOpsAccess();
      if (!eventResizedBlob || !eventGraphicForm.title) return null;
      const filename = `event-${crypto.randomUUID()}.jpg`;

      const { signedUrl, objectPath } = await ingestPresign('event', filename);
      const uploadResp = await fetch(signedUrl, { method: 'PUT', body: eventResizedBlob });
      if (!uploadResp.ok) throw new Error('Upload to signed URL failed: ' + uploadResp.status);

      return ingestSubmit({
        kind: 'event',
        objectPath,
        publicUrl: objectPath,
        title: eventGraphicForm.title,
        leagueId: eventGraphicForm.leagueId || undefined,
        publishStatus: 'published',
        meta: {
          date: eventGraphicForm.date || undefined,
        },
      });
    },
    onSuccess: async (data) => {
      if (!data) return;
      setIngestJob(data);
      await queryClient.invalidateQueries({ queryKey: ['ops-import-history'] });
      await queryClient.invalidateQueries({ queryKey: ['ops-bootstrap'] });
    },
  });

  // ── Admin CRUD mutations ───────────────────────────────────────────────
  const createTeamMutation = useMutation({
    mutationFn: () => manualOpsAction('team', 'create', {
      name: teamForm.name,
      leagueId: teamForm.leagueId,
      seasonId: teamForm.seasonId,
      divisionId: teamForm.divisionId || undefined,
    }),
    onSuccess: async () => {
      setTeamForm({ name: '', leagueId: 'wbl', seasonId: '', divisionId: '' });
      await invalidateOpsLists();
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: () => manualOpsAction('team', 'delete', { id: deleteTeamId }),
    onSuccess: async () => {
      setDeleteTeamId('');
      await invalidateOpsLists();
    },
  });

  // Replaces the raw-UUID contract: submits a NAME, not a pre-existing user_id.
  // Server-side find-or-create via /ops/players/find-or-create (reuses the same
  // logic already proven by Roster Import), so there's nothing to look up first.
  const createPlayerMutation = useMutation({
    mutationFn: () => findOrCreatePlayer({
      name: playerForm.name,
      leagueId: playerForm.leagueId,
      teamId: playerForm.teamId || undefined,
      jerseyNumber: playerForm.jerseyNumber || undefined,
      position: playerForm.position || undefined,
    }),
    onSuccess: async () => {
      setPlayerForm({ name: '', teamId: '', leagueId: 'wbl', jerseyNumber: '', position: '' });
      await invalidateOpsLists();
    },
  });

  const suspendPlayerMutation = useMutation({
    mutationFn: () => manualOpsAction('player', 'suspend', { id: suspendPlayerId, reason: suspendPlayerReason || undefined }),
    onSuccess: async () => {
      setSuspendPlayerId('');
      setSuspendPlayerReason('');
      await invalidateOpsLists();
    },
  });

  const deletePlayerMutation = useMutation({
    mutationFn: () => manualOpsAction('player', 'delete', { id: deletePlayerId }),
    onSuccess: async () => {
      setDeletePlayerId('');
      await invalidateOpsLists();
    },
  });

  const createScheduleMutation = useMutation({
    mutationFn: () => manualOpsAction('schedule', 'create', {
      leagueId: scheduleForm.leagueId,
      seasonId: scheduleForm.seasonId,
      startsAt: scheduleForm.startsAt,
      endsAt: scheduleForm.endsAt || undefined,
    }),
    onSuccess: async () => {
      setScheduleForm({ leagueId: 'wbl', seasonId: '', startsAt: '', endsAt: '' });
      await invalidateOpsLists();
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: () => manualOpsAction('schedule', 'delete', { id: deleteScheduleId }),
    onSuccess: async () => {
      setDeleteScheduleId('');
      await invalidateOpsLists();
    },
  });

  const createEventMutation = useMutation({
    mutationFn: () => manualOpsAction('event', 'create', {
      title: eventForm.title,
      location: eventForm.location || undefined,
      date: eventForm.date || undefined,
      leagueId: eventForm.leagueId || undefined,
    }),
    onSuccess: async () => {
      setEventForm({ title: '', location: '', date: '', leagueId: '' });
      await invalidateOpsLists();
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: () => manualOpsAction('event', 'delete', { id: deleteEventId }),
    onSuccess: async () => {
      setDeleteEventId('');
      await invalidateOpsLists();
    },
  });

  const storeBatchMutation = useMutation({
    mutationFn: () => manualOpsAction('store', 'batch_create', {
      items: storeBatchItems
        .filter(it => it.title.trim())
        .map(it => ({ title: it.title, price: Number(it.price) || 0, category: it.category })),
    }),
    onSuccess: async () => {
      setStoreBatchItems([
        { title: '', price: '', category: 'apparel' },
        { title: '', price: '', category: 'apparel' },
        { title: '', price: '', category: 'apparel' },
        { title: '', price: '', category: 'apparel' },
      ]);
      await queryClient.invalidateQueries({ queryKey: ['ops-bootstrap'] });
    },
  });

  const storeSuspendMutation = useMutation({
    mutationFn: () => manualOpsAction('store', 'suspend', { id: storeSuspendId }),
    onSuccess: async () => {
      setStoreSuspendId('');
      await queryClient.invalidateQueries({ queryKey: ['ops-bootstrap'] });
    },
  });

  const storeDeleteMutation = useMutation({
    mutationFn: () => manualOpsAction('store', 'delete', { id: storeDeleteId }),
    onSuccess: async () => {
      setStoreDeleteId('');
      await queryClient.invalidateQueries({ queryKey: ['ops-bootstrap'] });
    },
  });

  // ── Scores mutations ───────────────────────────────────────────────────────
  const scoresQuery = useQuery({
    queryKey: ['ops-scores-list'],
    queryFn: () => fetchScores(),
    enabled: canRunOps,
    staleTime: 30_000,
  });
  const scoresList = scoresQuery.data?.games ?? [];

  const opsTabOverlayQuery = useQuery({
    queryKey: ['overlay', scoreboardGameId],
    queryFn: () => fetchOverlay(scoreboardGameId),
    enabled: !!scoreboardGameId,
    refetchInterval: 2500,
    refetchIntervalInBackground: false,
  });

  const launchQuickGameMutation = useMutation({
    mutationFn: async () => {
      if (!quickHomeTeam.trim() || !quickAwayTeam.trim()) {
        throw new Error('Please enter or select both Home and Away team names');
      }
      return submitScoreManual({
        category: 'league',
        leagueId: scoreboardLeague,
        participant1Label: quickHomeTeam.trim(),
        participant2Label: quickAwayTeam.trim(),
        status: quickGameStatus,
        gameDate: new Date().toISOString(),
      });
    },
    onSuccess: async (res) => {
      if (res.ok && res.gameId) {
        toast.success(`Game launched successfully!`);
        setScoreboardGameId(res.gameId);
        setShowQuickGameLauncher(false);
        setQuickHomeTeam('');
        setQuickAwayTeam('');
        await queryClient.invalidateQueries({ queryKey: ['ops-scores-list'] });
        await queryClient.invalidateQueries({ queryKey: ['scores'] });
      } else {
        toast.error('Failed to create game');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Game creation failed');
    },
  });

  const scoreManualMutation = useMutation({
    mutationFn: () => submitScoreManual({
      category: scoresForm.category,
      leagueId: scoresForm.category === 'league' ? scoresForm.leagueId : undefined,
      participant1Label: scoresForm.homeLabel || undefined,
      participant2Label: scoresForm.awayLabel || undefined,
      homeScore: scoresForm.homeScore !== '' ? Number(scoresForm.homeScore) : undefined,
      awayScore: scoresForm.awayScore !== '' ? Number(scoresForm.awayScore) : undefined,
      status: scoresForm.status,
      gameDate: scoresForm.gameDate || undefined,
      eventName: scoresForm.eventName || undefined,
      notes: scoresForm.notes || undefined,
    }),
    onSuccess: async () => {
      setScoresForm(defaultScoreForm);
      await queryClient.invalidateQueries({ queryKey: ['ops-scores-list'] });
      await queryClient.invalidateQueries({ queryKey: ['scores'] });
    },
  });




  const handleEventImageUpload = async (file: File) => {
    ensureOpsAccess();
    if (!file) return;
    setEventParseState('parsing');
    setEventParseError('');
    try {
      // Resize to correct AR before parsing and storage (landscape 747×560, portrait 560×747)
      const dims = await inferTargetDimensions(file);
      const resizedFile = await resizeImageToFit(file, dims.width, dims.height, dims.mode);
      setEventResizedBlob(resizedFile);

      const buffer = await resizedFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const imageBase64 = btoa(binary);

      const result = await parseEventImage(imageBase64, resizedFile.type);
      if (!result.ok) throw new Error('Failed to extract event details');
      const parsed = result.data;

      setEventGraphicForm({
        title: parsed.title || '',
        location: parsed.location || '',
        date: parsed.date || '',
        leagueId: (parsed.leagueId || 'sbbl').toLowerCase(),
      });
      setEventParseState('parsed');

    } catch (err: Error | unknown) {
      console.error('Event extraction failed:', err);
      setEventParseError((err as Error).message || 'Failed to parse image');
      setEventParseState('error');
    }
  };
  const handleScoreboardImage = async (file: File) => {
    setScoreboardParseState('parsing');
    setScoreboardParseError(null);
    setScoreboardImageFile(file);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const imageBase64 = btoa(binary);
      const result = await parseScoreboardImage(imageBase64, file.type);
      if (result.ok && result.data) {
        const d = result.data;
        setScoresForm(f => ({
          ...f,
          homeLabel: d.homeLabel ?? f.homeLabel,
          awayLabel: d.awayLabel ?? f.awayLabel,
          homeScore: d.homeScore != null ? String(d.homeScore) : f.homeScore,
          awayScore: d.awayScore != null ? String(d.awayScore) : f.awayScore,
          gameDate: d.gameDate ?? f.gameDate,
          eventName: d.eventName ?? f.eventName,
          status: d.status ?? f.status,
        }));
        setScoreboardParseState('parsed');
      } else {
        setScoreboardParseError('Parse failed — fill in manually');
        setScoreboardParseState('error');
      }
    } catch (e) {
      setScoreboardParseError(e instanceof Error ? e.message : 'Unknown error');
      setScoreboardParseState('error');
    }
  };

  const jobs = useMemo(() => historyQuery.data?.jobs ?? bootstrapQuery.data?.importHistory ?? [], [historyQuery.data?.jobs, bootstrapQuery.data?.importHistory]);
  const ingressFailures = historyQuery.data?.ingress_failures ?? [];
  const latestSummary = useMemo(() => jobs.slice(0, 5), [jobs]);

  const filteredJobs = useMemo(() => {
    const q = historySearch.trim();
    if (!q) return jobs;
    const regexMatch = q.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
      try {
        const re = new RegExp(regexMatch[1], regexMatch[2] || 'i');
        return jobs.filter(j =>
          re.test(j.job_type) || re.test(j.status) || re.test(j.error_summary ?? '')
        );
      } catch {
        return jobs;
      }
    }
    const lower = q.toLowerCase();
    return jobs.filter(j =>
      j.job_type.toLowerCase().includes(lower) ||
      j.status.toLowerCase().includes(lower) ||
      (j.error_summary ?? '').toLowerCase().includes(lower)
    );
  }, [jobs, historySearch]);

  // ⚡ Bolt Performance Optimization: Extract expensive O(N) array reduction
  // from the render loop into useMemo to prevent recalculating metric sums on every render.
  const successfulRows = useMemo(() => jobs.reduce((acc, j) => acc + (j.inserted_rows || 0), 0), [jobs]);
  const failedRows = useMemo(() => jobs.reduce((acc, j) => acc + (j.failed_rows || 0), 0), [jobs]);

  const reauthRequired = useMemo(
    () =>
      [
        bootstrapQuery.error,
        historyQuery.error,
        potgMutation.error,
        storeMutation.error,
        eventMediaMutation.error,
      ].some((error) => isOpsAuthError(error)),
    [
      bootstrapQuery.error,
      historyQuery.error,
      potgMutation.error,
      storeMutation.error,
      eventMediaMutation.error,
    ],
  );

  if (loading) {
    return (
      <div className="container py-8 md:py-12 max-w-6xl space-y-6 min-h-[calc(100vh-8rem)]">
        <p className="sr-only">Loading Ops session…</p>
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-muted animate-pulse" />
          <div className="space-y-1">
            <div className="h-8 w-48 bg-muted animate-pulse rounded" />
            <div className="h-3 w-64 bg-muted/60 animate-pulse rounded" />
          </div>
        </div>
        <div className="h-10 w-full bg-muted/40 animate-pulse rounded" />
        <div className="grid md:grid-cols-3 gap-4">
          <div className="panel p-4 h-24 bg-muted/30 animate-pulse" />
          <div className="panel p-4 h-24 bg-muted/30 animate-pulse" />
          <div className="panel p-4 h-24 bg-muted/30 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!sessionFresh || reauthRequired) {
    return (
      <div className="container py-8 md:py-12 max-w-6xl min-h-[calc(100vh-8rem)]">
        <div className="panel p-4 text-sm text-destructive font-semibold">Session expired. Sign in again.</div>
      </div>
    );
  }

  if (!canOperateOps) {
    return (
      <div className="container py-8 md:py-12 max-w-6xl min-h-[calc(100vh-8rem)]">
        <div className="panel p-4 text-sm text-destructive font-semibold">Access denied. League Admin role or higher required.</div>
      </div>
    );
  }

  return (
    <div className="container py-8 md:py-12 max-w-6xl space-y-6 min-h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-primary" />
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-bold">Ops Console</h1>
          <p className="text-xs text-muted-foreground">Signed in as {user?.email ?? 'unknown'} · roles: {roles.join(', ') || 'none'}</p>
        </div>
      </div>

      <nav aria-label="Ops sections" className="sticky top-0 z-20 -mx-2 px-2 py-2 bg-background/95 backdrop-blur border-b border-border flex flex-wrap gap-2">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            aria-current={activeTab === t.id ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
              activeTab === t.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="space-y-6">

      {activeTab === 'overview' && (
        <section id="overview" className="space-y-6 pt-6 min-h-[480px]">
          <h2 className="text-2xl font-display font-bold border-b border-border pb-2">System Health</h2>
          <div className="space-y-6">
            {/* Core System Summary Cards */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="panel p-4 min-h-[88px]"><p className="text-xs text-muted-foreground">Import jobs</p><p className="stat-numeral text-3xl">{jobs.length}</p></div>
              <div className="panel p-4 min-h-[88px]"><p className="text-xs text-muted-foreground">Recent successful rows</p><p className="stat-numeral text-3xl">{successfulRows}</p></div>
              <div className="panel p-4 min-h-[88px]"><p className="text-xs text-muted-foreground">Failed rows</p><p className="stat-numeral text-3xl text-destructive">{failedRows}</p></div>
            </div>

            {/* Pipeline Health Metrics & Alerts */}
            {pipelineHealthQuery.isLoading ? (
              <div className="grid md:grid-cols-3 gap-4 min-h-[120px]">
                <div className="panel p-4 animate-pulse bg-muted/20 min-h-[88px]" />
                <div className="panel p-4 animate-pulse bg-muted/20 min-h-[88px]" />
                <div className="panel p-4 animate-pulse bg-muted/20 min-h-[88px]" />
              </div>
            ) : pipelineHealthQuery.data ? (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Pipeline Health Metrics</h3>
                <div className="grid md:grid-cols-3 gap-4">
                  {Object.entries(pipelineHealthQuery.data.metrics).map(([name, m]) => (
                    <div key={name} className={`panel p-4 border ${m.status === 'critical' ? 'border-destructive/60' : m.status === 'warn' ? 'border-warning/50' : 'border-border'}`}>
                      <p className="text-xs text-muted-foreground">{name.replace(/_/g, ' ')}</p>
                      <p className={`stat-numeral text-3xl ${m.status === 'critical' ? 'text-destructive' : m.status === 'warn' ? 'text-warning' : 'text-success'}`}>{m.value}</p>
                      <p className="text-[10px] text-muted-foreground">warn ≥{m.warn} · critical ≥{m.critical}</p>
                    </div>
                  ))}
                  {pipelineHealthQuery.data.alerts.length > 0 && (
                    <div className="panel p-4 md:col-span-3 border border-destructive/40">
                      <p className="text-xs font-bold text-destructive mb-1">Pipeline alerts</p>
                      {pipelineHealthQuery.data.alerts.map((a) => <p key={a} className="text-xs font-mono text-destructive">{a}</p>)}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Recent Actions Section */}
            <div className="panel p-4 min-h-[140px]">
              <h3 className="font-display text-xl mb-2">Recent Actions</h3>
              {latestSummary.length === 0 ? <p className="text-sm text-muted-foreground">No imports yet.</p> : latestSummary.map((job) => <p key={job.id} className="text-sm">{job.job_type} · {job.status} · {job.inserted_rows}/{job.total_rows}</p>)}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'scores' && (<section id="scores" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Scores</h2><div className="space-y-4"><div className="space-y-6">
          {!canOperateOps && <p className="text-sm text-destructive font-semibold panel p-4">League Admin role or higher required for score management.</p>}

          {/* ── Scoreboard image OCR ──────────────────────────────── */}
          <div className="panel p-4 space-y-4 max-w-2xl">
            <div>
              <h2 className="font-display text-xl flex items-center gap-2"><Upload className="w-5 h-5 text-primary" /> Scoreboard Image Parser</h2>
              <p className="text-xs text-muted-foreground mt-1">Upload a scoreboard photo — AI vision auto-extracts team names and scores.</p>
            </div>
            <div
              className="border-2 border-dashed border-border rounded-sm p-6 text-center cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => scoreboardFileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleScoreboardImage(f); }}
            >
              <input ref={scoreboardFileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void handleScoreboardImage(f); }} />
              {scoreboardParseState === 'parsing' ? (
                <div className="flex flex-col items-center gap-2"><Loader2 className="w-6 h-6 text-primary animate-spin" /><p className="text-sm text-muted-foreground">Parsing with AI vision…</p></div>
              ) : scoreboardParseState === 'parsed' ? (
                <div className="flex flex-col items-center gap-1"><CheckCircle2 className="w-5 h-5 text-success" /><p className="text-xs text-success font-medium">Data extracted — review below</p><p className="text-[10px] text-muted-foreground">Click to parse another image</p></div>
              ) : scoreboardParseState === 'error' ? (
                <div className="flex flex-col items-center gap-1"><AlertCircle className="w-5 h-5 text-destructive" /><p className="text-xs text-destructive">{scoreboardParseError}</p><p className="text-[10px] text-muted-foreground">Fill in fields manually below</p></div>
              ) : (
                <div className="flex flex-col items-center gap-2"><Upload className="w-6 h-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">Drop scoreboard photo or click to upload</p><p className="text-[10px] text-muted-foreground">PNG, JPG — reads team names, scores, date</p></div>
              )}
            </div>
          </div>

          {/* ── Manual score entry ────────────────────────────────── */}
          <div className="panel p-4 space-y-4 max-w-2xl">
            <h2 className="font-display text-xl flex items-center gap-2"><Trophy className="w-5 h-5 text-primary" /> Manual Score Entry</h2>

            {/* Category */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Category</label>
              <div className="flex gap-1 p-1 bg-secondary rounded-sm w-fit">
                {(['league', '1v1', 'special_event'] as ScoreCategory[]).map(cat => (
                  <button key={cat} type="button" onClick={() => setScoresForm(f => ({ ...f, category: cat }))}
                    className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors ${scoresForm.category === cat ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    {cat === '1v1' ? '1-on-1' : cat === 'special_event' ? 'Special Event' : 'League'}
                  </button>
                ))}
              </div>
            </div>

            {/* League selector — only for league games */}
            {scoresForm.category === 'league' && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">League</label>
                <div className="flex gap-1 p-1 bg-secondary rounded-sm w-fit">
                  {LEAGUE_REGISTRY.map(l => (
                    <button key={l.id} type="button" onClick={() => setScoresForm(f => ({ ...f, leagueId: l.id }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-sm transition-colors ${scoresForm.leagueId === l.id ? `bg-card ${l.accentClass} border border-current/20` : 'text-muted-foreground hover:text-foreground'}`}>
                      <img src={l.logo} alt="" width={12} height={12} className="flex-shrink-0 opacity-80" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      {l.shortName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Event name — for special events */}
            {scoresForm.category === 'special_event' && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Event Name</label>
                <input className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" placeholder="e.g. SBBL All-Star Weekend" value={scoresForm.eventName} onChange={e => setScoresForm(f => ({ ...f, eventName: e.target.value }))} />
              </div>
            )}

            {/* Teams / participants */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Away Team / Player</label>
                <input className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" placeholder="Away label" value={scoresForm.awayLabel} onChange={e => setScoresForm(f => ({ ...f, awayLabel: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Home Team / Player</label>
                <input className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" placeholder="Home label" value={scoresForm.homeLabel} onChange={e => setScoresForm(f => ({ ...f, homeLabel: e.target.value }))} />
              </div>
            </div>

            {/* Scores */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Away Score</label>
                <input type="number" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" placeholder="—" value={scoresForm.awayScore} onChange={e => setScoresForm(f => ({ ...f, awayScore: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Home Score</label>
                <input type="number" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" placeholder="—" value={scoresForm.homeScore} onChange={e => setScoresForm(f => ({ ...f, homeScore: e.target.value }))} />
              </div>
            </div>

            {/* Status + Date + Venue */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Status</label>
                <select className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={scoresForm.status} onChange={e => setScoresForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="final">Final</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="live">Live</option>
                  <option value="postponed">Postponed</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Game Date</label>
                <input type="date" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={scoresForm.gameDate} onChange={e => setScoresForm(f => ({ ...f, gameDate: e.target.value }))} />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Notes (optional)</label>
              <input className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" placeholder="e.g. OT, playoff game, mercy rule…" value={scoresForm.notes} onChange={e => setScoresForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <button
              disabled={!canOperateOps || !scoresForm.homeLabel || !scoresForm.awayLabel || scoreManualMutation.isPending}
              className="w-full gold-bg py-2.5 font-display font-bold text-sm uppercase tracking-wider rounded-sm disabled:opacity-50 transition-opacity"
              onClick={() => scoreManualMutation.mutate()}
            >
              {scoreManualMutation.isPending ? 'Saving…' : 'Save Score'}
            </button>
            {scoreManualMutation.error && <p className="text-xs text-destructive">{(scoreManualMutation.error as Error).message}</p>}
            {scoreManualMutation.isSuccess && <p className="text-xs text-success">Score saved — game ID: {scoreManualMutation.data?.gameId?.slice(0, 8)}</p>}
          </div>

          {/* ── CSV bulk import ───────────────────────────────────── */}
          <OpsCsvImportSection
            kind="scores"
            csvUpload={csvUpload}
            csvLeagueId={csvLeagueId}
            setCsvLeagueId={setCsvLeagueId}
            canOperate={canOperateOps}
          />

          {/* ── Recent scores list ────────────────────────────────── */}
          <div className="panel p-4 max-w-4xl">
            <h2 className="font-display text-xl mb-3">Recent Scores</h2>
            {scoresQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!scoresQuery.isLoading && (scoresQuery.data?.games ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No scores yet. Add them above or import a CSV.</p>
            )}
            <div className="space-y-2 max-h-96 overflow-auto pr-1">
              {(scoresQuery.data?.games ?? []).slice(0, 20).map(g => (
                <div key={g.id} className="border border-border rounded-sm p-3 text-xs flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase ${g.category === 'league' ? 'bg-blue-500/15 text-blue-400' : g.category === '1v1' ? 'bg-purple-500/15 text-purple-400' : 'bg-amber-500/15 text-amber-400'}`}>
                      {g.category === '1v1' ? '1v1' : g.category === 'special_event' ? 'Event' : (g.leagueCode ?? g.leagueId ?? 'LGE').toUpperCase()}
                    </span>
                    <span className="truncate font-medium">{g.awayLabel} vs {g.homeLabel}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="stat-numeral text-sm">{g.awayScore ?? '—'} – {g.homeScore ?? '—'}</span>
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-sm ${g.status === 'final' ? 'text-green-400 bg-green-500/10' : g.status === 'live' ? 'text-red-400 bg-red-500/15' : 'text-muted-foreground bg-secondary'}`}>{g.status}</span>
                    {g.gameDate && <span className="text-muted-foreground">{new Date(g.gameDate).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div></section>)}

      {activeTab === 'scoreboard' && (() => {
        const leagueUuid = leagueUuidForSlug(leaguesRef, scoreboardLeague);
        const leagueTeams = leagueUuid ? teamsList.filter((t) => t.league_id === leagueUuid) : teamsList;
        const leagueScores = scoresList.filter((g) => !g.leagueId || g.leagueId === scoreboardLeague);
        const liveScores = leagueScores.filter((g) => g.status === 'live');
        const scheduledScores = leagueScores.filter((g) => g.status === 'upcoming');
        const finalScores = leagueScores.filter((g) => g.status === 'final');
        const selectedGame = scoresList.find((g) => g.id === scoreboardGameId);

        return (
          <section id="scoreboard" className="space-y-6 pt-6 font-['Space_Grotesk']">
            {/* ── Top Header ──────────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#222222] pb-3">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2 text-[#F5F5F0]">
                  <Shield className="w-6 h-6 text-[#C9A84C]" /> Live Tabulation Scoreboard
                </h2>
                <p className="text-xs text-[#8A8A8A] mt-0.5">
                  1-Click match setup, real-time courtside scoring, player box scores & live projected standings.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickGameLauncher((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-md ${
                    showQuickGameLauncher
                      ? 'bg-[#1F1F1F] border border-[#333333] text-[#F5F5F0]'
                      : 'bg-[#C9A84C] text-[#0A0A0A] hover:bg-[#E8C76A]'
                  }`}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {showQuickGameLauncher ? 'Close Launcher' : '⚡ Start New Match'}
                </button>
                {scoreboardGameId && (
                  <>
                    <Link
                      to={`/scorekeeper/${scoreboardGameId}`}
                      className="rounded-lg bg-[#1F1F1F] border border-[#333333] px-3 py-1.5 text-xs font-bold text-[#F5F5F0] hover:bg-[#2A2A2A] transition-colors flex items-center gap-1"
                    >
                      <Radio className="h-3.5 w-3.5 text-[#C9A84C]" />
                      Courtside Scorekeeper
                    </Link>
                    <Link
                      to={`/ops/scoreboard/${scoreboardGameId}`}
                      className="rounded-lg bg-[#1F1F1F] border border-[#333333] px-3 py-1.5 text-xs font-bold text-[#F5F5F0] hover:bg-[#2A2A2A] transition-colors"
                    >
                      Fullscreen Monitor →
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* ── League & Match Controls ─────────────────────────────────────────── */}
            <div className="rounded-xl border border-[#222222] bg-[#111111] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-wider">League:</span>
                  <div className="flex gap-1">
                    {LEAGUE_REGISTRY.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          setScoreboardLeague(l.id);
                          setScoreboardGameId('');
                        }}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                          scoreboardLeague === l.id
                            ? 'bg-[#C9A84C] text-[#0A0A0A]'
                            : 'bg-[#1A1A1A] text-[#8A8A8A] hover:text-[#F5F5F0]'
                        }`}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
                  <span className="text-xs font-semibold text-[#8A8A8A] uppercase tracking-wider">Game:</span>
                  <select
                    value={scoreboardGameId}
                    onChange={(e) => setScoreboardGameId(e.target.value)}
                    className="flex-1 rounded-md border border-[#262626] bg-[#181818] px-3 py-1.5 text-xs font-medium text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">Select a game to score / monitor...</option>
                    {liveScores.length > 0 && (
                      <optgroup label={`🔴 LIVE MATCHES (${liveScores.length})`}>
                        {liveScores.map((g) => (
                          <option key={g.id} value={g.id}>
                            🔴 {g.awayLabel} {g.awayScore ?? 0} - {g.homeScore ?? 0} {g.homeLabel}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {scheduledScores.length > 0 && (
                      <optgroup label={`⏰ SCHEDULED / UPCOMING (${scheduledScores.length})`}>
                        {scheduledScores.map((g) => (
                          <option key={g.id} value={g.id}>
                            ⏰ {g.awayLabel} vs {g.homeLabel}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {finalScores.length > 0 && (
                      <optgroup label={`🏁 COMPLETED MATCHES (${finalScores.length})`}>
                        {finalScores.slice(0, 15).map((g) => (
                          <option key={g.id} value={g.id}>
                            🏁 {g.awayLabel} {g.awayScore ?? 0} - {g.homeScore ?? 0} {g.homeLabel} (FINAL)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>

              {/* 🔴 Active Live Matches Quick Badges */}
              {liveScores.length > 0 && (
                <div className="pt-2 border-t border-[#1F1F1F] flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#E63946] flex items-center gap-1">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                    Live Now:
                  </span>
                  {liveScores.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setScoreboardGameId(g.id)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all ${
                        scoreboardGameId === g.id
                          ? 'border-[#C9A84C] bg-[#C9A84C]/20 text-[#C9A84C]'
                          : 'border-[#333333] bg-[#181818] text-[#F5F5F0] hover:border-[#C9A84C]/60'
                      }`}
                    >
                      {g.awayLabel} {g.awayScore ?? 0} - {g.homeScore ?? 0} {g.homeLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── ⚡ 1-Click Game Launcher Panel ─────────────────────────────────── */}
            {(showQuickGameLauncher || !scoreboardGameId) && (
              <div className="rounded-xl border border-[#C9A84C]/40 bg-gradient-to-b from-[#181818] to-[#111111] p-5 shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-[#222222] pb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-[#C9A84C]" />
                    <h3 className="text-base font-bold text-[#F5F5F0]">1-Click Game Setup & Live Scoring Launch</h3>
                  </div>
                  <span className="text-[11px] font-semibold text-[#C9A84C] bg-[#C9A84C]/10 px-2 py-0.5 rounded-full">
                    NO EXTRA STEPS · INSTANT TABULATION
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Away Team */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#8A8A8A]">
                      Away Team (Visitor) *
                    </label>
                    {leagueTeams.length > 0 ? (
                      <div className="space-y-1.5">
                        <select
                          aria-label="Select Away Team"
                          value={quickAwayTeam}
                          onChange={(e) => setQuickAwayTeam(e.target.value)}
                          className="w-full rounded-lg border border-[#333333] bg-[#181818] px-3 py-2 text-sm text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
                        >
                          <option value="">Select team from {LEAGUE_REGISTRY.find(l => l.id === scoreboardLeague)?.name}...</option>
                          {leagueTeams.map((t) => (
                            <option key={t.id} value={t.name}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Or type custom away team..."
                          value={quickAwayTeam}
                          onChange={(e) => setQuickAwayTeam(e.target.value)}
                          className="w-full rounded-lg border border-[#262626] bg-[#141414] px-3 py-1.5 text-xs text-[#F5F5F0] placeholder-[#666666] focus:border-[#C9A84C] focus:outline-none"
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="e.g. Away Ballers"
                        value={quickAwayTeam}
                        onChange={(e) => setQuickAwayTeam(e.target.value)}
                        className="w-full rounded-lg border border-[#333333] bg-[#181818] px-3 py-2 text-sm text-[#F5F5F0] placeholder-[#666666] focus:border-[#C9A84C] focus:outline-none"
                      />
                    )}
                  </div>

                  {/* Home Team */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-[#8A8A8A]">
                      Home Team (Host) *
                    </label>
                    {leagueTeams.length > 0 ? (
                      <div className="space-y-1.5">
                        <select
                          aria-label="Select Home Team"
                          value={quickHomeTeam}
                          onChange={(e) => setQuickHomeTeam(e.target.value)}
                          className="w-full rounded-lg border border-[#333333] bg-[#181818] px-3 py-2 text-sm text-[#F5F5F0] focus:border-[#C9A84C] focus:outline-none"
                        >
                          <option value="">Select team from {LEAGUE_REGISTRY.find(l => l.id === scoreboardLeague)?.name}...</option>
                          {leagueTeams.map((t) => (
                            <option key={t.id} value={t.name}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Or type custom home team..."
                          value={quickHomeTeam}
                          onChange={(e) => setQuickHomeTeam(e.target.value)}
                          className="w-full rounded-lg border border-[#262626] bg-[#141414] px-3 py-1.5 text-xs text-[#F5F5F0] placeholder-[#666666] focus:border-[#C9A84C] focus:outline-none"
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="e.g. Home Shooters"
                        value={quickHomeTeam}
                        onChange={(e) => setQuickHomeTeam(e.target.value)}
                        className="w-full rounded-lg border border-[#333333] bg-[#181818] px-3 py-2 text-sm text-[#F5F5F0] placeholder-[#666666] focus:border-[#C9A84C] focus:outline-none"
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#8A8A8A]">Game Status:</span>
                    <div className="flex rounded-lg bg-[#141414] p-0.5 border border-[#262626]">
                      <button
                        type="button"
                        onClick={() => setQuickGameStatus('live')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                          quickGameStatus === 'live' ? 'bg-[#E63946] text-white' : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
                        }`}
                      >
                        🔴 Live Now
                      </button>
                      <button
                        type="button"
                        onClick={() => setQuickGameStatus('upcoming')}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                          quickGameStatus === 'upcoming' ? 'bg-[#C9A84C] text-[#0A0A0A]' : 'text-[#8A8A8A] hover:text-[#F5F5F0]'
                        }`}
                      >
                        ⏰ Scheduled
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={launchQuickGameMutation.isPending || !quickAwayTeam.trim() || !quickHomeTeam.trim()}
                    onClick={() => launchQuickGameMutation.mutate()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#C9A84C] px-5 py-2.5 text-sm font-bold text-[#0A0A0A] hover:bg-[#E8C76A] active:scale-95 transition-all shadow-lg disabled:opacity-50"
                  >
                    {launchQuickGameMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Launching...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" /> ⚡ Launch Game & Start Scoring Now
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── Live Tabulation Scoreboard & Controls ───────────────────────────── */}
            {scoreboardGameId && (
              <div className="space-y-6">
                <LiveScoreboard
                  gameId={scoreboardGameId}
                  homeTeamName={selectedGame?.homeLabel ?? 'Home'}
                  awayTeamName={selectedGame?.awayLabel ?? 'Away'}
                  className="shadow-2xl"
                />
                <CourtsideQuickControls
                  gameId={scoreboardGameId}
                  homeTeamName={selectedGame?.homeLabel ?? 'Home'}
                  awayTeamName={selectedGame?.awayLabel ?? 'Away'}
                  overlayState={opsTabOverlayQuery.data?.overlay ?? null}
                  onMutationSuccess={() => {
                    opsTabOverlayQuery.refetch();
                  }}
                />
                <PlayerStatsTracker
                  gameId={scoreboardGameId}
                  onStatChange={() => {
                    opsTabOverlayQuery.refetch();
                  }}
                />
              </div>
            )}
          </section>
        );
      })()}

      {activeTab === 'teams' && (<section id="teams" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Teams</h2><div className="space-y-4">
          <OpsCsvImportSection
            kind="teams"
            csvUpload={csvUpload}
            csvLeagueId={csvLeagueId}
            setCsvLeagueId={setCsvLeagueId}
            canOperate={canOperateOps}
          />
<div className="panel p-4 max-w-xl">
          <h2 className="font-display text-xl mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Teams Manual Ops</h2>
          {!canOperateOps ? (
            <p className="text-sm text-destructive font-semibold">League Admin role or higher required to manually manage teams.</p>
          ) : (
            <div className="space-y-4">
              <div className="border border-border p-3 rounded-sm">
                <h3 className="text-sm font-semibold mb-2">Create Team</h3>
                <div className="space-y-2">
                  <input placeholder="Team Name *" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={teamForm.name} onChange={e => setTeamForm(f => ({ ...f, name: e.target.value }))} />
                  <LeagueSelect
                    value={teamForm.leagueId}
                    onChange={(slug) => setTeamForm(f => ({ ...f, leagueId: slug, seasonId: '', divisionId: '' }))}
                  />
                  <SeasonSelect
                    seasons={seasonsRef}
                    leagues={leaguesRef}
                    leagueSlug={teamForm.leagueId}
                    value={teamForm.seasonId}
                    onChange={(id) => setTeamForm(f => ({ ...f, seasonId: id, divisionId: '' }))}
                  />
                  <DivisionSelect
                    divisions={divisionsRef}
                    seasonId={teamForm.seasonId}
                    value={teamForm.divisionId}
                    onChange={(id) => setTeamForm(f => ({ ...f, divisionId: id }))}
                  />
                  <button disabled={!teamForm.name || !teamForm.leagueId || !teamForm.seasonId || createTeamMutation.isPending} className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60" onClick={() => createTeamMutation.mutate()}>{createTeamMutation.isPending ? 'Creating…' : 'Create Team'}</button>
                  {createTeamMutation.error && <p className="text-xs text-destructive">{(createTeamMutation.error as Error).message}</p>}
                  {createTeamMutation.isSuccess && <p className="text-xs text-success">Team created.</p>}
                </div>
              </div>
              <div className="border border-destructive/20 p-3 rounded-sm bg-destructive/5">
                <h3 className="text-sm font-semibold text-destructive mb-2">Delete Team</h3>
                <div className="flex gap-2">
                  <TeamSelect
                    teams={teamsList}
                    leagues={leaguesRef}
                    value={deleteTeamId}
                    onChange={setDeleteTeamId}
                    placeholder="Select team to delete"
                  />
                  <button disabled={!deleteTeamId || deleteTeamMutation.isPending} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground px-4 py-2 rounded-sm text-xs disabled:opacity-60" onClick={() => deleteTeamMutation.mutate()}>{deleteTeamMutation.isPending ? '…' : 'Delete'}</button>
                </div>
                {deleteTeamMutation.error && <p className="text-xs text-destructive mt-1">{(deleteTeamMutation.error as Error).message}</p>}
                {deleteTeamMutation.isSuccess && <p className="text-xs text-success mt-1">Team archived.</p>}
              </div>
            </div>
          )}
        </div>
      </div></section>)}

      {activeTab === 'players' && (<section id="players" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Players</h2><div className="space-y-4">
          <OpsCsvImportSection
            kind="players"
            csvUpload={csvUpload}
            csvLeagueId={csvLeagueId}
            setCsvLeagueId={setCsvLeagueId}
            canOperate={canOperateOps}
          />
<div className="panel p-4 max-w-xl">
          <h2 className="font-display text-xl mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Players Manual Ops</h2>
          {!canOperateOps ? (
            <p className="text-sm text-destructive font-semibold">League Admin role or higher required to manually manage players.</p>
          ) : (
            <div className="space-y-4">
              <div className="border border-border p-3 rounded-sm">
                <h3 className="text-sm font-semibold mb-2">Create Player</h3>
                <p className="text-xs text-muted-foreground mb-2">Finds an existing player by name, or registers a new one — same lookup Roster Import uses. No account ID needed.</p>
                <div className="space-y-2">
                  <input placeholder="Player Name *" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={playerForm.name} onChange={e => setPlayerForm(f => ({ ...f, name: e.target.value }))} />
                  <LeagueSelect
                    value={playerForm.leagueId}
                    onChange={(slug) => setPlayerForm(f => ({ ...f, leagueId: slug, teamId: '' }))}
                  />
                  <TeamSelect
                    teams={teamsList}
                    leagues={leaguesRef}
                    leagueSlug={playerForm.leagueId}
                    value={playerForm.teamId}
                    onChange={(id) => setPlayerForm(f => ({ ...f, teamId: id }))}
                    placeholder="Team (optional)"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Jersey #" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={playerForm.jerseyNumber} onChange={e => setPlayerForm(f => ({ ...f, jerseyNumber: e.target.value }))} />
                    <input placeholder="Position" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={playerForm.position} onChange={e => setPlayerForm(f => ({ ...f, position: e.target.value }))} />
                  </div>
                  <button disabled={!playerForm.name || !playerForm.leagueId || createPlayerMutation.isPending} className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60" onClick={() => createPlayerMutation.mutate()}>{createPlayerMutation.isPending ? 'Creating…' : 'Create Player'}</button>
                  {createPlayerMutation.error && <p className="text-xs text-destructive">{(createPlayerMutation.error as Error).message}</p>}
                  {createPlayerMutation.isSuccess && <p className="text-xs text-success">Player created.</p>}
                </div>
              </div>
              <div className="border border-warning/20 p-3 rounded-sm bg-warning/5">
                <h3 className="text-sm font-semibold text-warning mb-2">Suspend Player</h3>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <PlayerSelect players={playersList} value={suspendPlayerId} onChange={setSuspendPlayerId} placeholder="Select player to suspend" />
                    <button disabled={!suspendPlayerId || suspendPlayerMutation.isPending} className="bg-warning hover:bg-warning/90 text-warning-foreground px-4 py-2 rounded-sm text-xs text-black disabled:opacity-60" onClick={() => suspendPlayerMutation.mutate()}>{suspendPlayerMutation.isPending ? '…' : 'Suspend'}</button>
                  </div>
                  <input placeholder="Reason (optional)" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={suspendPlayerReason} onChange={e => setSuspendPlayerReason(e.target.value)} />
                  {suspendPlayerMutation.error && <p className="text-xs text-destructive">{(suspendPlayerMutation.error as Error).message}</p>}
                  {suspendPlayerMutation.isSuccess && <p className="text-xs text-success">Player suspended.</p>}
                </div>
              </div>
              <div className="border border-primary/20 p-3 rounded-sm bg-primary/5">
                <h3 className="text-sm font-semibold text-primary mb-2">Merge Player Identities</h3>
                <p className="text-xs text-muted-foreground mb-2">Point a duplicate (e.g. auto-registered from a POTG upload) at the real player. Stats move to the target; nothing is deleted.</p>
                <div className="space-y-2">
                  <PlayerSelect players={playersList} value={mergeSourceId} onChange={setMergeSourceId} placeholder="Duplicate player (source)" />
                  <PlayerSelect players={playersList} value={mergeTargetId} onChange={setMergeTargetId} placeholder="Canonical player (target)" />
                  <button disabled={!mergeSourceId.trim() || !mergeTargetId.trim() || mergeMutation.isPending} className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60" onClick={() => mergeMutation.mutate()}>{mergeMutation.isPending ? 'Merging…' : 'Merge Identities'}</button>
                  {mergeMutation.error && <p className="text-xs text-destructive">{(mergeMutation.error as Error).message}</p>}
                  {mergeMutation.isSuccess && <p className="text-xs text-success">{mergeMutation.data?.message}</p>}
                </div>
              </div>
              <div className="border border-destructive/20 p-3 rounded-sm bg-destructive/5">
                <h3 className="text-sm font-semibold text-destructive mb-2">Delete Player</h3>
                <div className="flex gap-2">
                  <PlayerSelect players={playersList} value={deletePlayerId} onChange={setDeletePlayerId} placeholder="Select player to delete" />
                  <button disabled={!deletePlayerId || deletePlayerMutation.isPending} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground px-4 py-2 rounded-sm text-xs disabled:opacity-60" onClick={() => deletePlayerMutation.mutate()}>{deletePlayerMutation.isPending ? '…' : 'Delete'}</button>
                </div>
                {deletePlayerMutation.error && <p className="text-xs text-destructive mt-1">{(deletePlayerMutation.error as Error).message}</p>}
                {deletePlayerMutation.isSuccess && <p className="text-xs text-success mt-1">Player deleted.</p>}
              </div>
            </div>
          )}
        </div>
      </div></section>)}


      {activeTab === 'schedules' && (<section id="schedules" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Schedules</h2><div className="space-y-4">
          <OpsCsvImportSection
            kind="schedules"
            csvUpload={csvUpload}
            csvLeagueId={csvLeagueId}
            setCsvLeagueId={setCsvLeagueId}
            canOperate={canOperateOps}
          />
<div className="panel p-4 max-w-xl">
          <h2 className="font-display text-xl mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Schedules Manual Ops</h2>
          {!canOperateOps ? (
            <p className="text-sm text-destructive font-semibold">League Admin role or higher required to manually manage schedules.</p>
          ) : (
            <div className="space-y-4">
              <div className="border border-border p-3 rounded-sm">
                <h3 className="text-sm font-semibold mb-2">Create Schedule Slot</h3>
                <div className="space-y-2">
                  <LeagueSelect
                    value={scheduleForm.leagueId}
                    onChange={(slug) => setScheduleForm(f => ({ ...f, leagueId: slug, seasonId: '' }))}
                  />
                  <SeasonSelect
                    seasons={seasonsRef}
                    leagues={leaguesRef}
                    leagueSlug={scheduleForm.leagueId}
                    value={scheduleForm.seasonId}
                    onChange={(id) => setScheduleForm(f => ({ ...f, seasonId: id }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Starts At *</label>
                      <input type="datetime-local" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm mt-1" value={scheduleForm.startsAt} onChange={e => setScheduleForm(f => ({ ...f, startsAt: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Ends At</label>
                      <input type="datetime-local" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm mt-1" value={scheduleForm.endsAt} onChange={e => setScheduleForm(f => ({ ...f, endsAt: e.target.value }))} />
                    </div>
                  </div>
                  <button disabled={!scheduleForm.leagueId || !scheduleForm.seasonId || !scheduleForm.startsAt || createScheduleMutation.isPending} className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60" onClick={() => createScheduleMutation.mutate()}>{createScheduleMutation.isPending ? 'Creating…' : 'Create Schedule'}</button>
                  {createScheduleMutation.error && <p className="text-xs text-destructive">{(createScheduleMutation.error as Error).message}</p>}
                  {createScheduleMutation.isSuccess && <p className="text-xs text-success">Schedule slot created.</p>}
                </div>
              </div>
              <div className="border border-destructive/20 p-3 rounded-sm bg-destructive/5">
                <h3 className="text-sm font-semibold text-destructive mb-2">Delete Schedule Entry</h3>
                <div className="flex gap-2">
                  <ScheduleSelect schedules={schedulesList} value={deleteScheduleId} onChange={setDeleteScheduleId} placeholder="Select schedule entry to delete" />
                  <button disabled={!deleteScheduleId || deleteScheduleMutation.isPending} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground px-4 py-2 rounded-sm text-xs disabled:opacity-60" onClick={() => deleteScheduleMutation.mutate()}>{deleteScheduleMutation.isPending ? '…' : 'Delete'}</button>
                </div>
                {deleteScheduleMutation.error && <p className="text-xs text-destructive mt-1">{(deleteScheduleMutation.error as Error).message}</p>}
                {deleteScheduleMutation.isSuccess && <p className="text-xs text-success mt-1">Schedule slot deleted.</p>}
              </div>
            </div>
          )}
        </div>
      </div></section>)}

      {activeTab === 'events' && (<section id="events" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Events</h2><div className="space-y-4">
          <OpsCsvImportSection
            kind="events"
            csvUpload={csvUpload}
            csvLeagueId={csvLeagueId}
            setCsvLeagueId={setCsvLeagueId}
            canOperate={canOperateOps}
          />
<div className="panel p-4 max-w-xl">
          <h2 className="font-display text-xl mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Events Manual Ops</h2>
          {!canOperateOps ? (
            <p className="text-sm text-destructive font-semibold">League Admin role or higher required to manually manage events.</p>
          ) : (
            <div className="space-y-4">
              <div className="border border-border p-3 rounded-sm">
                <h3 className="text-sm font-semibold mb-2">Create Event</h3>
                <div className="space-y-2">
                  <input placeholder="Event Title *" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={eventForm.title} onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))} />
                  <input placeholder="Location (optional)" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={eventForm.location} onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))} />
                  <LeagueSelect allowNone value={eventForm.leagueId} onChange={(slug) => setEventForm(f => ({ ...f, leagueId: slug }))} />
                  <input type="date" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={eventForm.date} onChange={e => setEventForm(f => ({ ...f, date: e.target.value }))} />
                  <button disabled={!eventForm.title || createEventMutation.isPending} className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60" onClick={() => createEventMutation.mutate()}>{createEventMutation.isPending ? 'Creating…' : 'Create Event'}</button>
                  {createEventMutation.error && <p className="text-xs text-destructive">{(createEventMutation.error as Error).message}</p>}
                  {createEventMutation.isSuccess && <p className="text-xs text-success">Event created.</p>}
                </div>
              </div>

              <div className="border border-border p-3 rounded-sm mt-6 mb-4">
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-primary" />
                  Event Graphic Parser
                </h3>
                <p className="text-xs text-muted-foreground mb-4">Upload a flyer/graphic to automatically extract event details.</p>

                <div
                  className="border-2 border-dashed border-border rounded-sm p-6 text-center cursor-pointer hover:border-primary/40 transition-colors mb-4"
                  onClick={() => eventFileRef.current?.click()}
                  onDragOver={(e: React.DragEvent) => e.preventDefault()}
                  onDrop={(e: React.DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { void handleEventImageUpload(f); } }}
                >
                  <input ref={eventFileRef} type="file" accept="image/*" className="hidden" onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { void handleEventImageUpload(f); } }} />
                  {eventParseState === 'parsing' ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
                      <p className="text-sm text-muted-foreground">Extracting event details…</p>
                    </div>
                  ) : eventParseState === 'parsed' ? (
                    <div className="flex flex-col items-center gap-1">
                      <CheckCircle2 className="w-5 h-5 text-success" />
                      <p className="text-xs text-success font-medium">Extracted successfully</p>
                      <p className="text-[10px] text-muted-foreground">Review fields below</p>
                    </div>
                  ) : eventParseState === 'error' ? (
                    <div className="flex flex-col items-center gap-1">
                      <AlertCircle className="w-5 h-5 text-destructive" />
                      <p className="text-xs text-destructive">{eventParseError}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-6 h-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Drop flyer image or click to upload</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2 bg-secondary/30 p-3 rounded-sm border border-border">
                  <input placeholder="Event Title *" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={eventGraphicForm.title} onChange={(e) => setEventGraphicForm(f => ({ ...f, title: e.target.value }))} />
                  <input placeholder="Location" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={eventGraphicForm.location} onChange={(e) => setEventGraphicForm(f => ({ ...f, location: e.target.value }))} />
                  <LeagueSelect allowNone value={eventGraphicForm.leagueId} onChange={(slug) => setEventGraphicForm(f => ({ ...f, leagueId: slug }))} />
                  <input placeholder="Date / Time" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={eventGraphicForm.date} onChange={(e) => setEventGraphicForm(f => ({ ...f, date: e.target.value }))} />
                  <button
                    disabled={!eventGraphicForm.title || createEventMutation.isPending || eventMediaMutation.isPending}
                    className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60 flex justify-center items-center gap-2"
                    onClick={() => {
                      setEventForm({
                        title: eventGraphicForm.title,
                        location: eventGraphicForm.location,
                        date: eventGraphicForm.date,
                        leagueId: eventGraphicForm.leagueId,
                      });
                      setTimeout(() => {
                        createEventMutation.mutate();
                        if (eventResizedBlob) eventMediaMutation.mutate();
                      }, 0);
                    }}
                  >
                    {(createEventMutation.isPending || eventMediaMutation.isPending) ? 'Publishing…' : 'Create Event & Publish to Media'}
                  </button>
                  {eventMediaMutation.isSuccess && eventMediaMutation.data && (
                    <p className="text-xs text-success">✓ Event graphic published to Media page</p>
                  )}
                  {eventMediaMutation.error && (
                    <p className="text-xs text-destructive">{(eventMediaMutation.error as Error).message}</p>
                  )}
                </div>
              </div>
              <div className="border border-destructive/20 p-3 rounded-sm bg-destructive/5">
                <h3 className="text-sm font-semibold text-destructive mb-2">Delete Event</h3>
                <div className="flex gap-2">
                  <EventSelect events={eventsList} value={deleteEventId} onChange={setDeleteEventId} placeholder="Select event to delete" />
                  <button disabled={!deleteEventId || deleteEventMutation.isPending} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground px-4 py-2 rounded-sm text-xs disabled:opacity-60" onClick={() => deleteEventMutation.mutate()}>{deleteEventMutation.isPending ? '…' : 'Delete'}</button>
                </div>
                {deleteEventMutation.error && <p className="text-xs text-destructive mt-1">{(deleteEventMutation.error as Error).message}</p>}
                {deleteEventMutation.isSuccess && <p className="text-xs text-success mt-1">Event archived.</p>}
              </div>
            </div>
          )}
        </div>
      </div></section>)}

      {activeTab === 'store' && isSuperAdmin && (<section id="store" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Store Catalog</h2><div className="space-y-4"><div className="panel p-4 max-w-xl space-y-8">
          <div>
            <h2 className="font-display text-xl mb-4 flex items-center gap-2"><Shield className="w-5 h-5 text-primary" /> Store Media & Product Ops</h2>
            {!isSuperAdmin ? (
              <p className="text-sm text-destructive font-semibold">Super Admin role required to manage store media and products.</p>
            ) : (
              <div className="space-y-6">

                {/* Batch Create Products */}
                <div className="border border-border p-3 rounded-sm">
                  <h3 className="text-sm font-semibold mb-3">Batch Create Products (Max 4)</h3>
                  <div className="space-y-4">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className="border border-secondary p-3 rounded-sm space-y-2 relative">
                        <div className="absolute top-2 right-2 text-[10px] text-muted-foreground font-semibold">Item {i+1}</div>
                        <input placeholder="Title" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={storeBatchItems[i].title} onChange={e => updateStoreBatchItem(i, 'title', e.target.value)} />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" placeholder="Price (CAD)" className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={storeBatchItems[i].price} onChange={e => updateStoreBatchItem(i, 'price', e.target.value)} />
                        </div>
                        <select className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={storeBatchItems[i].category} onChange={e => updateStoreBatchItem(i, 'category', e.target.value)}>
                          <option value="apparel">Apparel</option>
                          <option value="accessories">Accessories</option>
                          <option value="rewards">Rewards</option>
                        </select>
                      </div>
                    ))}
                    <button disabled={storeBatchItems.every(it => !it.title.trim()) || storeBatchMutation.isPending} className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60" onClick={() => storeBatchMutation.mutate()}>{storeBatchMutation.isPending ? 'Submitting…' : 'Submit Batch'}</button>
                    {storeBatchMutation.error && <p className="text-xs text-destructive">{(storeBatchMutation.error as Error).message}</p>}
                    {storeBatchMutation.isSuccess && <p className="text-xs text-success">Products created.</p>}
                  </div>
                </div>

                {/* Upload Store Product with Image */}
                <div className="border border-primary/30 p-3 rounded-sm bg-primary/5">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Upload className="w-4 h-4 text-primary" /> Upload Store Product with Image
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">Creates the product AND publishes the image to the Store Media surface.</p>
                  <div className="space-y-2">
                    <input
                      placeholder="Product Title *"
                      className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
                      value={storeForm.title}
                      onChange={e => setStoreForm(f => ({ ...f, title: e.target.value }))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        placeholder="Price (CAD) *"
                        className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
                        value={storeForm.price}
                        onChange={e => setStoreForm(f => ({ ...f, price: e.target.value }))}
                      />
                      <select
                        className="w-full bg-secondary border border-border rounded-sm px-3 py-2 text-sm"
                        value={storeForm.category}
                        onChange={e => setStoreForm(f => ({ ...f, category: e.target.value }))}
                      >
                        <option value="apparel">Apparel</option>
                        <option value="accessories">Accessories</option>
                        <option value="rewards">Rewards</option>
                      </select>
                    </div>
                    <div className="flex gap-4 items-center">
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={storeForm.sale} onChange={e => setStoreForm(f => ({ ...f, sale: e.target.checked }))} />
                        On Sale
                      </label>
                      <select
                        className="bg-secondary border border-border rounded-sm px-3 py-1.5 text-xs"
                        value={storeForm.publishStatus}
                        onChange={e => setStoreForm(f => ({ ...f, publishStatus: e.target.value as 'draft' | 'published' }))}
                      >
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </select>
                    </div>
                    <div
                      className="border-2 border-dashed border-border rounded-sm p-4 text-center cursor-pointer hover:border-primary/40 transition-colors"
                      onClick={() => document.getElementById('store-image-input')?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setStoreForm(prev => ({ ...prev, imageFile: f })); }}
                    >
                      <input
                        id="store-image-input"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) setStoreForm(prev => ({ ...prev, imageFile: f })); }}
                      />
                      {storeForm.imageFile ? (
                        <p className="text-xs text-success font-medium">✓ {storeForm.imageFile.name}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Drop product image or click to select (PNG/JPG)</p>
                      )}
                    </div>
                    <button
                      disabled={!storeForm.title || !storeForm.imageFile || storeMutation.isPending}
                      className="gold-bg px-4 py-2 rounded-sm text-xs w-full disabled:opacity-60"
                      onClick={() => storeMutation.mutate()}
                    >
                      {storeMutation.isPending ? 'Uploading & Creating…' : 'Upload & Create Product'}
                    </button>
                    {storeMutation.error && <p className="text-xs text-destructive">{(storeMutation.error as Error).message}</p>}
                    {storeMutation.isSuccess && <p className="text-xs text-success">✓ Product created and image published to store.</p>}
                  </div>
                </div>

                {/* Manage Products */}
                <div className="border border-border p-3 rounded-sm">
                  <h3 className="text-sm font-semibold mb-2">Manage Products</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="border border-warning/20 p-3 rounded-sm bg-warning/5">
                      <h4 className="text-[10px] font-semibold text-warning mb-2 uppercase tracking-widest">Suspend</h4>
                      <input placeholder="Product ID" className="w-full bg-secondary border border-border rounded-sm px-3 py-1.5 text-xs mb-2" value={storeSuspendId} onChange={e => setStoreSuspendId(e.target.value)} />
                      <button disabled={!storeSuspendId || storeSuspendMutation.isPending} className="bg-warning hover:bg-warning/90 text-warning-foreground px-3 py-1.5 rounded-sm text-[10px] w-full text-black disabled:opacity-60" onClick={() => storeSuspendMutation.mutate()}>{storeSuspendMutation.isPending ? '…' : 'Suspend'}</button>
                      {storeSuspendMutation.error && <p className="text-[10px] text-destructive mt-1">{(storeSuspendMutation.error as Error).message}</p>}
                      {storeSuspendMutation.isSuccess && <p className="text-[10px] text-success mt-1">Product suspended.</p>}
                    </div>
                    <div className="border border-destructive/20 p-3 rounded-sm bg-destructive/5">
                      <h4 className="text-[10px] font-semibold text-destructive mb-2 uppercase tracking-widest">Delete</h4>
                      <input placeholder="Product ID" className="w-full bg-secondary border border-border rounded-sm px-3 py-1.5 text-xs mb-2" value={storeDeleteId} onChange={e => setStoreDeleteId(e.target.value)} />
                      <button disabled={!storeDeleteId || storeDeleteMutation.isPending} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground px-3 py-1.5 rounded-sm text-[10px] w-full disabled:opacity-60" onClick={() => storeDeleteMutation.mutate()}>{storeDeleteMutation.isPending ? '…' : 'Delete'}</button>
                      {storeDeleteMutation.error && <p className="text-[10px] text-destructive mt-1">{(storeDeleteMutation.error as Error).message}</p>}
                      {storeDeleteMutation.isSuccess && <p className="text-[10px] text-success mt-1">Product archived.</p>}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      </div></section>)}
      {activeTab === 'potg' && (<section id="potg" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">POTG Parser</h2><div className="space-y-4"><div className="panel p-4 space-y-5 max-w-xl">
          <div>
            <h2 className="font-display text-xl">POTG Image Parser</h2>
            <p className="text-xs text-muted-foreground mt-1">Upload a Player of the Game graphic — AI vision extracts the data automatically, then you confirm before it writes to the pipeline.</p>
          </div>

          {/* Image drop zone */}
          <div
            className="border-2 border-dashed border-border rounded-sm p-6 text-center cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => potgFileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handlePotgImageUpload(f); }}
          >
            <input ref={potgFileRef} id="potg-image-input" type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handlePotgImageUpload(f); }} />
            {potgParseState === 'parsing' ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Parsing with AI vision…</p>
              </div>
            ) : potgParseState === 'parsed' ? (
              <div className="flex flex-col items-center gap-1">
                <CheckCircle2 className="w-5 h-5 text-success" />
                <p className="text-xs text-success font-medium">Data extracted — review below</p>
                <p className="text-[10px] text-muted-foreground">Click to parse another image</p>
              </div>
            ) : potgParseState === 'error' ? (
              <div className="flex flex-col items-center gap-1">
                <AlertCircle className="w-5 h-5 text-destructive" />
                <p className="text-xs text-destructive">{potgParseError}</p>
                <p className="text-[10px] text-muted-foreground">Fill in fields manually below</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-6 h-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Drop POTG graphic or click to upload</p>
                <p className="text-[10px] text-muted-foreground">PNG, JPG — Claude reads PTS / REB / AST / player name / team / game result</p>
              </div>
            )}
          </div>

          {/* Editable parsed fields */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Player Name</label>
                <input className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.playerName} onChange={e => setPotgForm(f => ({ ...f, playerName: e.target.value }))} placeholder="e.g. Michael Ramos" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Team</label>
                <input className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.team} onChange={e => setPotgForm(f => ({ ...f, team: e.target.value }))} placeholder="e.g. Ball is Life" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">PTS</label>
                <input type="number" className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.pts} onChange={e => setPotgForm(f => ({ ...f, pts: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">REB</label>
                <input type="number" className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.rebs} onChange={e => setPotgForm(f => ({ ...f, rebs: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">AST</label>
                <input type="number" className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.assts} onChange={e => setPotgForm(f => ({ ...f, assts: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Game Result</label>
              <input className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.gameResult} onChange={e => setPotgForm(f => ({ ...f, gameResult: e.target.value }))} placeholder="e.g. OSY 77 vs Solid North 63" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">League</label>
                <select className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.leagueId} onChange={e => setPotgForm(f => ({ ...f, leagueId: e.target.value }))}>
                  {LEAGUE_REGISTRY.map(l => <option key={l.id} value={l.id}>{l.shortName}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</label>
                <input type="date" className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={potgForm.date} onChange={e => setPotgForm(f => ({ ...f, date: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Live card preview — shown once fields are populated */}
          {(potgParseState === 'parsed' || potgParseState === 'error') && potgForm.playerName && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
                <Trophy className="w-3 h-3 text-primary" /> Card Preview
              </p>
              <PotgCard
                potg={{
                  id: 'preview',
                  leagueId: potgForm.leagueId as import('@/types').LeagueId,
                  playerName: potgForm.playerName,
                  team: potgForm.team,
                  pts: Number(potgForm.pts) || 0,
                  rebs: Number(potgForm.rebs) || 0,
                  assts: Number(potgForm.assts) || 0,
                  gameResult: potgForm.gameResult,
                  date: potgForm.date,
                }}
                featured
              />
            </div>
          )}

          <button
            disabled={potgMutation.isPending || !potgForm.playerName || !potgForm.team}
            onClick={() => potgMutation.mutate()}
            className="w-full gold-bg py-3 font-display font-bold text-sm uppercase tracking-wider rounded-sm disabled:opacity-50 transition-opacity"
          >
            {potgMutation.isPending ? (potgImageFile ? 'Resizing & Uploading…' : 'Submitting to Pipeline…') : 'Submit to Data Pipeline'}
          </button>

          {potgMutation.error && <p className="text-xs text-destructive">{(potgMutation.error as Error).message}</p>}
          {ingestJob && (
            <div className="p-3 bg-success/10 border border-success/20 rounded-sm space-y-2">
              <p className="text-xs text-success font-medium">
                ✓ Job {ingestJob.jobId.slice(0, 8)} · state: <strong>{ingestJob.state}</strong>
              </p>
              {ingestJob.state === 'needs_review' && (
                <div className="flex gap-2 mt-1">
                  <button
                    className="px-3 py-1.5 rounded-sm text-xs bg-success text-white font-semibold"
                    onClick={async () => {
                      await ingestApprove(ingestJob.jobId);
                      setIngestJob(prev => prev ? { ...prev, state: 'published' } : null);
                    }}
                  >
                    Approve
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-sm text-xs bg-destructive text-white font-semibold"
                    onClick={async () => {
                      await ingestReject(ingestJob.jobId);
                      setIngestJob(prev => prev ? { ...prev, state: 'archived' } : null);
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
              {ingestJob.state === 'published' && (
                <a href="/media" className="text-xs text-primary underline">
                  View on /media →
                </a>
              )}
            </div>
          )}
        </div>
      </div></section>)}

      {activeTab === 'roster' && (<section id="roster" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Roster Import</h2><div className="space-y-4"><div className="panel p-4 space-y-5 max-w-3xl">
          <div>
            <h2 className="font-display text-xl">Roster Image Parser</h2>
            <p className="text-xs text-muted-foreground mt-1">Upload a roster/team photo — AI vision extracts the team and player list, then you review and confirm before it creates the team and players.</p>
          </div>

          {!canOperateOps ? (
            <p className="text-sm text-destructive font-semibold">League Admin role or higher required to import a roster.</p>
          ) : (
            <>
              {/* Image drop zone */}
              <div
                className="border-2 border-dashed border-border rounded-sm p-6 text-center cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => rosterFileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleRosterImageUpload(f); }}
              >
                <input ref={rosterFileRef} id="roster-image-input" type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleRosterImageUpload(f); }} />
                {rosterParseState === 'parsing' ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">Parsing with AI vision…</p>
                  </div>
                ) : rosterParseState === 'parsed' ? (
                  <div className="flex flex-col items-center gap-1">
                    <CheckCircle2 className="w-5 h-5 text-success" />
                    <p className="text-xs text-success font-medium">{rosterPlayers.length} player{rosterPlayers.length === 1 ? '' : 's'} extracted — review below</p>
                    <p className="text-[10px] text-muted-foreground">Click to parse another image</p>
                  </div>
                ) : rosterParseState === 'error' ? (
                  <div className="flex flex-col items-center gap-1">
                    <AlertCircle className="w-5 h-5 text-destructive" />
                    <p className="text-xs text-destructive">{rosterParseError}</p>
                    <p className="text-[10px] text-muted-foreground">Add team/players manually below</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-6 h-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Drop roster/team photo or click to upload</p>
                    <p className="text-[10px] text-muted-foreground">PNG, JPG — extracts team name, player names, jersey numbers, positions</p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Team Name</label>
                  <input className="w-full mt-1 bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={rosterForm.teamName} onChange={e => setRosterForm(f => ({ ...f, teamName: e.target.value }))} placeholder="e.g. Ball is Life" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">League *</label>
                  <LeagueSelect value={rosterForm.leagueId} onChange={(slug) => setRosterForm(f => ({ ...f, leagueId: slug, seasonId: '' }))} />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Season *</label>
                  <SeasonSelect
                    seasons={seasonsRef}
                    leagues={leaguesRef}
                    leagueSlug={rosterForm.leagueId}
                    value={rosterForm.seasonId}
                    onChange={(id) => setRosterForm(f => ({ ...f, seasonId: id }))}
                  />
                </div>
              </div>

              {/* Editable player review table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Players ({rosterPlayers.length})</label>
                  <button type="button" onClick={addRosterPlayerRow} className="text-xs text-primary underline">+ Add player</button>
                </div>
                {rosterPlayers.length === 0 ? (
                  <p className="text-xs text-muted-foreground border border-dashed border-border rounded-sm p-4 text-center">No players yet — parse an image or add a row manually.</p>
                ) : (
                  <div className="space-y-1.5">
                    {rosterPlayers.map((player, i) => (
                      <div key={i} className="grid grid-cols-[1fr_90px_90px_auto] gap-2 items-center">
                        <input className="bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={player.name} onChange={e => updateRosterPlayer(i, 'name', e.target.value)} placeholder="Player name" />
                        <input className="bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={player.jerseyNumber} onChange={e => updateRosterPlayer(i, 'jerseyNumber', e.target.value)} placeholder="#" />
                        <input className="bg-secondary border border-border rounded-sm px-3 py-2 text-sm" value={player.position} onChange={e => updateRosterPlayer(i, 'position', e.target.value)} placeholder="Pos" />
                        <button type="button" onClick={() => removeRosterPlayerRow(i)} className="p-2 text-destructive hover:bg-destructive/10 rounded-sm" aria-label={`Remove ${player.name || 'player row'}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                disabled={rosterImportMutation.isPending || !rosterForm.teamName.trim() || !rosterForm.leagueId.trim() || !rosterForm.seasonId.trim() || rosterPlayers.filter(p => p.name.trim()).length === 0}
                onClick={() => rosterImportMutation.mutate()}
                className="w-full gold-bg py-3 font-display font-bold text-sm uppercase tracking-wider rounded-sm disabled:opacity-50 transition-opacity"
              >
                {rosterImportMutation.isPending ? 'Importing…' : 'Import Roster'}
              </button>

              {rosterImportMutation.error && <p className="text-xs text-destructive">{(rosterImportMutation.error as Error).message}</p>}

              {rosterImportResult && (
                <div className="p-3 bg-success/10 border border-success/20 rounded-sm space-y-1">
                  <p className="text-xs text-success font-medium">
                    ✓ Team {rosterImportResult.teamId.slice(0, 8)} · {rosterImportResult.inserted} created, {rosterImportResult.skipped} already existed, {rosterImportResult.failed} failed
                  </p>
                  {rosterImportResult.warnings.length > 0 && (
                    <p className="text-[10px] text-warning">{rosterImportResult.warnings.join(' · ')}</p>
                  )}
                  {rosterImportResult.errors.length > 0 && (
                    <p className="text-[10px] text-destructive">{rosterImportResult.errors.join(' · ')}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div></section>)}

      {activeTab === 'media' && (<section id="media" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">Media Library</h2><div className="space-y-4">
        <MediaLibraryTab enabled={canRunOps} />
      </div></section>)}

      {activeTab === 'history' && (<section id="history" className="space-y-6 pt-6"><h2 className="text-2xl font-display font-bold border-b border-border pb-2">History</h2><div className="space-y-4">
        <div className="panel p-4">
          <h3 className="text-sm font-bold text-destructive mb-2">Ingress Failures (last 20)</h3>
          {ingressFailures.length === 0 ? (
            <p className="text-xs text-muted-foreground">None recorded — all recent ingest attempts were accepted.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {ingressFailures.map((f) => (
                <li key={f.correlation_id} className="flex justify-between gap-3 border-b border-border/50 pb-1">
                  <span className="text-destructive font-mono truncate">{f.error_reason}</span>
                  <span className="text-muted-foreground shrink-0">{f.source_type} · {new Date(f.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3 gap-3">
            <h2 className="font-display text-xl shrink-0">Import History</h2>
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                placeholder='Filter… or /error|warn/'
                className="w-full bg-secondary border border-border rounded-sm px-3 py-1.5 text-sm pr-8 font-mono placeholder:font-sans placeholder:text-muted-foreground"
              />
              {historySearch && (
                <button
                  onClick={() => setHistorySearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                >✕</button>
              )}
            </div>
            {historySearch && (
              <span className="text-xs text-muted-foreground shrink-0">
                {filteredJobs.length}/{jobs.length}
              </span>
            )}
          </div>
          {jobs.length === 0 ? <p className="text-sm text-muted-foreground">No import history.</p> : filteredJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs match <span className="font-mono">{historySearch}</span>.</p>
          ) : (
            <div className="space-y-2">
              {filteredJobs.map((job) => (
                <div key={job.id} className="border border-border rounded-sm p-3 text-sm">
                  <p className="font-medium">{job.job_type} · {job.status}</p>
                  <p className="text-xs text-muted-foreground">Rows {job.inserted_rows}/{job.total_rows} · failed {job.failed_rows}</p>
                  {job.error_summary && (
                    <p className="text-xs text-destructive mt-1 font-mono">{job.error_summary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div></section>)}
      </div>
    </div>
  );
};

export default OpsPage;
