import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-neutral-200">
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <Link to="/" className="inline-flex items-center gap-2 text-amber-500 hover:text-amber-400 text-sm">
          <ArrowLeft size={16} /> Back to SBBL HQ
        </Link>

        <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
        <p className="text-sm text-neutral-400">Effective Date: April 6, 2026 &middot; Last Updated: April 6, 2026</p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">1. Acceptance of Terms</h2>
          <p>
            By accessing or using SBBL HQ (&quot;the App&quot;), operated by Apex Business Systems, you agree to be bound by these
            Terms of Service. If you do not agree to these terms, do not use the App.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">2. Description of Service</h2>
          <p>
            SBBL HQ provides a unified platform for the SBBL, WBL, and TGIFBL basketball leagues, including live game streaming,
            schedules, player statistics, leaderboards, team profiles, media content, and merchandise. Certain features require
            a paid subscription or pay-per-view purchase.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">3. Accounts &amp; Registration</h2>
          <ul className="list-disc list-inside space-y-1 text-neutral-300">
            <li>You must provide accurate, current information when creating an account.</li>
            <li>You are responsible for maintaining the security of your credentials.</li>
            <li>You may not share your account or allow others to access it.</li>
            <li>One active session per account is enforced; signing in on a new device will end existing sessions.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">4. Subscriptions &amp; Payments</h2>
          <ul className="list-disc list-inside space-y-1 text-neutral-300">
            <li>Free roster player registration is available at no cost for all league participants.</li>
            <li>Player Premium Season Pass is available for $6.99 CAD/season via Stripe.</li>
            <li>Pay-per-view livestream access is available for individual games.</li>
            <li>All prices include applicable taxes (e.g., Alberta GST at 5%).</li>
            <li>Refunds are handled in accordance with Stripe&apos;s refund policies and at our discretion.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">5. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc list-inside space-y-1 text-neutral-300">
            <li>Share, redistribute, or rebroadcast livestream content</li>
            <li>Attempt to circumvent access controls, paywalls, or authentication</li>
            <li>Use automated tools, bots, or scrapers to access the App</li>
            <li>Upload offensive, harmful, or illegal content</li>
            <li>Impersonate other users, players, or administrators</li>
            <li>Interfere with or disrupt the App&apos;s infrastructure</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">6. Intellectual Property</h2>
          <p>
            All content, branding, logos, designs, and software within SBBL HQ are owned by Apex Business Systems or its licensors.
            Player statistics and game data are property of the respective leagues. You may not reproduce, distribute, or create
            derivative works without written permission.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">7. Content Submissions</h2>
          <p>
            By submitting content (such as profile headshots), you grant us a non-exclusive, royalty-free license to display that
            content within the App. All submitted headshots are subject to admin review and our{' '}
            <Link to="/privacy" className="text-amber-500 hover:underline">Headshot Policy</Link>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">8. Disclaimers</h2>
          <p>
            The App is provided &quot;as is&quot; and &quot;as available.&quot; We do not warrant uninterrupted service, error-free
            operation, or the accuracy of statistics. Livestream availability depends on network conditions and third-party services.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">9. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Apex Business Systems shall not be liable for any indirect, incidental, special,
            consequential, or punitive damages arising from your use of the App, including but not limited to loss of data, revenue,
            or profits.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">10. Termination</h2>
          <p>
            We reserve the right to suspend or terminate your account at any time for violations of these Terms. You may delete your
            account at any time through the App settings or by contacting us.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">11. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the Province of Alberta, Canada, without regard to conflict of law provisions.
            Any disputes shall be resolved in the courts of Alberta, Canada.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">12. Changes to Terms</h2>
          <p>
            We may modify these Terms at any time. Material changes will be communicated through the App. Continued use after
            changes constitutes acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-white">13. Contact</h2>
          <p>
            Questions about these Terms? Contact us at{' '}
            <a href="mailto:info-outreach@sbbl-hq.icu" className="text-amber-500 hover:underline">info-outreach@sbbl-hq.icu</a>.
          </p>
        </section>

        <footer className="pt-8 border-t border-neutral-800 text-center text-sm text-neutral-500">
          &copy; {new Date().getFullYear()} Apex Business Systems. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
