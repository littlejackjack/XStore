# Panduan Setup Lengkap — XStore

Panduan langkah demi langkah dari server kosong hingga toko berjalan.

## 0. Prasyarat

- VPS Linux (Ubuntu 22.04+ / Debian 12), minimal 2 vCPU / 2 GB RAM
- Docker 24+ dan plugin compose:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # logout/login kembali
  docker --version && docker compose version
  ```
- Domain (A record) sudah mengarah ke IP VPS
- Akun **Bayar.gg** (API Key + Webhook Secret) dan **Resend** (API Key)
- Satu atau beberapa panel **Marzban** yang sudah berjalan

## 1. Clone & konfigurasi

```bash
git clone <repo-url> xstore && cd xstore
cp .env.example .env
nano .env
```

Isi minimal:

```ini
DOMAIN=shop.example.com
ACME_EMAIL=admin@example.com
APP_URL=https://shop.example.com
NEXT_PUBLIC_API_URL=https://shop.example.com/api
CORS_ORIGINS=https://shop.example.com
POSTGRES_PASSWORD=<password-kuat>
REDIS_PASSWORD=<password-kuat>
ENCRYPTION_KEY=<openssl rand -base64 48>
JWT_SECRET=<openssl rand -base64 48>
DB_SYNC=false
SEED_SUPER_ADMIN=true
SUPER_ADMIN_EMAIL=admin@example.com
SUPER_ADMIN_PASSWORD=<password-admin-kuat>
```

> `scripts/build.sh` dapat mengisi `ENCRYPTION_KEY` dan `JWT_SECRET` secara otomatis bila masih kosong.

## 2. Build & jalankan

```bash
./scripts/build.sh          # build image (opsional, build ulang otomatis saat up)
docker compose up -d --build
docker compose ps           # pastukan semua service "healthy"/"Up"
docker compose logs -f app  #ikuti boot: migrasi -> seed -> "API listening"
```

Health check:

```bash
curl https://shop.example.com/api/health
```

## 3. Konfigurasi awal lewat Admin Panel

1. Buka `https://shop.example.com/login`, masuk sebagai Super Admin.
2. **Admin → API keys**
   - `BAYARGG`: tempel **API Key** dan **Webhook Secret** (`whsec_...` dari menu
     *Developer → Webhook & Callback* di dashboard Bayar.gg). Tekan **Save encrypted** lalu **Verify**.
   - `RESEND`: tempel API Key Resend. **Save encrypted**.
3. **Admin → Marzban servers** → tambahkan server (lihat contoh di README).
   Tekan **Check status** sampai berstatus `ONLINE`.
4. **Admin → Products** → sesuaikan paket/harga (sudah ada 3 contoh dari seed).
5. **Admin → Settings** → nama situs, tagline, kontak support, izin registrasi.

## 4. Konfigurasi Bayar.gg

Di dashboard Bayar.gg (*Developer → Webhook & Callback*):

- **Default Callback URL**: `https://shop.example.com/api/webhooks/bayargg`
- Gunakan **Checkout URL** yang sama dengan `BAYARGG_CHECKOUT_URL` di `.env`
  (default `https://www.bayar.gg/pay`).
- Signature webhook dihitung atas `invoice_id|status|final_amount|timestamp`
  menggunakan **Webhook Secret Key** — platform memverifikasinya dengan
  perbandingan *constant-time* dan menolak timestamp berumur > 5 menit.

Endpoint platform terkait:

| Endpoint | Fungsi |
|---|---|
| `POST /api/webhooks/bayargg` | menerima callback pembayaran (publik, rate-limited, HMAC) |
| `POST /api/orders/:id/sync` | fallback polling status pembayaran bila webhook terlambat |

## 5. Cloudflare (opsional)

1. DNS record `shop` → IP VPS, proxy status **Proxied**.
2. **SSL/TLS → Overview** → mode **Full (strict)**.
3. **Security → WAF → Custom rules** → rule baru:
   - Expression: `ip.src eq 95.169.180.225`
   - Action: **Skip** (semua fitur keamanan) — whitelist IP pengirim webhook Bayar.gg.
4. Jangan aktifkan *Under Attack* mode, atau pastikan path `/api/webhooks/*` di-skip.
5. **Network** → aktifkan HTTP/3 (opsional).

## 6. Marzban — persiapan panel

Setiap panel Marzban yang akan dijual perlu:

- URL publik HTTPS (mis. `https://marzban.sgp.example.com`)
- Akun **admin/sudo** (username + password) — platform memakainya untuk:
  - `POST /api/admin/token` (login, token di-cache 45 menit di Redis)
  - `POST /api/user` (membuat user saat pembayaran sukses)
  - `GET /api/users`, `GET /api/system` (monitoring status & jumlah user)
- Inbound yang sesuai (default `{"vless":["VLESS TCP REALITY"]}`, bisa diubah
  lewat env `MARZBAN_DEFAULT_INBOUNDS`).

Catatan: password panel **tidak pernah** disimpan plaintext — langsung dienkripsi
AES-256-GCM oleh `ServersService.create()`.

## 7. Alur uji coba (end-to-end)

1. Daftar akun pembeli di `/register`.
2. Buka `/catalog` → pilih paket → pilih server yang `ONLINE` → **Pay now**.
3. Selesaikan pembayaran di halaman Bayar.gg.
4. Webhook masuk → order `PAID` → worker membuat user di Marzban →
   order `COMPLETED` → email Resend terkirim berisi subscription URL.
5. Cek `/dashboard`: subscription muncul dengan link config, sisa traffic, dan masa aktif.
6. Cek `/admin/orders`, `/admin/subscriptions`, dan `/admin/audit` untuk melihat jejak audit.

## 8. Troubleshooting

| Gejala | Solusi |
|---|---|
| `Unable to connect to the database` | cek `DATABASE_URL`, pastikan container `db` healthy |
| Webhook selalu gagal (Callback Logs) | whitelist IP `95.169.180.225` di Cloudflare/Imunify360/ModSecurity |
| Order `PENDING` padahal sudah bayar | tekan tombol sinkronisasi / panggil `POST /api/orders/:id/sync` |
| Order `FAILED` | lihat `failureReason` di `/admin/orders` — biasanya panel Marzban offline atau kredensial salah |
| Server tampil `OFFLINE` | tombol **Check status**; periksa URL panel & kredensial admin |
| Email tidak terkirim | cek RESEND API key di Admin → API keys (Verify), dan alamat `RESEND_FROM_EMAIL` terverifikasi di Resend |
| Lupa password Super Admin | `docker compose exec app node dist/database/seed.js` tidak me-reset password; buat admin baru via psql atau reset manual |
| Ganti domain | ubah `DOMAIN`, `APP_URL`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL` di `.env` lalu `docker compose up -d --build` |

## 9. Backup & restore

```bash
# Backup
docker compose exec -T db pg_dump -U xstore xstore | gzip > xstore-$(date +%F).sql.gz

# Restore
gunzip -c xstore-2026-01-01.sql.gz | docker compose exec -T db psql -U xstore xstore
```

Simpan juga `ENCRYPTION_KEY` di tempat aman (password manager). Tanpa master key tersebut,
password Marzban dan API key yang tersimpan **tidak dapat didekripsi**.
