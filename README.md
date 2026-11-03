# 96 News HD unified API

One Bun/Express API for the public news website, private administration, and reporter profiles. News and profile records use Supabase PostgreSQL. The existing profile Supabase Auth user is the only owner; a database login is not an application login.

## Fresh start

Old MongoDB articles, users, passwords, memberships and payments are not imported. The original source database is untouched. Previous MongoDB server code is preserved under `legacy/mongodb/` and is not deployed.

Copy `.env.example` to `.env` and set the server credentials. `OWNER_USER_ID` is the UUID of the existing profile admin under Supabase Authentication. Never put the database password, Supabase secret key or Cloudinary API secret in frontend variables.

```sh
bun install --frozen-lockfile
bun run db:migrate
bun run db:migrate --apply
bun run dev
```

The first schema command previews the SQL checksum. `--apply` creates empty news tables, six starter labels, owner binding and API functions in one transaction. Existing profile tables and records are retained. For a new project the profile schema is also created. Repeating the same migration is safe; changing an already applied migration is rejected.

The API listens on port 3001. For the main website, put `VITE_API_URL=http://localhost:3001` in its ignored `.env.local`. The profile frontend proxies `/api` to port 3001 in development.

## Netlify

`netlify.toml` runs `bun run build`: TypeScript validation followed by schema setup. Netlify installs packages using Bun. Database setup runs during the hosted build, not in request handlers. A setup failure stops the build and retains the previous published deploy. Deployment uses the existing `api.96newshd.com` site. GitHub publishing is independent.

Configure `DATABASE_URL` and `OWNER_USER_ID` in the site's production **Builds** environment. Configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OWNER_USER_ID`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CRON_SECRET`, `PUBLIC_WEB_ORIGIN` and `CORS_ORIGINS` for production **Functions**. Netlify configuration files do not supply runtime secrets; use site environment variables. Never upload `.env`, backups, `.git` or `node_modules` as source files.

The API uses the Node.js 24 Netlify Functions runtime with `serverless-http`. Sharp remains an external native dependency. `photo-cleanup` runs daily at 02:00 UTC and uses the same tracked reporter-photo cleanup as the owner API.

## API

Public reads:

- `GET /api/health`: runtime configuration status; a successful news request additionally verifies database setup.
- `GET /api/posts?tag=pakistan&limit=12&skip=0`: published news, with filtered `totalCount` and stable pagination. `query` searches literal title text.
- `GET /api/posts/:idOrSlug`: published article.
- `GET /api/tags` and `/api/tags/:slug`: public labels and published counts.
- `GET /api/profiles/:uuid` and `/contact.vcf`: existing privacy-filtered reporter profile and active public contact card.

Compatibility reads `/api/getpost`, `/api/getpostbyid/:reference`, `/api/search?query=...` and social metadata `/post/:reference` remain available.

All `/api/admin/*` routes require a Bearer access token validated with Supabase `auth.getUser`, and its user ID must exactly equal `OWNER_USER_ID`. Role labels and user-editable metadata cannot grant access. There are no signup, membership, payment or public account-management APIs.

Owner news operations:

- `/api/admin/session` verifies owner access.
- `/api/admin/news/posts`: GET list, POST create.
- `/api/admin/news/posts/:reference`: GET detail, PUT update, DELETE remove. Updates include the current `version`; deletion uses `If-Match: <version>`. Stale mutations return 409.
- `/api/admin/news/tags`: GET labels, POST `{name, slug?}`. PUT `/api/admin/news/tags/:uuid` renames a label; DELETE removes an unused, non-reserved label.
- POST `/api/admin/news/photos`: multipart `photo` upload, returning `{url}`.

Posts accept `title`, HTML `article`, uploaded `thumbnailImage`, one to ten tag UUIDs, and `status` (`draft` or `published`). Identity, author and slug are server-owned. Urdu slugs keep readable Unicode, normalize punctuation/spacing and include a unique ID suffix. Editing a title preserves its URL. Public responses retain the legacy category field while exposing all assigned labels in `tags`.

Reporter CRUD, renewal, activity and photo operations retain the existing profile API paths. Existing public QR URLs remain stable. The private profile administration UI stays in its frontend repository; the future news admin UI is separate work.

## Security and checks

RLS is enabled on every news table, with no direct anon/authenticated access. Only the server secret client can call news functions. Public responses explicitly exclude private database fields. Input validation, article sanitization, image decoding/size limits, CORS allowlisting and optimistic locking protect API boundaries.

```sh
bun test
bun run typecheck
```

`tests/*.sql` are rollback-based checks for disposable PostgreSQL only: they require the test owner UUID in `tests/news.sql`. Do not run them against production.

Limits: process-local rate limiting needs a shared store before scaling across instances. Reporter edits retain their previous last-write-wins behavior. News thumbnail cleanup is deferred; uploaded news images are retained after replacement/deletion. Disable public signup in Supabase Auth settings; API authorization still denies every user except the configured owner.
