import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SeasonShowcaseBanner, SeasonFeatureCard } from '@/components/season/SeasonShowcase';
import { SEASON_SHOWCASES, getSeasonShowcase } from '@/lib/seasonShowcase';

const withRouter = (ui: React.ReactElement) => render(<BrowserRouter>{ui}</BrowserRouter>);

describe('season showcase registry', () => {
  it('exposes an active SBBL Season 12 entry', () => {
    const sbbl = getSeasonShowcase('sbbl');
    expect(sbbl).not.toBeNull();
    expect(sbbl?.seasonLabel).toBe('Season 12');
    expect(sbbl?.alt).toContain('August 16, 2026');
  });

  it('returns null for leagues without artwork, and for no league', () => {
    expect(getSeasonShowcase('wbl')).toBeNull();
    expect(getSeasonShowcase('tgifbl')).toBeNull();
    expect(getSeasonShowcase(undefined)).toBeNull();
    expect(getSeasonShowcase(null)).toBeNull();
  });

  it('declares intrinsic dimensions for every image so layout is reserved', () => {
    for (const s of SEASON_SHOWCASES) {
      for (const img of [s.bannerDesktop, s.bannerMobile, s.portrait]) {
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
        expect(img.webp).toMatch(/\.webp$/);
        expect(img.jpg).toMatch(/\.jpg$/);
      }
    }
  });
});

describe('SeasonShowcaseBanner', () => {
  it('renders the SBBL banner with descriptive alt text', () => {
    withRouter(<SeasonShowcaseBanner leagueId="sbbl" />);
    const img = screen.getByAltText(/SBBL Season 12/i);
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toContain('sbbl-s12-banner-mobile');
  });

  it('renders nothing for leagues without season artwork', () => {
    const { container } = withRouter(<SeasonShowcaseBanner leagueId="wbl" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no league is resolved yet', () => {
    const { container } = withRouter(<SeasonShowcaseBanner leagueId={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SeasonFeatureCard', () => {
  it('links to the SBBL league page', () => {
    withRouter(<SeasonFeatureCard />);
    const link = screen.getByRole('link', { name: /SBBL Season 12/i });
    expect(link).toHaveAttribute('href', '/league/sbbl');
  });

  it('uses the portrait asset and does not compete with the hero for LCP', () => {
    withRouter(<SeasonFeatureCard />);
    const img = screen.getByAltText(/SBBL Season 12/i);
    expect(img.getAttribute('src')).toContain('sbbl-s12-feature-portrait');
    expect(img).toHaveAttribute('fetchpriority', 'low');
  });

  it('renders nothing for a league without artwork', () => {
    const { container } = withRouter(<SeasonFeatureCard leagueId="tgifbl" />);
    expect(container).toBeEmptyDOMElement();
  });
});
