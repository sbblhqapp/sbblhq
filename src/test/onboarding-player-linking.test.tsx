import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingPage from '@/pages/Onboarding';
import { apiFetch } from '@/lib/api/client';
import { saveOnboarding } from '@/lib/api/auth';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ search: '' }),
  };
});

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'user-123', email: 'test@example.com' },
    isSignedIn: true,
    isAdmin: false,
    needsOnboarding: true,
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/api/auth', () => ({
  saveOnboarding: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/lib/api/client', () => ({
  apiFetch: vi.fn((path: string) => {
    if (path === '/api/public/leagues') {
      return Promise.resolve({
        ok: true,
        data: [{ id: 'l1', name: "Sunday's Best Basketball League", code: 'SBBL' }],
      });
    }
    if (path.startsWith('/api/public/teams-by-league')) {
      return Promise.resolve({
        ok: true,
        data: [
          { id: 'team-1', name: 'Montanyosa', division_id: 'd1', division_name: 'Panalay Division' },
        ],
      });
    }
    if (path.startsWith('/api/public/unclaimed-players')) {
      return Promise.resolve({
        ok: true,
        data: [
          { id: 'player-1', display_name: 'JR Courtside', jersey_number: 28 },
        ],
      });
    }
    if (path === '/api/player/claim-or-join-team') {
      return Promise.resolve({
        ok: true,
        data: { player: { id: 'player-1' }, mode: 'claim' },
      });
    }
    return Promise.resolve({ ok: true });
  }),
}));

function renderOnboarding() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <OnboardingPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingPage — Phase 3a & Phase 4', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders decoupled pricing disclosure under Player option without breaking selection', async () => {
    renderOnboarding();

    expect(screen.getByText(/^Player$/i)).toBeInTheDocument();
    expect(screen.getByText(/What's included \(\$6\.99 CAD\/month \+ GST\)/i)).toBeInTheDocument();
  });

  it('renders team picker and unclaimed player cards when Player role is selected', async () => {
    renderOnboarding();

    // Select Player role
    fireEvent.click(screen.getByText(/^Player$/i));

    // Fill display name and full name
    fireEvent.change(screen.getByPlaceholderText(/How you appear in the app/i), {
      target: { value: 'JR Courtside' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Your legal name/i), {
      target: { value: 'JR Founder' },
    });

    // Verify team dropdown appears and option is rendered
    const teamSelect = (await screen.findByRole('combobox', { name: /Select Your Team/i })) as HTMLSelectElement;
    expect(teamSelect).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Montanyosa' });

    // Select team Montanyosa with both value assignment and synthetic change event for jsdom compatibility
    teamSelect.value = 'team-1';
    fireEvent.change(teamSelect, { target: { value: 'team-1' } });

    // Verify unclaimed player card appears via data-testid
    const playerCard = await screen.findByTestId('claim-player-player-1');
    expect(playerCard).toBeInTheDocument();
    expect(screen.getByTestId('add-as-new-player')).toBeInTheDocument();

    // Click to claim existing player
    fireEvent.click(playerCard);

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Continue to Player Registration/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/player/claim-or-join-team',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"mode":"claim"'),
        }),
      );
      expect(saveOnboarding).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/billing?checkout=1');
    });
  });
});
