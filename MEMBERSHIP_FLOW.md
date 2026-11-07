# Membership beta — local only

No deployment or production schema change is part of this work. Existing reporter UUIDs and printed public links stay unchanged. Do not reset or seed the hosted database.

## Flow

`/apply` → Supabase email/password signup → email confirmation → save application → private payment receipt → owner review → profile/member account.

Only the existing owner ID can use `/api/admin/*`. Membership designations have no administrative permissions. Applicants cannot supply a fee, approval status, reporter mapping, expiry date or another user ID. The API validates the Supabase identity with `getUser()` on every member request.

Approval creates a new reporter and the membership link in one transaction, with 30 days between issue and expiry dates. A repeated/stale approval cannot create another profile. A CNIC already belonging to a reporter aborts approval; existing printed credentials are never attached to an applicant automatically or overwritten. Rejections include a reason and permit receipt resubmission.

## Role catalog

Admin: `/admin/membership-roles`. Add/edit name, province/district/tehsil/city level, optional fixed province, fee and availability. Disable a role rather than deleting it. New applications use the current catalog version; stale quotes are refused. Submitted role names and fees are snapshots, so later catalog edits do not rewrite applications.

The nine initial fees match the old application system: Reporter 4000, City Reporter 4500, Crime Reporter 4500, Tehsil Reporter 5000, Deputy Bureau Chief 6000, Bureau Chief 6500, District Chief Reporter 7000, Chief Reporter Punjab 10000, Incharge Representatives Punjab 20000 (PKR).

Admin: `/admin/payment-settings` manages receiving accounts, account titles, instructions and whether collection is open. Existing old receiving accounts are seeded with collection disabled; the owner can review and edit them. Local setup uses test-only instructions.

Admin: `/admin/applications`. Check the receipt against the actual receiving account, enter the father's name required for the reporter card, then approve or reject. Member login is `/login`, account `/account`; printed public links remain `/p/{uuid}`.

## Start local development

From this backend directory:

```sh
bun install --frozen-lockfile
bun run local:start
bun run local:setup
bun run dev:local
```

If the default image registry is throttled, use `SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io bun run local:start`. This uses the official Supabase image mirror. First startup downloads Docker images.

`local:setup` reads only the local CLI status, rejects hosted database/Auth URLs, creates a separate local owner, applies `001_news` and `002_membership` locally and writes ignored local environment files for all three frontends. Previous environment files are preserved in ignored backups. Credentials are in `.netlify/local-owner.json` with owner-only file permissions. No hosted owner credentials are reused.

In the frontend workspace, use separate terminals:

```sh
bun run dev
bun run dev:admin
bun run dev:profile
```

Website: http://localhost:3000/apply. Admin: http://localhost:5174/admin. Profile: http://localhost:5175/login. Test email inbox: http://localhost:54324. Confirm signup emails there, then return to the original application tab to sign in. Before verification the draft/photo stay in memory; closing that tab loses the draft. Passwords are managed only by Supabase Auth.

Local payment instructions explicitly say not to send money. Use a sample image as the receipt. Local-only mode refuses hosted API/database URLs and never uploads to production Cloudinary. Approved local portraits use a separate local public bucket; pending portraits and receipts use a private bucket.

To stop local Supabase without deleting its database, run `bunx --bun supabase stop`. Do not use `db reset` as a normal startup step.

## Checks

```sh
bun run typecheck
bun test
bun run test:db
# After local:setup and healthy local Supabase services:
bun run test:local
```

`test:db` creates and destroys a disposable local PostgreSQL cluster, never reads `DATABASE_URL`, and verifies transaction conflicts, service-role permissions, 30-day dates and existing-profile preservation. API tests mock Auth and storage. A full Supabase signup/storage smoke test still requires the local Docker services to be healthy.

## Before a future release

Hosted payment collection starts disabled in the database. Review and enable receiving accounts through `/admin/payment-settings`; the API and application form use those saved settings. Configure hosted email confirmation/redirect URLs, review/back up and apply the additive `002_membership` migration, and provide only publishable keys to frontend environments. The backend build currently runs pending migrations, so a future deployment must include that schema review.

Receipts and pending portraits are private, signed receipt URLs last 60 seconds, and Supabase authenticated/anonymous clients cannot read or mutate membership tables directly. Private uploads are retained for review; define an appropriate retention policy before opening applications broadly. GA4 is excluded from application/account/search routes and disabled locally. Public-site Enhanced Measurement remains controlled in Google Analytics settings.
