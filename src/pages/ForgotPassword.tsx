import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { getSupabaseClient } from '@/lib/supabase/client';
import { CheckCircle2, ArrowLeft } from 'lucide-react';

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Authentication service is currently unavailable. Please try again shortly.');
      }

      const redirectTo = `${window.location.origin}/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (resetError) {
        setError(resetError.message);
      } else {
        setSuccess(true);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Failed to send password reset email';
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
          Reset Password
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          Enter your email address and we&apos;ll send you a link to reset your password.
        </p>

        {success ? (
          <div className="mt-6 space-y-4">
            <div className="p-4 rounded-sm border border-success/30 bg-success/10 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">Check your email</p>
                <p className="text-muted-foreground mt-1">
                  We&apos;ve sent a password reset link to <strong className="text-foreground">{email}</strong>.
                  Please check your inbox and click the link to proceed.
                </p>
              </div>
            </div>

            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 w-full gold-bg px-4 py-3 rounded-sm font-display font-bold text-sm uppercase tracking-wider transition-opacity mt-4"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="forgot-email"
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Email address
              </label>
              <input
                id="forgot-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full bg-secondary border border-border rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50 transition-colors"
                placeholder="you@example.com"
                disabled={submitting}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !email.includes('@')}
              className="gold-bg px-4 py-3 rounded-sm font-display font-bold text-sm uppercase tracking-wider w-full disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {submitting ? 'Sending link…' : 'Send Reset Link'}
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

export default ForgotPasswordPage;
