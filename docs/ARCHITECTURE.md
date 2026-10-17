# Arsitektur Internal — Multi-Server Marzban & Penyimpanan API Key Terenkripsi

## 1. Peta modul backend

```
AppModule
├── ConfigModule (validated, fail-fast)
├── ThrottlerModule (rate limiting global)
├── BullModule (antrian Redis)
├── DatabaseModule (TypeORM/PostgreSQL, global)
├── RedisModule (ioredis + cache helper, global)
├── AuditModule (global, append-only)
├── AuthModule       JWT + refresh token (rotasi), bcrypt
├── UsersModule      profil & manajemen user (admin)
├── ProductsModule   katalog
├── ServersModule    CRUD server Marzban, status, kapasitas
├── MarzbanModule    (global) SATU-SATUNYA integrasi Marzban
├── OrdersModule     checkout, order, statistik
├── PaymentsModule   integrasi Bayar.gg (create/check payment)
├── WebhooksModule   callback Bayar.gg + verifikasi HMAC
├── ApiKeysModule    kredensial terenkripsi (SUPER_ADMIN only)
├── SettingsModule   pengaturan situs (cache Redis)
├── MailModule       email Resend
├── ProvisioningModule  worker: provisioning + monitoring server
└── HealthModule     health probe
```

Aturan dependensi: modul fitur **tidak pernah** memanggil HTTP Marzban/Bayar.gg/Resend secara langsung —
selalu melalui `MarzbanService`, `PaymentsService`, atau `MailService`, yang semuanya mengambil
kredensial dari `ApiKeysService`.

## 2. Penyimpanan API key & password Marzban yang aman

### Format penyimpanan

Setiap secret disimpan sebagai **envelope JSON AES-256-GCM** di kolom `TEXT`:

```json
{
  "v": 1,
  "alg": "aes-256-gcm",
  "salt": "<base64, 16 byte, unik per record>",
  "iv":   "<base64, 12 byte nonce>",
  "tag":  "<base64, 16 byte GCM auth tag>",
  "ct":   "<base64 ciphertext>"
}
```

- **Kunci turunan**: `scryptSync(masterKey, salt, 32, {N:16384,r:8,p:1})` — salt unik per record,
  sehingga dua secret yang sama pun menghasilkan ciphertext berbeda.
- **Master key** berasal dari env `ENCRYPTION_KEY` (minimal 32 karakter, divalidasi saat boot di produksi).
- **Integritas**: GCM auth tag membuat perubahan sekecil apa pun pada ciphertext menyebabkan
  kegagalan dekripsi (teruji di `crypto.spec.ts`).
- **Tidak ada plaintext**: nilai asli tidak pernah ditulis ke `.env`, log, atau response HTTP.

### Siklus hidup sebuah kredensial

```
Admin Panel (SUPER_ADMIN)
   │  PUT /api/admin/api-keys/BAYARGG { apiKey, webhookSecret }
   ▼
ApiKeysService.rotate()
   ├─ validasi panjang & provider
   ├─ encryptSecret()  ──► kolom api_keys.key_encrypted / webhook_secret_encrypted
   ├─ invalidate cache Redis (apikeys:resolved:<PROVIDER>)
   └─ AuditService.record('API_KEY_ROTATED', metadata sensitif = [REDACTED])
   ▼
ApiKeysService.resolve(provider)          ← dipakai PaymentsService / MailService / WebhooksService
   ├─ Redis cache (TTL 60s)  ── hit ──► kembalikan
   └─ miss ──► baca DB ──► decryptSecret() ──► simpan ke Redis 60s ──► kembalikan
                                  (fallback: nilai dari .env untuk first boot)
```

**Caching yang aman**: nilai terdekripsi hanya berada di Redis (internal network) selama 60 detik,
tidak pernah dikirim ke browser. Endpoint `GET /api/admin/api-keys` mengembalikan hanya
`maskedKey` (mis. `************t123`) + metadata (siapa terakhir mengubah, kapan).

### Endpoint terkait

| Endpoint | Peran |
|---|---|
| `GET /api/admin/api-keys` | daftar provider + nilai termasker (SUPER_ADMIN) |
| `PUT /api/admin/api-keys/:provider` | rotasi key/webhook secret (SUPER_ADMIN, rate limit 5/menit, audit) |
| `POST /api/admin/api-keys/:provider/verify` | uji key ke provider (Bayar.gg/Resend) |
| `GET /api/admin/audit` | jejak audit semua perubahan |

## 3. Alur multi-server Marzban

### Data model (`marzban_servers`)

| Kolom | Isi |
|---|---|
| `name`, `location`, `notes` | identitas & informasi internal |
| `baseUrl`, `username` | endpoint panel + akun admin |
| `passwordEncrypted` | envelope AES-256-GCM (password panel) |
| `status` | `ONLINE` / `OFFLINE` / `MAINTENANCE` |
| `activeUsers`, `maxCapacity` | beban saat ini & batas (null = tak terbatas) |
| `priority`, `isActive` | urutan tampil & saklar aktif/nonaktif |
| `lastCheckedAt`, `lastError` | hasil monitoring terakhir |

