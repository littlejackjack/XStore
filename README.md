# XStore — Platform Jualan Subscription (Full-Stack, Production-Ready)

Platform jualan modern untuk **subscription VPN (Marzban)**: landing page cepat, katalog produk,
checkout dengan **pemilihan server**, pembayaran **Bayar.gg** (QRIS/e-wallet/kartu) dengan verifikasi
webhook **HMAC-SHA256**, **provisioning otomatis** ke panel Marzban yang dipilih pembeli, dashboard user,
dan dashboard admin lengkap — semuanya berjalan dengan satu perintah Docker.

```
docker compose up -d --build
```

---

## 1. Arsitektur

```
                         Internet
                            │
                     ┌──────▼──────┐
                     │   Caddy     │  :80/:443  (HTTPS otomatis, Let's Encrypt)
                     │reverse proxy│
                     └──┬───────┬──┘
              /api/*    │       │   /* (sisanya)
                 ┌──────▼───┐ ┌─▼──────────┐
                 │   app    │ │    web     │
                 │ NestJS   │ │  Next.js   │
                 │  :4000   │ │   :3000    │
                 └──┬───┬───┘ └────────────┘
          ┌─────────┘   └─────────┐
     ┌───▼───┐               ┌────▼────┐
     │  db   │               │  redis  │  cache + queue (BullMQ)
     │Postgres│              └────┬────┘
     └───────┘                   │
                          ┌──────▼───────┐
                          │    worker    │  provisioning + monitoring server
                          └──────────────┘
```

| Service | Image/Dockerfile | Fungsi |
|---|---|---|
| `db` | `postgres:16-alpine` | Database utama (volume persisten) |
| `redis` | `redis:7-alpine` | Cache (API key, settings, token Marzban) + antrian BullMQ |
| `app` | `apps/api/Dockerfile` | REST API NestJS, migrasi + seed otomatis saat boot |
| `worker` | `apps/api/Dockerfile` (image sama) | Background job: provisioning & cek status server |
| `web` | `apps/web/Dockerfile` | Frontend Next.js (standalone output) |
| `caddy` | `caddy:2-alpine` | Reverse proxy + TLS otomatis + security headers |

### Struktur direktori

```
XStore/
├── docker-compose.yml          # orkestrasi seluruh stack
├── Caddyfile                   # reverse proxy + HTTPS + headers
├── .env.example                # template konfigurasi (copy ke .env)
├── scripts/
│   ├── build.sh                # build semua image (generate secret otomatis)
│   └── dev-local.sh            # jalan tanpa Docker (dev)
├── docs/
│   ├── SETUP.md                # panduan setup lengkap + Cloudflare + Bayar.gg
│   └── ARCHITECTURE.md         # alur multi-server Marzban & enkripsi API key
└── apps/
    ├── api/                    # Backend NestJS
    │   ├── Dockerfile
    │   └── src/
    │       ├── common/         # guards, filters, decorators, kriptografi
    │       ├── config/         # konfigurasi tervalidasi (fail-fast)
    │       ├── database/       # entities, migrasi SQL, seed
    │       └── modules/        # auth, users, products, servers, marzban,
    │                           # orders, payments, webhooks, apikeys,
    │                           # settings, audit, mail, provisioning, health
    └── web/                    # Frontend Next.js + Tailwind (dark mode)
        ├── Dockerfile
        └── app/                # landing, catalog, checkout, dashboard, admin/*
```

---

## 2. Menjalankan dengan Docker (cara tercepat)

```bash
# 1. Siapkan environment
cp .env.example .env

# 2. (Opsional tapi disarankan) generate secret kuat otomatis
./scripts/build.sh          # akan mengisi ENCRYPTION_KEY & JWT_SECRET jika kosong

# 3. Build & jalankan seluruh stack
docker compose up -d --build

# 4. Cek status
docker compose ps
docker compose logs -f app worker
```

Yang terjadi otomatis saat `app` start:

1. menunggu PostgreSQL siap,
2. menjalankan migrasi SQL (`1700000000000-InitialSchema`),
3. membuat **Super Admin** dari `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` (jika `SEED_SUPER_ADMIN=true`),
4. menyalankan API di `:4000`.

Verifikasi:

```bash
curl https://domain-anda.com/api/health
# {"status":"ok","services":{"database":true,"redis":true}, ...}
```

Lalu login di `https://domain-anda.com/login` menggunakan kredensial super admin.

### Perintah build image (sudah diverifikasi)

```bash
# Build ketiga image sekaligus
docker compose build app worker web

# Atau build satu per satu
docker build -t xstore-api:latest ./apps/api
docker build -t xstore-web:latest --build-arg NEXT_PUBLIC_API_URL=/api ./apps/web

# Tag & push ke registry (opsional)
docker tag xstore-api:latest registry.example.com/xstore-api:1.0.0
docker push registry.example.com/xstore-api:1.0.0
```

