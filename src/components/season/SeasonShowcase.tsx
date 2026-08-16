import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { getSeasonShowcase, type SeasonShowcase } from '@/lib/seasonShowcase';
import type { LeagueId } from '@/types';

/**
 * Season key-art surfaces.
 *
 * Two consumers, one asset registry:
 *  - `SeasonShowcaseBanner` — wide hero banner at the top of a league page.
 *  - `SeasonFeatureCard`    — small portrait highlight beside the app home hero.
 *
 * Both render `null` when the league has no active showcase, so adding or
 * retiring season art is a data change in `src/lib/seasonShowcase.ts` only.
 */

type BannerProps = {
  leagueId: LeagueId | undefined | null;
  className?: string;
};

/**
 * Full-width season banner. Art-directed: 12:5 wide crop from `md` up,
 * 1:1 crop below it, so the lockup stays legible on a phone.
 *
 * Aspect ratio is reserved by the wrapper at both breakpoints, so this never
 * contributes cumulative layout shift.
 */
export const SeasonShowcaseBanner = ({ leagueId, className = '' }: BannerProps) => {
  const showcase = getSeasonShowcase(leagueId);
  if (!showcase) return null;

  const { bannerDesktop, bannerMobile, alt } = showcase;

  return (
    <section
      aria-label={`${showcase.seasonLabel} season artwork`}
      className={`relative bg-[#0A0A0A] ${className}`}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="container pt-6 md:pt-8"
      >
        <div
          className="relative overflow-hidden rounded-sm border border-primary/25 aspect-square md:aspect-[12/5]"
          style={{ boxShadow: '0 0 40px -12px rgba(201,168,76,0.28)' }}
        >
          <picture>
            <source media="(min-width: 768px)" type="image/webp" srcSet={bannerDesktop.webp} />
            <source media="(min-width: 768px)" type="image/jpeg" srcSet={bannerDesktop.jpg} />
            <source type="image/webp" srcSet={bannerMobile.webp} />
            <img
              src={bannerMobile.jpg}
              alt={alt}
              width={bannerMobile.width}
              height={bannerMobile.height}
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
              fetchPriority="high"
              decoding="async"
              loading="eager"
            />
          </picture>
          {/* Bottom bleed so the artwork resolves into the page rather than
              stopping at a hard edge. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0A0A0A] to-transparent" />
        </div>
      </motion.div>
    </section>
  );
};

type FeatureCardProps = {
  /** Which league's art to feature. Defaults to SBBL. */
  leagueId?: LeagueId;
  className?: string;
};

/**
 * Portrait season card used as a *secondary* highlight beside the app home
 * hero headline. Deliberately small and off to one side: the hero copy stays
 * the focal point, this reads as a supporting feature.
 *
 * `fetchPriority="low"` keeps it from competing with the hero background for
 * LCP bandwidth.
 */
export const SeasonFeatureCard = ({ leagueId = 'sbbl', className = '' }: FeatureCardProps) => {
  const showcase: SeasonShowcase | null = getSeasonShowcase(leagueId);
  if (!showcase) return null;

  const { portrait, alt } = showcase;

  return (
    <motion.aside
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className={`shrink-0 ${className}`}
    >
      <Link
        to={`/league/${showcase.leagueId}`}
        aria-label={`${alt}. View the ${showcase.seasonLabel} league page.`}
        className="group relative block w-[150px] sm:w-[176px] lg:w-[208px] xl:w-[232px]
                   overflow-hidden rounded-sm border border-primary/30
                   transition-transform duration-300 ease-out hover:-translate-y-1
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
        style={{ boxShadow: '0 18px 40px -18px rgba(0,0,0,0.85), 0 0 28px -14px rgba(201,168,76,0.45)' }}
      >
        <div className="aspect-[3/4]">
          <picture>
            <source type="image/webp" srcSet={portrait.webp} />
            <img
              src={portrait.jpg}
              alt={alt}
              width={portrait.width}
              height={portrait.height}
              className="h-full w-full object-cover"
              draggable={false}
              fetchPriority="low"
              decoding="async"
              loading="eager"
            />
          </picture>
        </div>
        {/* Gold sheen on hover — reinforces that the card is interactive. */}
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100
                        [background:linear-gradient(115deg,transparent_35%,rgba(201,168,76,0.16)_50%,transparent_65%)]" />
      </Link>
    </motion.aside>
  );
};
