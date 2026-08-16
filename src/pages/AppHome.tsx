import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Play, ShoppingBag, ChevronRight, Trophy, Zap, Shield } from 'lucide-react';
import { LEAGUE_REGISTRY } from '@/lib/leagues';
import { PotgCard } from '@/components/ui/PotgCard';
import { SeasonFeatureCard } from '@/components/season/SeasonShowcase';
import { useBag } from '@/contexts/BagContext';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from '@/lib/api/client';
import { fetchPublicPotg } from '@/lib/api/public';
import { mapPotgPublicationRows } from '@/lib/potg';
import type { PlayerOfTheGame, Product } from '@/types';

const AppHomePage = () => {
  const { addToBag } = useBag();

  // All home-page data comes from the public worker endpoints. No mock.
  const productsQuery = useQuery({
    queryKey: ['public-products'],
    queryFn: () => apiFetch<{ ok: boolean; data: Product[] }>('/api/public/products'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const featuredProducts = useMemo<Product[]>(() => {
    const all = productsQuery.data?.data ?? [];
    return all.filter((p) => p.badge === 'SALE' && p.price > 0).slice(0, 3);
  }, [productsQuery.data]);

  const potgQuery = useQuery({
    queryKey: ['public-potg'],
    queryFn: () => fetchPublicPotg(),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const potgList = useMemo<PlayerOfTheGame[]>(
    () => mapPotgPublicationRows(potgQuery.data?.data as Record<string, unknown>[] | undefined),
    [potgQuery.data],
  );

  return (
    <div className="min-h-screen">

      {/* ── BRAND HERO ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#0A0A0A]" style={{ minHeight: '560px' }}>
        {/* Photo background — LCP candidate on `/`, so explicit dimensions,
            responsive srcset, high fetch priority, and async decode keep
            first paint unblocked while still letting the browser treat this
            as the largest-content element. */}
        <img
          src="/assets/hero-mobile.png"
          srcSet="/assets/hero-mobile.png 768w, /assets/hero-desktop.png 1920w"
          sizes="100vw"
          alt=""
          width={1920}
          height={1080}
          className="absolute inset-0 w-full h-full object-contain object-center"
          draggable={false}
          fetchPriority="high"
          decoding="async"
          loading="eager"
        />
        <div className="absolute inset-0 bg-black/45" />
        <div className="absolute inset-0 [background:linear-gradient(to_right,rgba(10,10,10,0.85)_0%,rgba(10,10,10,0.3)_55%,transparent_100%)]" />
        <div className="absolute inset-0 [background:radial-gradient(ellipse_at_20%_65%,rgba(201,168,76,0.18)_0%,transparent_50%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-background to-transparent" />

        <div className="relative container py-20 md:py-28 lg:py-36
                        flex flex-col gap-12 lg:flex-row lg:items-center lg:justify-between lg:gap-16">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }} className="max-w-xl">

            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary mb-4">The Premier Basketball Platform</p>

            <h1 className="font-display leading-none uppercase">
              <span className="block text-[clamp(4rem,10vw,7.5rem)] font-bold tracking-tight text-foreground leading-[0.9]">SBBL</span>
              <span className="block text-[clamp(4rem,10vw,7.5rem)] font-bold tracking-tight text-primary leading-[0.9]">HQ</span>
            </h1>

            <p className="text-muted-foreground text-base md:text-lg max-w-sm mt-6 leading-relaxed font-medium">
              Three leagues. Live games. Real-time stats. One platform built for the court.
            </p>

            <div className="flex flex-wrap items-center gap-3 mt-8">
              <Link to="/live" className="gold-bg px-7 py-3.5 font-display font-bold text-sm uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
                <Play className="w-4 h-4" /> Watch Live
              </Link>
              <Link to="/store" className="px-7 py-3.5 font-display font-bold text-sm uppercase tracking-wider rounded-sm inline-flex items-center gap-2 border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                <ShoppingBag className="w-4 h-4" /> Shop
              </Link>
            </div>
          </motion.div>

          {/* Season key art — secondary highlight, deliberately sized well below
              the headline so the hero copy stays the focal point. */}
          <SeasonFeatureCard className="self-start lg:self-auto" />
        </div>
      </section>

      {/* ── THREE LEAGUES ──────────────────────────────────────── */}
      <section className="container py-14 md:py-20">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">Active Leagues</p>
            <h2 className="font-display text-2xl md:text-3xl font-bold uppercase tracking-tight">Choose Your League</h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {LEAGUE_REGISTRY.map((l, i) => (
            <motion.div
              key={l.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <Link
                to={`/league/${l.id}`}
                className="panel group relative overflow-hidden flex flex-col items-center text-center p-8 hover:border-primary/30 transition-all duration-300 hover:shadow-[0_0_32px_-8px_hsl(43_52%_54%/0.2)]"
              >
                {/* League glow */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: `radial-gradient(ellipse at 50% 30%, hsl(var(--${l.id}) / 0.12) 0%, transparent 65%)` }} />

                {/* Logo */}
                <div className="relative w-20 h-20 mb-5 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: `radial-gradient(circle, hsl(var(--${l.id}) / 0.2) 0%, transparent 70%)` }} />
                  <img
                    src={l.logo}
                    alt={l.logoAlt}
                    className="w-16 h-16 object-contain relative z-10 transition-transform duration-300 group-hover:scale-110"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>

                <h3 className="font-display text-2xl font-bold uppercase tracking-tight mb-1">{l.shortName}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-6 line-clamp-2">{l.name}</p>

                <span className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${l.accentClass}`}>
                  View League <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── APP PILLARS ────────────────────────────────────────── */}
      <section className="border-y border-border bg-secondary/30">
        <div className="container py-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: <Zap className="w-5 h-5 text-live" />, title: 'Live Scoring', desc: 'Real-time game updates, scorebug, and live chat during every broadcast.' },
              { icon: <Trophy className="w-5 h-5 text-primary" />, title: 'Stats & Leaderboards', desc: 'Full season stats, player rankings, and Player of the Game awards.' },
              { icon: <Shield className="w-5 h-5 text-primary" />, title: 'League Operations', desc: 'Team management, CSV imports, roster control, and media publishing.' },
            ].map(p => (
              <div key={p.title} className="flex items-start gap-4">
                <div className="p-2.5 bg-secondary rounded-sm border border-border flex-shrink-0">{p.icon}</div>
                <div>
                  <p className="text-sm font-bold">{p.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── POTG ACROSS ALL LEAGUES ────────────────────────────── */}
      {potgList.length > 0 && (
        <section className="container py-14">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">Game Night Recap</p>
              <h2 className="font-display text-xl md:text-2xl font-bold uppercase tracking-tight flex items-center gap-2">
                <Trophy className="w-5 h-5 text-primary" /> Players of the Game
              </h2>
            </div>
            <Link to="/leaderboards" className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1">
              Leaderboards <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex gap-4 overflow-x-auto scrollbar-hidden pb-2">
            {potgList.map((potg, i) => (
              <PotgCard key={potg.id} potg={potg} featured={i === 0} />
            ))}
          </div>
        </section>
      )}

      {/* ── FEATURED STORE ─────────────────────────────────────── */}
      {featuredProducts.length > 0 && (
        <section className="container py-14 border-t border-border">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary mb-1">Official Merch</p>
              <h2 className="font-display text-xl md:text-2xl font-bold uppercase tracking-tight">From the Store</h2>
            </div>
            <Link to="/store" className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1">
              All Products <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredProducts.map(p => (
              <div key={p.id} className="panel overflow-hidden group hover:border-primary/30 transition-colors">
                <div className="relative aspect-square overflow-hidden bg-secondary">
                  <img src={p.image} alt={p.name} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                  <span className="absolute top-2 left-2 px-2 py-0.5 bg-primary text-primary-foreground text-[9px] font-bold uppercase tracking-wider rounded-sm">Sale</span>
                </div>
                <div className="p-4">
                  <p className="font-display font-bold text-sm">{p.name}</p>
                  {p.colors && <p className="text-[10px] text-muted-foreground mt-0.5">{p.colors[0]}</p>}
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-sm font-bold text-primary">${p.price.toLocaleString()}</span>
                    <button onClick={() => addToBag(p.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 gold-bg text-xs font-bold uppercase tracking-wider rounded-sm">
                      <ShoppingBag className="w-3 h-3" /> Add
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── APP CTA ────────────────────────────────────────────── */}
      <section className="container py-14">
        <div className="panel p-8 md:p-12 relative overflow-hidden text-center">
          <div className="absolute inset-0 [background:radial-gradient(ellipse_at_50%_50%,rgba(201,168,76,0.08)_0%,transparent_65%)]" />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-primary mb-3">Mobile App</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold uppercase tracking-tight mb-3">SBBL HQ</h2>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
              Live games, stats, your player profile, and league news — all in one place. Available on iOS and Android.
            </p>
            <div className="flex items-center justify-center gap-3">
              <span className="px-5 py-2.5 border border-border rounded-sm text-xs font-bold uppercase tracking-wider text-muted-foreground">iOS — Coming Soon</span>
              <span className="px-5 py-2.5 border border-border rounded-sm text-xs font-bold uppercase tracking-wider text-muted-foreground">Android — Coming Soon</span>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};

export default AppHomePage;