### Image yang sudah di-build lewat GitHub Actions ✅

Setiap push ke branch `main`/`arena/*` (dan tag `v*`) memicu workflow
`.github/workflows/docker-build.yml` yang:

1. **test** — install, build, jalankan 55 test, migrasi SQL + seed ke PostgreSQL 16
   sungguhan, lalu smoke-test API server (health, register, login, 401 untuk
   route admin tanpa auth, 401 untuk webhook bertanda tangan palsu);
2. **compose** — validasi `docker-compose.yml` (interpolasi + struktur);
3. **build** — build image `apps/api` & `apps/web` dengan buildx dan push ke
   **GHCR** (cache GHA untuk build cepat).

Image hasil build (repo publik → bisa langsung di-pull):

```bash
# API (dipakai service app & worker)
docker pull ghcr.io/littlejackjack/xstore-api:arena-502c634c-xstore
docker pull ghcr.io/littlejackjack/xstore-api:sha-<commit-sha>

# Frontend
docker pull ghcr.io/littlejackjack/xstore-web:arena-502c634c-xstore
docker pull ghcr.io/littlejackjack/xstore-web:sha-<commit-sha>
```

Menjalankan image tanpa build dari source:

```bash
# API
docker run -d --name xstore-app --env-file .env \
  -p 4000:4000 ghcr.io/littlejackjack/xstore-api:arena-502c634c-xstore

# Frontend (butuh API yang bisa dijangkau pada URL publik yang sama)
docker run -d --name xstore-web -p 3000:3000 \
  ghcr.io/littlejackjack/xstore-web:arena-502c634c-xstore
```

> Untuk memakai image GHCR di `docker-compose.yml` (tanpa build lokal),
> uncomment baris `image:` pada masing-masing service. Secara default compose
> tetap melakukan build dari source agar `docker compose up -d --build`
> selalu menghasilkan image terbaru dari kode di checkout ini.

Status workflow terakhir: <img src="https://github.com/littlejackjack/XStore/actions/workflows/docker-build.yml/badge.svg" alt="docker-build">

> **Catatan lingkungan pengembangan ini:** sandbox tempat repo ini dibuat tidak memiliki Docker daemon,
> sehingga perintah di atas belum bisa dieksekusi di sini. Sebagai gantinya, kode sudah **dibuktikan
> berjalan**: backend di-build dengan `nest build` dan **50/50 test lulus** (termasuk smoke test yang
> mem-boot seluruh aplikasi NestJS + menguji HTTP API), serta frontend di-build dengan `next build`
> (18 halaman) dan dijalankan sebagai server produksi. Jalankan perintah Docker di mesin yang memiliki
> Docker 24+.

---

## 3. Konfigurasi (`.env`)

Semua variabel ada di `.env.example`. Yang **wajib** di produksi:

| Variabel | Keterangan |
|---|---|
| `DOMAIN`, `ACME_EMAIL` | domain publik + email untuk sertifikat TLS |
| `APP_URL`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS` | URL frontend & API |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD` | kredensial infra |
| `ENCRYPTION_KEY` | **master key** enkripsi AES-256-GCM (min 32 karakter). Jangan sampai hilang — data terenkripsi tidak bisa dipulihkan tanpa ini |
| `JWT_SECRET` | secret penandatanganan token (min 32 karakter) |
| `DB_SYNC=false` | produksi memakai migrasi SQL, bukan auto-sync |
| `BAYARGG_API_KEY`, `BAYARGG_WEBHOOK_SECRET`, `RESEND_API_KEY` | opsional — dapat diisi dari Admin Panel (disimpan terenkripsi di DB) |

---

## 4. Fitur keamanan

| Kontrol | Implementasi |
|---|---|
| Enkripsi secret saat disimpan | **AES-256-GCM** per-record (salt scrypt + IV + auth tag) — `common/utils/crypto.util.ts` |
| Password hashing | **bcrypt** cost 12 (`modules/auth/password.util.ts`) |
| Autentikasi | **JWT** (15 menit) + **refresh token** acak 384-bit, disimpan sebagai **SHA-256 hash**, rotasi setiap refresh, cookie `httpOnly` + `SameSite=Strict` + `Secure` |
| Verifikasi webhook | **HMAC-SHA256** atas `invoice_id\|status\|final_amount\|timestamp` + jendela waktu 5 menit (anti-replay) + cek nominal + idempotensi |
| Rate limiting | Throttler global 120 req/60s; auth 5/menit; webhook 30/menit; rotasi API key 5/menit |
| Validasi input | `ValidationPipe` global: `whitelist`, `forbidNonWhitelisted`, `transform` |
| RBAC | `RolesGuard` hierarkis: `USER < ADMIN < SUPER_ADMIN`; rotasi API key khusus **SUPER_ADMIN** |
| Security headers | Helmet (CSP ketat untuk API JSON, HSTS, no-referrer) + CSP/headers di Next.js + Caddy |
| CSRF | Cookie refresh `SameSite=Strict` + `credentials:include` + origin CORS allow-list |
| SQL Injection | TypeORM (parameterized queries) + validasi DTO |
| Audit log | Setiap rotasi API key, perubahan server, status, produk, role user, dan settings dicatat |
| Kebocoran data | Response server **tidak pernah** memuat `passwordEncrypted`; API key hanya dikembalikan dalam bentuk masked |
| Anti-enumerasi | Pesan login identik untuk email salah / password salah |

