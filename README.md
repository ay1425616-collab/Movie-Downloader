# CineWave Downloads

Original movie download directory: React SSR public pages, React admin, Hono Worker, Zod validation, D1/SQLite. Yeh implementation **work in progress** hai; production-ready ya deployed claim nahi hai. Actual validation aur missing functionality ke liye [status report](docs/STATUS.md) padhein.

## Local setup

Node 24 aur npm use karein. Existing isolated checkout `/workspace/Movie-Downloader` use karein; worktree banana zaroori nahi hai.

```sh
cd /workspace/Movie-Downloader
npm install
npm run db:migrate
npm run db:seed
npm run build
npm run dev
```

Server start hone ke baad `python3 tests/smoke.py` se clean-demo readiness verify karein.

Local Worker port 8787 par public pages aur `/admin` serve karta hai. Frontend changes ke baad `npm run build` repeat karein. Separate Vite UI development: `npm run dev -w @cinewave/web`. API proxy Worker port 8787 use karta hai.

`npm install` ke successful hone par generated lockfile review aur commit karein, aur future installs/CI mein `npm ci` use karein. Lockfile ab generate aur install verify ho gaya hai. CI npm ci use karta hai.

## Secure first admin

`wrangler.jsonc` ka local configuration override ya ignored `.dev.vars` use karein. Secret Git mein kabhi na daalein. `.env.example` documentation hai; Wrangler local bindings `.dev.vars` se read karta hai.

```text
BOOTSTRAP_ENABLED=true
BOOTSTRAP_TOKEN=<generate-a-long-random-secret-locally>
```

Same-origin request required hai. Local browser console se bootstrap request bhejein, ya terminal mein:

```sh
read -rs BOOTSTRAP_TOKEN
read -r ADMIN_EMAIL
read -rs ADMIN_PASSWORD
export BOOTSTRAP_TOKEN ADMIN_EMAIL ADMIN_PASSWORD
python3 scripts/bootstrap.py http://127.0.0.1:8787
unset BOOTSTRAP_TOKEN ADMIN_EMAIL ADMIN_PASSWORD
```

14+ character strong password required. Bootstrap only succeeds when no admin exists and a matching bearer token is supplied. Creation ke baad `BOOTSTRAP_ENABLED=false` karein aur bootstrap secret remove karein. Production HTTPS par login/logout verify karein; Secure cookies HTTP browser setups mein limitations rakh sakte hain.

## Content workflow

1. `/admin` login karke draft metadata create karein.
2. Owner rights panel mein actual license aur evidence verify kare.
3. File variants mein real byte size, codec, audio, format, optional SHA-256 add karein.
4. Approved exact hostnames `ALLOWED_DOWNLOAD_HOSTS` mein comma-separated set karein. HTTPS URLs only. Host ownership aur redirects manually review karein.
5. Authorized mirror aur variant enable karein. Movie publish karein.

Download route har initiation par published state, verified rights, enabled file/mirror, expiry aur approved host dobara check karta hai. Rights revoke karte hi download eligibility stop hoti hai. Tracking download **initiation** hai; completed file transfer nahi. Demo fictional hai aur intentionally koi file/size/quality nahi deta. No streaming or unauthorized links supplied.

## Validation

```sh
npm test
python3 tests/migrations.py
npm run test:unit
npm run typecheck
npm run lint
npm run build
npm run db:migrate
npm run db:seed
npm run dev
# Separate terminal, after installing Playwright browser:
npx playwright install chromium
npm run test:e2e
```

Playwright check mobile catalog and demo detail exercise karta hai. Local auth/CRUD integration suite `node tests/integration.mjs` hai. Iske liye `node scripts/create-test-admin.mjs`, generated `/tmp/cinewave-test-admin.sql` ko local D1 mein apply karein, aur temporary `.dev.vars` mein fixture-only host `downloads.example.invalid` allow karein. Server restart required. Test credentials aur test admin baad mein delete karein; production DB par kabhi na chalayein. `npm run test:unit` five Zod schema validation tests run karta hai. `npm test` Node security checks run karta hai.

## Cloudflare deployment preparation

Cloudflare account authorization ke bina deploy nahi hota. Paid services automatically activate na karein.

```sh
npx wrangler login
npx wrangler d1 create cinewave
# Returned database_id ko wrangler.jsonc mein set karein.
npx wrangler d1 migrations apply cinewave --remote
# Optional fictional demo seed:
npx wrangler d1 execute cinewave --remote --file migrations/seed.sql
npx wrangler secret put BOOTSTRAP_TOKEN
npm run deploy
```

Dashboard/approved configuration mein temporary bootstrap flag set karke first admin create karein, phir disable karein. Wrangler ke returned `workers.dev` URL ko hi use karein; is repo mein live URL invent nahi kiya gaya. Deployment se pehle production host allowlist configure karein. Destination network policy bhi required hosts allow kare. `BOOTSTRAP_TOKEN` securely enter karein, chat ya frontend mein nahi.

Post-deploy: homepage HTML without JS, category filters, movie detail, sitemap XML, login/logout, session expiry, unauthorized admin API 401, invalid mirror rejection, rights revocation, disabled/expired mirror, and initiation count validate karein. Preview screenshots and mobile overflow check karein. All unresolved acceptance checks complete hone tak public production launch na karein.

## Budget

External authorized files initial storage strategy hai. Cloudflare free Workers/D1 allowances account aur current pricing par depend karte hain; current pricing/limits independently verify nahi hue. D1 quotas exceed hone par requests fail ho sakti hain. R2 integrated nahi hai; enabling it may require billing. Free infrastructure unlimited movie bandwidth/storage guarantee nahi karti. Pricing aur terms deployment se pehle official dashboard/docs mein verify karein. Ads disabled hain; network approval ke bina ad scripts inject nahi kiye jaate.

## Operations and migrations

Migration apply karne se pehle remote D1 export karein:

```sh
npx wrangler d1 export cinewave --remote --output /tmp/cinewave-backup.sql
```

Initial migration has no destructive automatic down migration. Rollback ke liye traffic stop karein, verified backup new database mein import karein, binding switch karein, smoke tests run karein. Never drop production tables blindly. Scheduler expired sessions and abuse counters clean karta hai. Download health monitoring not implemented; no server-side arbitrary URL fetch is performed. Admin audit writes exist but full transaction coupling and audit viewer pending hain.

## Troubleshooting

- `proxy:8080` connection failure: cloud networking restore/restart required; TLS verification disable na karein.
- D1 placeholder: create DB and replace ID before remote commands.
- No downloads: rights, publication, file enable, mirror enable/expiry aur exact allowed host check karein.
- Blank admin: run frontend build before starting Worker.
- Login cookie missing: HTTPS and same origin verify karein.
- SQL migration errors: `python3 tests/migrations.py`; local `.wrangler` DB production se separate hai.

See [status](docs/STATUS.md) for known limitations. Source is not a verified production release.
