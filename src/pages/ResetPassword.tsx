import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '@/lib/supabase/client';
import { CheckCircle2, ArrowLeft } from 'lucide-react';

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // Check if recovery session is present
    void supabase.auth.getSession().then(({ data }) => {
      if (data?.session) {
        setHasSession(true);
      } else {
        setHasSession(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setHasSession(true);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Authentication service is currently unavailable.');
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          navigate('/login');
        }, 3000);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Failed to update password';
      setError(raw);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-6rem)] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md panel p-6 md:p-8 flex flex-col justify-center">
        {/* Brand header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="font-display text-lg font-bold tracking-tight text-foreground">SBBL</span>
          <span className="font-display text-lg font-bold tracking-tight text-primary">HQ</span>
        </div>

        <h1 className="font-display text-2xl md:text-3xl font-bold uppercase tracking-tight">
          Set New Password
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Enter and confirm your new account password.
        </p>

        {hasSession === null ? (
          <div className="mt-6 flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : hasSession === false ? (
          <div className="mt-4 panel p-4 border-warning/30 bg-warning/5">
            <p className="text-sm font-medium text-warning">Password Recovery Session Missing</p>
            <p className="text-xs text-muted-foreground mt-1">
              Please click the password reset link directly from your email to set a new password.
            </p>
          </div>
        ) : success ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 rounded-sm border border-success/30 bg-success/10 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">Password updated successfully!</p>
                <p className="text-muted-foreground mt-1">
                  Your password has been changed. Redirecting to sign in…
                </p>
              </div>
            </div>

            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 w-full gold-bg px-4 py-3 rounded-sm font-display font-bold text-sm uppercase tracking-wider transition-opacity mt-4"
            >
              <ArrowLeft className="w-4 h-4" /> Go to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="reset-password"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                New Password
              </label>
              <input
                id="reset-password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full bg-secondary border border-border rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
                placeholder="At least 6 characters"
                disabled={submitting}
                minLength={6}
              />
            </div>

            <div>
              <label
                htmlFor="reset-confirm-password"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Confirm New Password
              </label>
              <input
                id="reset-confirm-password"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1.5 w-full bg-secondary border border-border rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
                placeholder="Re-enter your new password"
                disabled={submitting}
                minLength={6}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || password.length < 6 || password !== confirmPassword}
              className="gold-bg px-4 py-3 rounded-sm font-display font-bold text-sm uppercase tracking-wider w-full disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {submitting ? 'Updating password…' : 'Update Password'}
            </button>

            <div className="mt-6 pt-4 border-t border-border flex items-center justify-center">
              <Link
                to="/login"
                className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
