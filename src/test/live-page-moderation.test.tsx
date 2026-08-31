import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ROUTER_FUTURE } from '@/test/utils/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LivePage from '@/pages/Live';

const streamModerationMocks = vi.hoisted(() => ({
  moderateStreamComment: vi.fn(async (_gameId, commentId, action) => ({
    ok: true,
    commentId,
    status: action === 'restore' ? 'active' : 'hidden',
  })),
  resetStreamReactions: vi.fn(async () => ({ ok: true, gameId: 'game-live-1', reset: true })),
  markHighlight: vi.fn(async (_input) => ({ ok: true, highlight: { id: 'hl-1' } })),
}));

vi.mock('@/lib/api/highlights', () => ({
  markHighlight: streamModerationMocks.markHighlight,
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' }, session: { access_token: 'token' }, roles: ['super_admin'] }),
}));

vi.mock('@/hooks/useLiveAccess', () => ({
  useLiveAccess: () => ({ access: { granted: true }, config: { enabled: false } }),
}));

vi.mock('@/contexts/AppContext', () => ({
  useApp: () => ({ hasPremiumPlayerAccess: false }),
}));

vi.mock('@/contexts/BagContext', () => ({
  useBag: () => ({
    addToBag: vi.fn(),
    bagItems: [],
    removeFromBag: vi.fn(),
    bagOpen: false,
    setBagOpen: vi.fn(),
  }),
}));


vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: () => null,
}));

vi.mock('@/lib/api/client', () => ({
  getAuthToken: vi.fn(async () => null),
  apiFetch: vi.fn(async (path: string) => {
    if (path.includes('/reactions')) {
      return { ok: true, fire: 0, heart: 0, clap: 0 };
    }
    if (path.includes('/products')) {
      return { ok: true, data: [] };
    }
    return { ok: true };
  }),
}));
vi.mock('@/components/LiveStreamPlayer', () => ({
  LiveStreamPlayer: () => <div data-testid="live-player" />,
}));

vi.mock('@/lib/api/public', () => ({
  fetchPublicHome: vi.fn(async () => ({
    ok: true,
    data: {
      liveGames: [{
        id: 'game-live-1',
        status: 'live',
        league_code: 'SBBL',
        home_team_id: 'h1',
        away_team_id: 'a1',
        home_team: { name: 'Home Team' },
        away_team: { name: 'Away Team' },
      }],
      upcomingGames: [],
    },
  })),
}));

vi.mock('@/lib/api/stream', () => ({
  fetchAdminStreamConfig: vi.fn(async () => ({ ok: true, config: { title: 'Live', isLive: true, collectionId: 'https://youtube.com/watch?v=abcdefghijk' } })),
  fetchPublicStreamStatus: vi.fn(async () => ({ ok: true, isLive: true, title: 'Live', gameId: 'game-live-1', viewerCount: 10 })),
  fetchStreamComments: vi.fn(async () => ({ ok: true, comments: [{ id: 'c1', userDisplayName: 'Fan', message: 'hello', status: 'active' }] })),
  generateCompCode: vi.fn(async () => ({ ok: true, code: 'CODE', gameId: 'game-live-1', expiresAt: new Date().toISOString(), createdAt: new Date().toISOString() })),
  postStreamComment: vi.fn(async () => ({ ok: true, comment: { id: 'new', message: 'test', createdAt: new Date().toISOString(), userId: 'admin-1' } })),
  moderateStreamComment: streamModerationMocks.moderateStreamComment,
  resetStreamReactions: streamModerationMocks.resetStreamReactions,
  setStreamLive: vi.fn(async () => ({ ok: true, isLive: true })),
  updateStreamConfig: vi.fn(async () => ({ ok: true, config: { title: 'Live', isLive: true, collectionId: 'https://youtube.com/watch?v=abcdefghijk' } })),
}));

describe('Live page moderation controls', () => {
  beforeEach(() => {
    vi.useRealTimers();
    streamModerationMocks.moderateStreamComment.mockClear();
    streamModerationMocks.resetStreamReactions.mockClear();
  });

  it('lets super admins hide/restore comments and reset reactions', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } })}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <LivePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Live Chat')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Hide'));
    await waitFor(() => expect(streamModerationMocks.moderateStreamComment).toHaveBeenCalledWith('game-live-1', 'c1', 'hide', 'token'));

    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => expect(streamModerationMocks.moderateStreamComment).toHaveBeenCalledWith('game-live-1', 'c1', 'restore', 'token'));

    fireEvent.click(screen.getByText('Reset Reactions'));
    await waitFor(() => expect(streamModerationMocks.resetStreamReactions).toHaveBeenCalledWith('game-live-1', 'token'));

    fireEvent.click(screen.getByText('Clip'));
    await waitFor(() => expect(streamModerationMocks.markHighlight).toHaveBeenCalledWith({
      game_id: 'game-live-1',
      title: 'Clip: Home Team vs Away Team',
    }));
  });
});
