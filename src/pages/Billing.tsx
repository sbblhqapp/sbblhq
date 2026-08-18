import { useState } from 'react';
import { CreditCard, FileText, ExternalLink, Loader2 } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/hooks/use-auth';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { PLAYER_REGISTRATION_PRICE_CAD } from '@/lib/auth/subscription';
import { toast } from 'sonner';

interface Order {
  id: string;
  created_at: string;
  /** Cents. Column is `orders.total` — there is no `total_amount` column. */
  total: number;
  status: string;
  metadata: Record<string, unknown> | null;
}

const BillingPage = () => {
  const { authRole, hasPremiumPlayerAccess, playerSubscriptionEndsAt } = useApp();
  const { isSignedIn } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const historyQuery = useQuery({
    queryKey: ['billing-history'],
    queryFn: () => apiFetch<{ ok: boolean; data: Order[] }>('/api/billing/history'),
    enabled: isSignedIn,
    retry: 1,
    staleTime: 60_000,
  });

  const orders: Order[] = Array.isArray(historyQuery.data?.data) ? historyQuery.data.data : [];

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const res = await apiFetch<{ ok: boolean; url?: string; error?: string }>('/api/player/checkout', {
        method: 'POST',
        body: JSON.stringify({
          successUrl: `${window.location.origin}/billing?success=1`,
          cancelUrl: `${window.location.origin}/billing`,
        }),
      });
      if (res.ok && res.url) {
        window.location.href = res.url;
      } else if (res.error === 'payments_not_configured') {
        toast.error('Payments are not yet configured. Contact support at info-outreach@sbbl-hq.icu');
      } else {
        toast.error(res.error ?? 'Failed to start checkout. Please try again.');
      }
    } catch {
      toast.error('Could not reach the payment service. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="container py-8 md:py-12 max-w-4xl">
        <div className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold">Billing & Payments</h1>
          <p className="text-sm text-muted-foreground mt-1">Account billing and player registration</p>
        </div>

        <div className="panel p-4 mb-8">
          <h3 className="font-display text-sm mb-3 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-muted-foreground" /> Player Registration Tier
          </h3>
          <p className="text-xs text-muted-foreground">
            Player Premium tier costs ${PLAYER_REGISTRATION_PRICE_CAD.toFixed(2)} CAD / season pass. Active players get leaderboard/profile inclusion, career analytics, highlight downloads, and 10% store discount.
          </p>
          <div className="mt-3 p-3 bg-secondary rounded-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {hasPremiumPlayerAccess ? 'Active' : 'Inactive'} player registration
              </p>
              <p className="text-[11px] text-muted-foreground">
                {playerSubscriptionEndsAt ? `Renews / expires on ${new Date(playerSubscriptionEndsAt).toLocaleDateString()}` : 'No active registration window'}
              </p>
            </div>
            {authRole === 'player' && (
              <button
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="gold-bg px-4 py-2 text-xs font-semibold rounded-sm uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-60"
              >
                {checkoutLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                Pay ${PLAYER_REGISTRATION_PRICE_CAD.toFixed(2)} & Activate Season Pass
              </button>
            )}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-display text-sm">Transaction History</h3>
          </div>
          {historyQuery.isLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No transactions yet. Your billing history will appear here once payments are processed.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {orders.map((o) => (
                <div key={o.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Player Registration</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="stat-numeral text-sm">${((o.total ?? 0) / 100).toFixed(2)}</p>
                    <p className={`text-[10px] uppercase font-semibold ${o.status === 'paid' ? 'text-success' : 'text-muted-foreground'}`}>{o.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BillingPage;