### Monitoring (worker, repeatable job)

```
BullMQ queue "server-status"  ── every MARZBAN_STATUS_CHECK_INTERVAL (default 5 menit)
   └─ ServersService.refreshAllStatuses()
        ├─ untuk tiap server isActive:
        │    ├─ MarzbanService.getSystemStats()  → { total_user, users_active, version }
        │    ├─ sukses  → status=ONLINE, activeUsers=users_active, lastError=null
        │    └─ gagal   → status=OFFLINE,  lastError=<pesan singkat>
        └─ simpan lastCheckedAt
```

Token admin per server di-cache di Redis (`marzban:token:<id>`, TTL 45 menit); bila request
mengembalikan 401, token dibuang dan login diulang sekali secara otomatis.

### Tampilan checkout (pembeli)

`GET /api/servers/available` (publik) memfilter:

1. `isActive = true`
2. `status != MAINTENANCE`
3. `maxCapacity = null` **atau** `activeUsers < maxCapacity`

dan mengembalikan **hanya** field aman: `id, name, location, status, activeUsers, maxCapacity,
remainingCapacity` — tidak ada URL panel, username, atau password.

### Provisioning (worker, job per order)

```
Webhook Bayar.gg (HMAC valid, status=paid, nominal cocok)
   └─ order.status = PAID, enqueue "provision-subscription"
        └─ ProvisioningProcessor.process()
             ├─ muat order + product + server (relasi)
             ├─ order.status = PROVISIONING
             ├─ MarzbanService.createUser(server, {
             │     username: xstore_<orderNumber>,
             │     data_limit: GB → bytes (0 = unlimited),
             │     expire: now + durationDays,
             │     note: "XStore order ..."
             │  })  → { subscription_url, ... }
             ├─ simpan Subscription (ACTIVE, link config, kuota, expiry)
             ├─ order.status = COMPLETED, server.activeUsers += 1
             ├─ audit: SUBSCRIPTION_PROVISIONED
             └─ MailService.sendSubscriptionReady() (Resend)
```

**Ketahanan**: job di-retry 5× dengan backoff eksponensial; pada kegagalan akhir order menjadi
`FAILED` dengan `failureReason` agar bisa ditindaklanjuti (refund/provisioning manual).
Proses bersifat **idempoten**: order yang sudah `COMPLETED` tidak diproses ulang.

## 4. Keamanan webhook Bayar.gg (urutan pemeriksaan)

1. Field wajib: `invoice_id`, `status`, timestamp header.
2. **Freshness**: `|now - timestamp| <= 300 detik` (tolak replay).
3. **Kredensial**: webhook secret didekripsi dari `ApiKeysService` (bukan dari `.env`).
4. **HMAC-SHA256** atas `invoice_id|status|final_amount|timestamp`, dibandingkan
   dengan `safeEqual` (constant-time).
5. Order dicari berdasarkan `bayarInvoiceId`; invoice tak dikenal → di-acknowledge tanpa diproses.
6. **Cek nominal**: `paid_amount < amountIdr` → order `FAILED` (underpaid).
7. **Idempotensi**: order yang sudah `PAID/PROVISIONING/COMPLETED` → acknowledge, tidak diproses ulang.
8. Event payment selalu disimpan ke tabel `payments` (payload mentah) untuk audit/penyelesaian sengketa.

## 5. Model data (ringkas)

```
users ──┬── refresh_tokens (hash SHA-256, rotasi)
        ├── orders ──┬── payments (log event Bayar.gg)
        │            └── subscriptions ── marzban_servers
        └── (role: USER | ADMIN | SUPER_ADMIN)
products, marzban_servers, api_keys, settings, audit_logs
```

Uang disimpan sebagai **integer rupiah** (`bigint`) — tidak ada floating point untuk nominal.

## 6. Keputusan desain & alasannya

| Keputusan | Alasan |
|---|---|
| UUID dibuat di aplikasi (`UuidEntity` + `@BeforeInsert`) | insert eksplisit, portabel antar versi PostgreSQL |
| Migrasi SQL, bukan `synchronize` di produksi | perubahan skema terkendali & bisa di-review |
| Modul Marzban terpisah & global | satu titik integrasi; mudah di-mock saat testing |
| Secret hanya lewat `ApiKeysService` | tidak ada jalur lain untuk membaca/menulis kredensial |
| Cache Redis TTL 60 detik untuk secret | rotasi berlaku cepat, sementara beban DB tetap rendah |
| Webhook + polling `/sync` | resilien bila callback terlambat/diblokir firewall |
| Validasi ulang server saat checkout | klien usang tidak bisa order ke server penuh/offline |
| Global guard + `@Public()` opt-out | aman secara default; route baru otomatis terlindungi |
