import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OperatorLanding from '@/pages/OperatorLanding';

describe('OperatorLanding Page (GTM SaaS Surface)', () => {
  it('renders without any TBD placeholder text', () => {
    const { container } = render(<OperatorLanding />);
    expect(container.textContent).not.toContain('[EMAIL TBD]');
    expect(container.textContent).not.toContain('[PRICE TBD]');
  });

  it('renders explicit transparent tier pricing', () => {
    render(<OperatorLanding />);
    expect(screen.getByText('$3.99 CAD')).toBeInTheDocument();
    expect(screen.getByText('$6.99 CAD')).toBeInTheDocument();
    expect(screen.getAllByText('Contact Us').length).toBeGreaterThan(0);
  });

  it('renders valid canonical contact email in mailto links', () => {
    render(<OperatorLanding />);
    const mailtoLinks = screen.getAllByRole('link', { name: /info-outreach@sbbl-hq.icu|Contact Us/i });
    expect(mailtoLinks.some(link => link.getAttribute('href')?.includes('mailto:info-outreach@sbbl-hq.icu'))).toBe(true);
  });

  it('opens booking modal when clicking demo CTA buttons', () => {
    render(<OperatorLanding />);
    const heroCta = screen.getAllByRole('button', { name: /Book a Free 20-Min Demo/i })[0];
    fireEvent.click(heroCta);
    expect(screen.getByRole('dialog', { name: /Book a Free 20-Min Demo/i })).toBeInTheDocument();
  });
});
