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

describe('OnboardingPage — Free vs Premium Player Options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders both Free Player Roster and Player Premium ($6.99 CAD/season) with comparison disclosure', async () => {
    renderOnboarding();

    expect(screen.getByRole('radio', { name: /Player \(Free Roster\)/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Player Premium/i })).toBeInTheDocument();
    expect(screen.getByText(/\$6\.99 CAD \/ season/i)).toBeInTheDocument();
    expect(screen.getByText(/Compare Free vs Premium Player \(\$6\.99 CAD\/season\)/i)).toBeInTheDocument();
  });

  it('allows registering as Free Player without navigating to Stripe billing checkout', async () => {
    renderOnboarding();

    // Select Player (Free Roster) role
    fireEvent.click(screen.getByRole('radio', { name: /Player \(Free Roster\)/i }));

    // Fill display name and full name
    fireEvent.change(screen.getByPlaceholderText(/How you appear in the app/i), {
      target: { value: 'JR Courtside' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Your legal name/i), {
      target: { value: 'JR Founder' },
    });

    // Select team Montanyosa
    const teamSelect = (await screen.findByRole('combobox', { name: /Select Your Team/i })) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Montanyosa' });
    teamSelect.value = 'team-1';
    fireEvent.change(teamSelect, { target: { value: 'team-1' } });

    // Claim existing player
    const playerCard = await screen.findByTestId('claim-player-player-1');
    fireEvent.click(playerCard);

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Complete Free Roster Registration/i });
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
      expect(mockNavigate).toHaveBeenCalledWith('/live');
    });
  });

  it('allows registering as Player Premium and navigates to Season Pass checkout ($6.99 CAD)', async () => {
    renderOnboarding();

    // Select Player Premium role
    fireEvent.click(screen.getByRole('radio', { name: /Player Premium/i }));

    // Fill display name and full name
    fireEvent.change(screen.getByPlaceholderText(/How you appear in the app/i), {
      target: { value: 'JR Courtside' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Your legal name/i), {
      target: { value: 'JR Founder' },
    });

    // Select team Montanyosa
    const teamSelect = (await screen.findByRole('combobox', { name: /Select Your Team/i })) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Montanyosa' });
    teamSelect.value = 'team-1';
    fireEvent.change(teamSelect, { target: { value: 'team-1' } });

    // Claim existing player
    const playerCard = await screen.findByTestId('claim-player-player-1');
    fireEvent.click(playerCard);

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Continue to Season Pass Checkout \(\$6\.99 CAD\)/i });
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
