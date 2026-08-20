import { useState } from 'react';
import { CalendarCheck2, Coins, Settings2, Video } from 'lucide-react';
import { BookingModal } from '@/components/BookingModal';

const CONFIG = {
  calendlyUrl: 'https://calendly.com/apex-sbbl/demo',
  email: 'info-outreach@sbbl-hq.icu',
  hero: {
    title: 'Run Your League. Stream Every Game. Monetize Your Fans.',
    subtext: 'SBBL HQ is the all-in-one platform for community basketball leagues. Setup in 24 hours. Revenue from day one.',
    cta: 'Book a Free 20-Min Demo',
  },
  proofStats: [
    { value: '3 Leagues', label: 'Live & Running' },
    { value: '47 Games', label: 'Streamed' },
    { value: '2,400+', label: 'Fan Sessions' },
  ],
  steps: [
    { icon: Settings2, title: 'Setup', description: 'We configure your league, teams, and schedule in 24 hours.' },
    { icon: Video, title: 'Stream', description: 'Run your games. We handle live streaming and fan access.' },
    { icon: Coins, title: 'Monetize', description: 'Fans pay per game or per season. You keep the revenue.' },
  ],
  pricing: {
    starter: {
      name: 'Fan PPV Access',
      subtitle: 'Single Game Livestream',
      price: '$3.99 CAD',
      features: ['1 live game broadcast', 'Full HD streaming', 'Live stats & chat', 'Instant replay access'],
      cta: 'Book Demo',
    },
    season: {
      name: 'Player Premium Pass',
      subtitle: 'Full League Season',
      price: '$6.99 CAD',
      features: ['Full season player pass', 'Verified career stats & box scores', 'Leaderboard inclusion', '10% store discount'],
      cta: 'Book Demo',
      badge: 'Season Pass',
    },
    enterprise: {
      name: 'Roster Player',
      subtitle: 'League Registration',
      price: 'Free',
      features: ['Team roster listing', 'Basic game participation', 'Live score tracking'],
      cta: 'Contact Us',
    },
  },
  footer: {
    title: 'Ready to run your next league?',
    fallbackPrefix: 'Or email us at',
  },
};

export default function OperatorLanding() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div className="min-h-screen bg-background text-foreground">
        <section className="bg-gradient-to-br from-background via-sbbl/30 to-live/30 px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">{CONFIG.hero.title}</h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">{CONFIG.hero.subtext}</p>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-8 inline-flex items-center rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CONFIG.hero.cta}
            </button>
          </div>
        </section>

        <section className="px-4 py-10">
          <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-3">
            {CONFIG.proofStats.map((stat) => (
              <article key={stat.value} className="rounded-lg border border-border bg-card p-6 text-center">
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="mt-2 text-sm text-muted-foreground">{stat.label}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="px-4 py-10">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-bold">How It Works</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {CONFIG.steps.map((step) => (
                <article key={step.title} className="rounded-lg border border-border bg-card p-6">
                  <step.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                  <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-10">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-center text-2xl font-bold">Pricing Tiers</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <article className="rounded-lg border border-border bg-card p-6">
                <h3 className="text-xl font-semibold">{CONFIG.pricing.starter.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{CONFIG.pricing.starter.subtitle}</p>
                <p className="mt-4 text-2xl font-bold">{CONFIG.pricing.starter.price}</p>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{CONFIG.pricing.starter.features.map((item) => <li key={item}>• {item}</li>)}</ul>
                <button type="button" onClick={() => setIsModalOpen(true)} className="mt-6 w-full rounded-md border border-border px-4 py-2 font-medium">{CONFIG.pricing.starter.cta}</button>
              </article>

              <article className="relative rounded-lg border-2 border-primary bg-card p-6">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">{CONFIG.pricing.season.badge}</span>
                <h3 className="text-xl font-semibold">{CONFIG.pricing.season.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{CONFIG.pricing.season.subtitle}</p>
                <p className="mt-4 text-2xl font-bold">{CONFIG.pricing.season.price}</p>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{CONFIG.pricing.season.features.map((item) => <li key={item}>• {item}</li>)}</ul>
                <button type="button" onClick={() => setIsModalOpen(true)} className="mt-6 w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">{CONFIG.pricing.season.cta}</button>
              </article>

              <article className="rounded-lg border border-border bg-card p-6">
                <h3 className="text-xl font-semibold">{CONFIG.pricing.enterprise.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{CONFIG.pricing.enterprise.subtitle}</p>
                <p className="mt-4 text-2xl font-bold">{CONFIG.pricing.enterprise.price}</p>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{CONFIG.pricing.enterprise.features.map((item) => <li key={item}>• {item}</li>)}</ul>
                <a href={`mailto:${CONFIG.email}`} className="mt-6 inline-flex w-full items-center justify-center rounded-md border border-border px-4 py-2 font-medium">{CONFIG.pricing.enterprise.cta}</a>
              </article>
            </div>
          </div>
        </section>

        <footer className="px-4 py-16">
          <div className="mx-auto max-w-4xl rounded-lg border border-border bg-surface-overlay p-8 text-center">
            <h2 className="text-2xl font-bold">{CONFIG.footer.title}</h2>
            <button type="button" onClick={() => setIsModalOpen(true)} className="mt-6 inline-flex items-center rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground">
              {CONFIG.hero.cta}
            </button>
            <p className="mt-4 text-sm text-muted-foreground">
              {CONFIG.footer.fallbackPrefix} <a href={`mailto:${CONFIG.email}`} className="underline">{CONFIG.email}</a>
            </p>
          </div>
        </footer>
      </div>

      <BookingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        calendlyUrl={CONFIG.calendlyUrl}
        title="Book a Free 20-Min Demo"
      />
    </>
  );
}
