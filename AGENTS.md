# PROCELYX public website — agent instructions

Scope: this repository is the public PROCELYX website (https://procelyx.cz). It is public: never commit anything that is not already meant to be public.

## Hard boundaries

- Work on branch `procelyx-live` unless the user explicitly requests another flow.
- Follow the repository rules in `CLAUDE.md` (CODEOWNERS, rulesets, content-guard).
- Do not expose secrets.
- Do not commit API keys, passwords, customer data, private technical drawings, mail credentials or Nexus One tokens.
- Do not remove/change Google Workspace MX/SPF/DKIM/DMARC while configuring website DNS.
- Do not publish customer/company names from anonymized use cases without explicit permission.

## Production

- Cloudflare Worker + Static Assets.
- `wrangler.jsonc` is the deployment source of truth.
- Apex: `https://procelyx.cz`
- www must redirect to apex.
- Contact endpoint: `POST /api/contact`.
- Primary mail provider: Google Workspace / signed Google Apps Script gateway, selected by the owner on 2026-09-23.
- Required primary Worker secrets: `GOOGLE_MAIL_URL`, `GOOGLE_MAIL_SECRET`.
- `CONTACT_PROVIDER=google`; retain `RESEND_API_KEY` for a controlled switch to `resend` after domain verification and a real delivery test. Do not automatically fall back after ambiguous sends.
- Prefer env vars `CONTACT_TO` and `CONTACT_FROM` for admin-configurable delivery.

## Near-term priorities

1. Website must be fully functional by tomorrow.
2. Final founder photo must render sharply and without a visible caption.
3. Contact form must be proven end-to-end by a real received email.
4. Resend domain verification must not damage Google Workspace.
5. Articles and SEO routes must remain indexable and free of broken links.
6. Article images should be optimized and relevant to article content.

## UX / brand

- Czech-first.
- Professional, practical, non-hype tone.
- PROCELYX is cross-industry automation, not only manufacturing.
- Manufacturing expertise is proof, not the market boundary.
- Lead with recognizable process pain.
- Human-in-the-loop for sensitive decisions.
- Visual language: dark cinematic / teal-cyan accents / realistic business and engineering situations.

## Future integration

Nexus One is a future enhancement, not a launch blocker.

Target later:
`website form -> Worker -> Nexus One lead -> AI qualification -> task/follow-up -> human review`

Keep the contact endpoint modular so Nexus One can be added without breaking email delivery.

Read `CLAUDE.md` and `ADMIN_RUNBOOK.md` before changing architecture.
