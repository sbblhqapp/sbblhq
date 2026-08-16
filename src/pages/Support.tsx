import { Mail, MessageCircle, FileText, ChevronDown, ChevronUp, Shield, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

const faqs = [
  {
    q: 'How do I register as a player?',
    a: 'Sign in, then complete Onboarding to join your team roster for free. To unlock full player profiles, career stats, leaderboards, and highlight downloads, activate the Player Premium Season Pass ($6.99 CAD/season) in Billing & Payments.',
  },
  {
    q: 'How does the livestream paywall work?',
    a: 'Active players get free livestream access as part of their registration tier. Fans can purchase individual PPV access per game. All purchases are handled securely via Stripe.',
  },
  {
    q: 'I paid but my subscription still shows inactive.',
    a: 'After a successful payment, your subscription is updated automatically via Stripe webhook. If it\'s still inactive after 5 minutes, email us at info-outreach@sbbl-hq.icu with your receipt and we\'ll resolve it manually.',
  },
  {
    q: 'How do I update my player profile or headshot?',
    a: 'Go to Settings → Profile. You can update your display name and submit a headshot for admin review. Approved headshots go live within 24 hours.',
  },
  {
    q: 'Which leagues are in the APEX organization?',
    a: 'SBBL (Sunday\'s Best Basketball League), WBL (Weekend Basketball League), and TGIFBL (Thank God It\'s Friday Basketball League). Each league has its own standings, stats, and media.',
  },
  {
    q: 'How do I report a stat error or game issue?',
    a: 'Email info-outreach@sbbl-hq.icu with the game date, teams, and the specific stat discrepancy. Include your player name or team. Our ops team will review and correct within 48 hours.',
  },
];

const FaqItem = ({ q, a }: { q: string; a: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-4 flex items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-medium">{q}</span>
        {open ? <ChevronUp className="w-4 h-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
          {a}
        </div>
      )}
    </div>
  );
};

const SupportPage = () => {
  return (
    <div className="min-h-screen">
      <div className="container py-8 md:py-12 max-w-3xl">
        <div className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold">Support</h1>
          <p className="text-sm text-muted-foreground mt-1">Get help, report issues, or reach the SBBL HQ team</p>
        </div>

        {/* Contact card */}
        <div className="panel p-6 mb-10">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-primary/10 rounded-sm flex-shrink-0">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg mb-1">Email Support</h2>
              <p className="text-sm text-muted-foreground mb-3">
                For registration issues, billing questions, stat corrections, or general inquiries, email us directly.
                We aim to respond within 24–48 hours.
              </p>
              <a
                href="mailto:info-outreach@sbbl-hq.icu"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-sm uppercase tracking-wider hover:bg-primary/90 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" />
                info-outreach@sbbl-hq.icu
              </a>
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <a href="mailto:info-outreach@sbbl-hq.icu?subject=Billing%20Issue" className="panel p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
            <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Billing Issue</p>
              <p className="text-[11px] text-muted-foreground">Payment, subscription, or renewal</p>
            </div>
          </a>
          <a href="mailto:info-outreach@sbbl-hq.icu?subject=Stat%20Correction" className="panel p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
            <MessageCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Stat Correction</p>
              <p className="text-[11px] text-muted-foreground">Report a game or stat error</p>
            </div>
          </a>
          <a href="mailto:info-outreach@sbbl-hq.icu?subject=Account%20Access" className="panel p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
            <Mail className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Account Access</p>
              <p className="text-[11px] text-muted-foreground">Sign-in, profile, or access issue</p>
            </div>
          </a>
          <a href="mailto:info-outreach@sbbl-hq.icu?subject=General%20Inquiry" className="panel p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
            <MessageCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">General Inquiry</p>
              <p className="text-[11px] text-muted-foreground">Questions about SBBL, WBL, or TGIFBL</p>
            </div>
          </a>
        </div>

        {/* FAQ */}
        <h2 className="font-display text-xl font-bold mb-4">Frequently Asked Questions</h2>
        <div className="space-y-2">
          {faqs.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>

        {/* Legal links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
          <Link to="/privacy" className="panel p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
            <Shield className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Privacy Policy</p>
              <p className="text-[11px] text-muted-foreground">How we handle your data</p>
            </div>
          </Link>
          <Link to="/terms" className="panel p-4 flex items-center gap-3 hover:border-primary/30 transition-colors">
            <ScrollText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Terms of Service</p>
              <p className="text-[11px] text-muted-foreground">Rules and conditions of use</p>
            </div>
          </Link>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-10">
          SBBL HQ — APEX Business Systems Ltd. &nbsp;·&nbsp;{' '}
          <a href="mailto:info-outreach@sbbl-hq.icu" className="text-primary hover:underline">info-outreach@sbbl-hq.icu</a>
        </p>
      </div>
    </div>
  );
};

export default SupportPage;
