# Correction: Canonical Remote Migrated to `sbblhqapp/sbblhq`

- **Date:** 2026-08-09
- **Scope:** Global (git remote, GitHub Actions secrets, all operator scripts, documentation)
- **Affected Pages:** `CLAUDE.md`, `CHANGELOG.md`, `docs/ops/REPO_MIGRATION_2026-08-09.md`, `scripts/*.ts`, `scripts/lib/sbbl-env.ts` (new), `scripts/archive/deploy_cad_pr.js`
- **Promotion Decision:** Core directive (`CLAUDE.md` rule 11) + runbook doc

## Original Assumption vs. Corrected State

- **Original Assumption:** `apexbusiness-systems/sbbl-hq` is the canonical
  remote; scripts, docs, and CI all point there.
- **Corrected State:** Canonical remote is now `https://github.com/sbblhqapp/sbblhq`.
  The old repo is an **archive** — git history was imported, but pull
  requests and issues were **not** (the new repo started with 0 PRs), so
  historical PR permalinks intentionally still resolve against the archived
  repo. Local `origin` repointed; old remote kept as `legacy-origin`.

## What Did NOT Change

Cloudflare is untouched by design: the Worker (`sbbl-hq-worker`), account,
zone (`sbbl-hq.icu`), and custom domains are not keyed to the GitHub
repository — `wrangler.jsonc` required no edit. Verified live via the
Cloudflare API during the migration (deployment history, zone status).

## Two Latent Defects Found While Migrating

1. **Every script in `scripts/` was inert.** All four (`grant-regular-admin.ts`,
   `verify-deployment.ts`, `deploy-migration.ts`, `push-via-link.ts`) parsed
   the operator ENV file with regexes like `/SUPABASE_URL=…/`, but that file
   is Markdown — underscores arrive backslash-escaped (`SUPABASE\_URL=`,
   `sbp\_badb…`) — so no pattern ever matched and each script exited "Failed
   to parse credentials" before doing any work. `push-via-link.ts` also
   matched `SUPABASE_TOKEN=`, a key that never existed in the file.
2. **Ambient shell environment could silently retarget the database.** The
   first live grant run resolved to an unrelated Supabase project instead of
   the SBBL one, because a stray `SUPABASE_URL` exported in the shell
   outranked the explicitly-supplied ENV file path. It failed safely only by
   luck — that project's schema has no `admin_email_grants` table.

## Resolution

- New shared loader `scripts/lib/sbbl-env.ts`: strips Markdown escaping before
  parsing, and makes `SBBL_ENV_FILE` (when set) outrank `process.env` rather
  than the reverse.
- All four scripts migrated to the shared loader; target email parameterized
  (argv or `ADMIN_EMAIL`) instead of hardcoded.
- 17 GitHub Actions secrets re-provisioned on the new repo (an import carries
  none, and `deploy.yml` hard-fails on a missing `SUPABASE_SERVICE_ROLE_KEY`).
  `OMNIHUB_SIGNING_SECRET` / `OMNIHUB_VERIFY_KEY` remain outstanding — not in
  the operator ENV file; deploys are unaffected since optional secrets are
  skipped when empty and the live Worker retains its existing values.
- Verified: `npm run typecheck`, `npm run lint`, `npm test` (1424/1424 at the
  time), `npm run build` — all green. Live grant re-verified against the
  production Supabase project independently after landing.

## Related

- [[2026-08-09-regular-admin-permission-model]]
- [[2026-08-09-ops-console-uuid-elimination]]
