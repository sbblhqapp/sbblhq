# Correction: Canonical Platform Monetization Model ($3.99 CAD PPV & $6.99 CAD Season Pass)

- **Date:** 2026-08-19
- **Scope:** Project-wide & Global (Pricing, Worker Checkout, Frontend Display, Marketing Surfaces, Legal Terms)
- **Affected Pages:** `src/lib/auth/subscription.ts`, `src/worker/index.ts`, `src/pages/OperatorLanding.tsx`, `src/pages/TermsOfService.tsx`, `src/pages/Support.tsx`, `src/pages/Billing.tsx`, `src/pages/Onboarding.tsx`, `src/components/live/PaywallGate.tsx`
- **Promotion Decision:** Core Directive & User-Pattern Rule

## Original Assumptions vs. Corrected State

### 1. Platform Monetization Boundaries
- **Original Assumption:** Hypothetical B2B SaaS operator tiers ($49 CAD / $299 CAD) were introduced during GTM scoping.
- **Corrected State:** The ONLY monetization streams in the SBBL HQ platform are:
  1. **Livestream Pay-Per-View (PPV):** Exactly **$3.99 CAD** per game.
  2. **Player Premium Option (Season Pass):** Exactly **$6.99 CAD** per season pass.
  3. **General Roster Player Registration & Fan Accounts:** 100% **Free**.

### 2. Operational Invariants
- **Worker Endpoints:** `/api/stripe/checkout-ppv` hardcodes unitAmount to `399` cents ($3.99 CAD). `/api/player/checkout` charges `PLAYER_REGISTRATION_PRICE_CAD` (699 cents = $6.99 CAD).
- **Alberta GST:** 5% GST is applied at Stripe checkout ($3.99 + 5% = $4.19 CAD total; $6.99 + 5% = $7.34 CAD total).
- **Surface Consistency:** All marketing, support, and legal pages reflect this strict 2-tier monetization structure with zero SaaS operator bloat.