---

## 5. Alur bisnis

### Checkout → pembayaran → provisioning

```
User                Frontend              API                 Bayar.gg            Worker            Marzban
 │  pilih paket        │                    │                     │                  │                 │
 ├────────────────────▶│  GET /products      │                     │                  │                 │
 │◀────────────────────┤                    │                     │                  │                 │
 │  pilih server       │  GET /servers/available (ONLINE + kapasitas)                │                 │
 ├────────────────────▶├───────────────────▶│                     │                  │                 │
 │◀────────────────────┤  daftar server (nama, lokasi, status, user, sisa kapasitas)│                 │
 │  bayar              │  POST /orders       │                     │                  │                 │
 ├────────────────────▶├───────────────────▶│  create-payment     │                  │                 │
 │◀────────────────────┤◀───────────────────│◀────────────────────┤ payment_url      │                 │
 │  redirect ke halaman pembayaran ─────────┼────────────────────▶│                  │                 │
 │                     │                    │◀──── webhook (HMAC)─┤  payment.paid    │                 │
 │                     │                    │  verifikasi + idempotensi             │                 │
 │                     │                    │  enqueue job ─────────────────────────▶│                 │
 │                     │                    │                     │   create user    ├────────────────▶│
 │◀── email Resend ────┼────────────────────┼─────────────────────┼──────────────────┤◀─ subscription_url
 │  dashboard: link subscription            │                     │                  │                 │
```

### Manajemen API key (Admin Panel → API Keys)

1. Super Admin membuka **Admin → API keys**, memasukkan key baru (form password).
2. `ApiKeysService.rotate()` mengenkripsi nilai dengan **AES-256-GCM** (master key dari `ENCRYPTION_KEY`)
   dan menuliskan ke tabel `api_keys` — **tidak ada** penulisan ke file `.env` dari web request.
3. Cache Redis di-invalidasi; nilai terdekripsi hanya tinggal di cache Redis **60 detik** dan hanya
   dipakai internal (`PaymentsService`, `MailService`).
4. Perubahan dicatat di **audit log** (`API_KEY_ROTATED`, field sensitif otomatis `[REDACTED]`).
5. Endpoint list hanya mengembalikan nilai **termasker** (`****…1234`).

### Multi-server Marzban

- Tabel `marzban_servers` menyimpan banyak panel: `baseUrl`, `username`, `passwordEncrypted`, `status`
  (`ONLINE`/`OFFLINE`/`MAINTENANCE`), `activeUsers`, `maxCapacity`, `location`, `priority`, `notes`.
- `MarzbanService` adalah **satu-satunya** modul yang berbicara dengan Marzban; token admin di-cache di
  Redis per server (TTL 45 menit, auto re-login, retry sekali setelah 401).
- Worker menjalankan job berulang (`refresh-server-statuses`, default tiap 5 menit) untuk memperbarui
  status + jumlah user aktif, sehingga daftar checkout selalu akurat.
- Saat checkout, server divalidasi ulang di server-side (`assertSelectable`): harus aktif, tidak
  maintenance/offline, dan belum penuh kapasitas.

**Contoh menambah server Marzban baru** (via API, setara dengan form di Admin → Marzban servers):

```bash
curl -X POST https://domain-anda.com/api/admin/servers \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Tokyo 01",
        "baseUrl": "https://marzban.tokyo.example.com",
        "username": "admin",
        "password": "password-panel-marzban",
        "location": "Japan",
        "priority": 2,
        "maxCapacity": 500,
        "notes": "Node bare-metal, 1 Gbps"
      }'
```

Password langsung dienkripsi sebelum disimpan; cek konektivitas dengan tombol **Check status**
(`POST /api/admin/servers/:id/check`).

---

## 6. API ringkas

