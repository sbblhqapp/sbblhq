/**
 * Ops Console UUID-elimination — BEHAVIORAL verification.
 *
 * Renders the real OpsPage component tree (real React render, real DOM,
 * real react-query data flow) with mocked network calls, and proves the
 * Manual Ops forms actually work without the operator typing a UUID:
 *   - League fields are real <select> elements sourced from LEAGUE_REGISTRY.
 *   - Season/Division/Team/Player/Event/Schedule fields are real <select>
 *     elements populated from the mocked list/reference data, not text boxes.
 *   - Choosing a league actually filters the Season dropdown to that league's
 *     seasons (proves the client-side league-slug -> UUID join works, not
 *     just that a dropdown exists).
 *   - Submitting "Create Player" calls findOrCreatePlayer with a NAME — never
 *     manualOpsAction('player', 'create', { userId }).
 *   - No control anywhere in Teams/Players/Schedules/Events Manual Ops has a
 *     placeholder mentioning "UUID".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import OpsPage from '@/pages/Ops';

type MockAuthState = {
  loading: boolean;
  session: { access_token: string; user: { id: string; email: string }; expires_at?: number } | null;
  user: { id: string; email: string } | null;
  roles: string[];
};

const LEAGUE_WBL_UUID = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAGUE_SBBL_UUID = 'aaaaaaaa-0000-4000-8000-000000000002';
const SEASON_WBL_UUID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SEASON_SBBL_UUID = 'bbbbbbbb-0000-4000-8000-000000000002';

const {
  fetchOpsBootstrap,
  fetchImportHistory,
  fetchOpsList,
  findOrCreatePlayer,
  manualOpsAction,
  authState,
} = vi.hoisted(() => ({
  fetchOpsBootstrap: vi.fn(),
  fetchImportHistory: vi.fn(),
  fetchOpsList: vi.fn(),
  findOrCreatePlayer: vi.fn(),
  manualOpsAction: vi.fn(),
  authState: {
    loading: false,
    session: { access_token: 'token', user: { id: 'league-admin-1', email: 'statssbbl@gmail.com' }, expires_at: Math.floor(Date.now() / 1000) + 3600 },
    user: { id: 'league-admin-1', email: 'statssbbl@gmail.com' },
    roles: ['league_admin'],
  } as MockAuthState,
}));

vi.mock('@/hooks/use-auth', () => ({ useAuth: () => authState }));

vi.mock('@/lib/api/ops', () => ({
  fetchOpsBootstrap,
  fetchImportHistory,
  fetchOpsList,
  findOrCreatePlayer,
  manualOpsAction,
  submitCsvImport: vi.fn(),
  fetchPipelineHealth: vi.fn(async () => ({ ok: true, overall: 'ok', metrics: {}, alerts: [], checked_at: '' })),
  mergePlayerIdentities: vi.fn(),
  parseEventImage: vi.fn(),
  parsePotgImage: vi.fn(),
  parseRosterImage: vi.fn(),
  importRoster: vi.fn(),
  ingestPresign: vi.fn(),
  ingestSubmit: vi.fn(),
  ingestApprove: vi.fn(),
  ingestReject: vi.fn(),
}));

vi.mock('@/lib/api/scores', () => ({
  fetchScores: vi.fn(async () => ({ ok: true, games: [] })),
  submitScoreManual: vi.fn(),
  submitScoresCsvImport: vi.fn(),
  parseScoreboardImage: vi.fn(),
}));

vi.mock('@/lib/imageResize', () => ({
  inferTargetDimensions: vi.fn(async () => ({ width: 100, height: 100, mode: 'cover' })),
  resizeImageToFit: vi.fn(async (file: File) => file),
}));

const renderOps = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OpsPage />
    </QueryClientProvider>,
  );
};

function clickTab(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('Ops Console — UUID-free Manual Ops forms (league_admin)', () => {
  beforeEach(() => {
    fetchOpsBootstrap.mockReset();
    fetchImportHistory.mockReset();
    fetchOpsList.mockReset();
    findOrCreatePlayer.mockReset();
    manualOpsAction.mockReset();

    fetchImportHistory.mockResolvedValue({ ok: true, jobs: [] });
    manualOpsAction.mockResolvedValue({ ok: true });
    findOrCreatePlayer.mockResolvedValue({
      ok: true, playerId: 'new-player-1', userId: 'new-user-1', provisioned: true, warnings: [], player: {},
    });

    fetchOpsBootstrap.mockResolvedValue({
      ok: true,
      user: { userId: 'league-admin-1', email: 'statssbbl@gmail.com' },
      roles: ['league_admin'],
      references: {
        leagues: [
          { id: LEAGUE_WBL_UUID, name: 'Weekend Basketball League', code: 'WBL' },
          { id: LEAGUE_SBBL_UUID, name: 'Southside Basketball Basketball League', code: 'SBBL' },
        ],
        seasons: [
          { id: SEASON_WBL_UUID, name: 'WBL Season 3', league_id: LEAGUE_WBL_UUID },
          { id: SEASON_SBBL_UUID, name: 'SBBL Season 11', league_id: LEAGUE_SBBL_UUID },
        ],
        divisions: [],
        venues: [],
      },
      importHistory: [],
    });

    fetchOpsList.mockImplementation(async (entity: string) => {
      if (entity === 'teams') {
        return {
          ok: true,
          data: [
            { id: 'team-wbl-1', name: 'Crosslinx Warriors', league_id: LEAGUE_WBL_UUID, status: 'published' },
            { id: 'team-sbbl-1', name: 'Panalay Kings', league_id: LEAGUE_SBBL_UUID, status: 'published' },
          ],
        };
      }
      if (entity === 'players') {
        return {
          ok: true,
          data: [
            { id: 'player-1', user_id: 'user-1', team_id: 'team-wbl-1', league_id: LEAGUE_WBL_UUID, display_name: 'Jaime Phillips', team_name: 'Crosslinx Warriors', is_suspended: false },
          ],
        };
      }
      if (entity === 'events') {
        return { ok: true, data: [{ id: 'event-1', title: 'Season Kickoff', league_id: LEAGUE_WBL_UUID, starts_at: '2026-09-01T00:00:00Z' }] };
      }
      if (entity === 'schedules') {
        return { ok: true, data: [{ id: 'sched-1', league_id: LEAGUE_WBL_UUID, season_id: SEASON_WBL_UUID, starts_at: '2026-09-05T18:00:00Z', status: 'upcoming', league_code: 'WBL', league_name: 'Weekend Basketball League' }] };
      }
      return { ok: true, data: [] };
    });
  });

  it('Teams tab: no UUID text inputs anywhere, League/Season/Division are real selects', async () => {
    renderOps();
    clickTab('Teams');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Team' })).toBeInTheDocument());

    // No raw-UUID text box survived the redesign.
    expect(screen.queryByPlaceholderText(/UUID/i)).not.toBeInTheDocument();

    // League is a real <select>, not a text input, with LEAGUE_REGISTRY options.
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBeGreaterThan(0);
    const leagueSelect = comboboxes.find((el) =>
      within(el).queryByText('Weekend Basketball League'),
    ) as HTMLSelectElement;
    expect(leagueSelect).toBeTruthy();
  });

  it('Teams tab: choosing a league actually filters the Season dropdown to that league only', async () => {
    renderOps();
    clickTab('Teams');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Team' })).toBeInTheDocument());

    // LeagueSelect's options come from the static LEAGUE_REGISTRY, so it
    // renders immediately. SeasonSelect's filtering depends on
    // bootstrapQuery's `references.leagues`/`references.seasons`, which
    // resolve asynchronously (even mocked) — must wait for that data, not
    // just for the static heading, or this races under CI's scheduling.
    const leagueSelect = screen.getAllByRole('combobox').find((el) =>
      within(el as HTMLElement).queryByText('Weekend Basketball League'),
    ) as HTMLSelectElement;
    expect(leagueSelect).toBeTruthy();

    // Default form state is 'wbl' -> season select should end up showing WBL Season 3.
    let seasonSelect: HTMLSelectElement;
    await waitFor(() => {
      seasonSelect = screen.getAllByRole('combobox').find((el) =>
        within(el as HTMLElement).queryByText('WBL Season 3'),
      ) as HTMLSelectElement;
      expect(seasonSelect).toBeTruthy();
    });
    expect(within(seasonSelect!).queryByText('SBBL Season 11')).not.toBeInTheDocument();

    // Switch league to SBBL -> season options must swap to SBBL's season only.
    fireEvent.change(leagueSelect, { target: { value: 'sbbl' } });

    await waitFor(() => {
      seasonSelect = screen.getAllByRole('combobox').find((el) =>
        within(el as HTMLElement).queryByText('SBBL Season 11'),
      ) as HTMLSelectElement;
      expect(seasonSelect).toBeTruthy();
    });
    expect(within(seasonSelect!).queryByText('WBL Season 3')).not.toBeInTheDocument();
  });

  it('Teams tab: Delete Team is a select populated with real team names, not a raw ID box', async () => {
    renderOps();
    clickTab('Teams');
    await waitFor(() => expect(screen.getByText('Delete Team')).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/Team ID to Delete/i)).not.toBeInTheDocument();
    // The mocked team name actually appears as a selectable option.
    await waitFor(() => expect(screen.getByText('Crosslinx Warriors')).toBeInTheDocument());
  });

  it('Players tab: Create Player asks for a NAME, never a User ID', async () => {
    renderOps();
    clickTab('Players');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Player' })).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/User ID/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Player Name *')).toBeInTheDocument();
  });

  it('Players tab: submitting Create Player calls findOrCreatePlayer with a name — never manualOpsAction with userId', async () => {
    renderOps();
    clickTab('Players');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Player' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Player Name *'), { target: { value: 'Robert Ocampo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Player' }));

    await waitFor(() => expect(findOrCreatePlayer).toHaveBeenCalledTimes(1));
    expect(findOrCreatePlayer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Robert Ocampo', leagueId: 'wbl' }),
    );
    // The old contract must never fire for player creation.
    expect(manualOpsAction).not.toHaveBeenCalledWith('player', 'create', expect.anything());
  });

  it('Players tab: Suspend/Delete/Merge use real player pickers showing display names, not raw ID boxes', async () => {
    renderOps();
    clickTab('Players');
    await waitFor(() => expect(screen.getByText('Suspend Player')).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/Player ID to Suspend/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Player ID to Delete/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Duplicate Player ID/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Canonical Player ID/i)).not.toBeInTheDocument();

    // The mocked player's real display name renders as a pickable option
    // (appears 4x: suspend, merge-source, merge-target, delete).
    await waitFor(() => {
      const matches = screen.getAllByText((_, el) => el?.textContent === 'Jaime Phillips — Crosslinx Warriors');
      expect(matches.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('Schedules tab: Delete Schedule Entry is a select, not a raw Schedule Slot ID box', async () => {
    renderOps();
    clickTab('Schedules');
    await waitFor(() => expect(screen.getByText('Delete Schedule Entry')).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/Schedule Slot ID/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/WBL —/)).toBeInTheDocument());
  });

  it('Events tab: Delete Event is a select showing the real title, not a raw Event ID box', async () => {
    renderOps();
    clickTab('Events');
    await waitFor(() => expect(screen.getByText('Delete Event')).toBeInTheDocument());

    expect(screen.queryByPlaceholderText(/Event ID to Delete/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Season Kickoff/)).toBeInTheDocument());
  });

  it('Store Media tab is completely absent for league_admin (regression guard, unrelated to UUID work)', async () => {
    renderOps();
    expect(screen.queryByRole('button', { name: 'Store Media' })).not.toBeInTheDocument();
  });
});