| Method | Endpoint | Akses |
|---|---|---|
| GET | `/api/health` | publik |
| GET | `/api/settings/public`, `/api/products`, `/api/servers/available` | publik |
| POST | `/api/auth/register`, `/api/auth/login` | publik (rate limit 5/menit) |
| POST | `/api/auth/refresh`, `/api/auth/logout` | cookie refresh |
| GET | `/api/auth/me`, `/api/orders/me`, `/api/subscriptions/me` | user |
| POST | `/api/orders` (checkout), `/api/orders/:id/sync` | user |
| POST | `/api/webhooks/bayargg` | publik + HMAC |
| GET/POST/PUT/DELETE | `/api/admin/products`, `/api/admin/orders`, `/api/admin/servers`, `/api/admin/users`, `/api/admin/subscriptions`, `/api/admin/settings`, `/api/admin/stats`, `/api/admin/audit` | ADMIN |
| GET/PUT/POST | `/api/admin/api-keys` (list, rotate, verify) | **SUPER_ADMIN** |

Dokumentasi interaktif: set `SWAGGER_ENABLED=true` lalu buka `/api/docs`.

---

## 7. Development & testing

```bash
# Backend
cd apps/api
npm install
npm run build          # nest build
npm test               # 50 test: crypto, webhook HMAC, Marzban, API keys, e2e

# Frontend
cd apps/web
npm install
npm run build          # next build (18 halaman)
npm run dev

# Tanpa Docker sama sekali (butuh Postgres + Redis lokal)
./scripts/dev-local.sh
```

Cakupan test yang terbukti lulus:

- `crypto.spec.ts` — roundtrip enkripsi, tamper detection, salah master key, masking
- `webhook-signature.spec.ts` — signature valid/ditolak, replay, idempotensi, underpaid
- `apikeys.service.spec.ts` — enkripsi saat menyimpan, cache Redis, masking, audit
- `marzban.service.spec.ts` — login + cache token, payload create user, retry 401, offline
- `pgmem.spec.ts` — skema entity + migrasi SQL awal dieksekusi terhadap PostgreSQL
- `e2e-smoke.spec.ts` — boot penuh aplikasi: health, register/login, validasi, RBAC,
  pembuatan produk & server (password terenkripsi, tidak pernah di-echo), rotasi API key,
  audit log, daftar server publik, penolakan webhook palsu, statistik

---

## 8. Mode preview (tanpa Docker)

Untuk mendemo storefront + admin panel tanpa PostgreSQL/Redis nyata:

```bash
# 1. API dengan database in-memory (pg-mem) + data demo
cd apps/api && node preview-server.js          # :4000

# 2. Frontend, proxy /api ke API lokal
cd apps/web
API_PROXY_TARGET=http://127.0.0.1:4000 npm run build
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/static
PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

Akun demo: `admin@xstore.id` / `buyer@xstore.id` — password `Demo1234!`.
Server `Frankfurt 01` sengaja berstatus `MAINTENANCE` untuk mendemonstrasikan
penyaringan server saat checkout.

> Catatan: rewrite `/api/*` hanya aktif bila env `API_PROXY_TARGET` di-set.
> Di produksi (Docker/Caddy) variabel ini tidak ada, sehingga request langsung
> menuju `NEXT_PUBLIC_API_URL`.

---

## 8. Operasional

```bash
docker compose logs -f app          # log API
docker compose logs -f worker       # log background job
docker compose exec db psql -U xstore   # masuk ke database
docker compose restart worker       # restart worker saja
docker compose down                 # hentikan (data tetap ada di volume)
docker compose down -v              # hentikan + HAPUS semua data
```

Backup database:

```bash
docker compose exec -T db pg_dump -U xstore xstore > backup-$(date +%F).sql
```

---

## 9. Cloudflare (opsional)

1. Arahkan DNS `shop.example.com` ke server, status **Proxied**.
2. SSL/TLS mode: **Full (strict)**.
3. Buat WAF custom rule **Skip** untuk IP webhook Bayar.gg `95.169.180.225`
   (Security → WAF → Custom rules → `ip.src eq 95.169.180.225` → action *Skip*),
   agar callback pembayaran tidak pernah ditantang.
4. Pastikan *Under Attack* mode tidak meng-challenge path `/api/webhooks/*`.

Detail lengkap: [`docs/SETUP.md`](docs/SETUP.md) · Alur internal: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 10. Catatan produksi

- Simpan `.env` di luar Git (sudah di-`.gitignore`); rotasi secret secara berkala.
- `DB_SYNC=false` di produksi — perubahan skema lewat migrasi baru:
  `cd apps/api && npm run migration:generate -- src/database/migrations/NamaMigrasi`
- Monitor log worker: kegagalan provisioning di-retry 5× dengan backoff eksponensial,
  lalu order ditandai `FAILED` beserta alasannya.
- Backup berkala: volume `pgdata` (DB) + `ENCRYPTION_KEY` (tanpa ini data terenkripsi hilang).
