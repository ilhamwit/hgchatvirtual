# HG Chat Center

Antarmuka web untuk tim internal HG agar bisa chat dengan AI agent Hermes
(Dave, Jaden, Joel, Dylan, Nana). Production: **agents.herrygunawan.com**.

> ⚠️ **Folder ini adalah production.** `chat-center.service` menjalankan
> `server.js` langsung dari sini. Perubahan di `public/` langsung terlihat pada
> page load berikutnya; perubahan `server.js` aktif setelah service di-restart.
> Kembangkan di instance dev (di bawah), bukan di port 8643.

## Arsitektur singkat

```
browser ──▶ Cloudflare Tunnel ──▶ server.js (127.0.0.1:8643) ──▶ Hermes API server (127.0.0.1:8642)
                                     │  login + cookie sesi            /p/<agent>/v1/chat/completions
                                     │  /api/* (lib/api.js)            X-Hermes-Session-Id: hgchat-<conversationId>
                                     │  riwayat di SQLite              key = API_SERVER_KEY profil agent
                                     │  menyajikan public/ saja
                                     └─ /upload → ~/.openclaw/media/inbound
```

| Path | Isi |
| --- | --- |
| `server.js` | HTTP server: login, static `public/`, upload, proxy ke gateway |
| `lib/` | `db.js` (SQLite + migrasi), `auth.js` (akun, sesi, rate limit), `conversations.js` (riwayat), `api.js` (/api/*), `gateway.js` (satu-satunya pemanggil Hermes) |
| `data/` | Database `chat-center.db` (gitignored, mode 600) |
| `public/` | Satu-satunya folder yang bisa diakses lewat HTTP (`index.html`, `login.html`, `app.js`, `style.css`, `assets/`) |
| `test/` | Unit test (`node:test`) |
| `scripts/` | Gate (`qa.sh`, `test.sh`, `security-check.sh`), `dev.sh`, helper loop |
| `docs/epics/` | Rencana kerja (EPIC + task). Status hidup ada di `docs/epics/README.md` |

## Menjalankan lokal (dev)

Butuh Node.js ≥ 22.5 (server memakai Node v26). Tanpa dependency npm.

```bash
npm run dev:users -- add saya --admin   # sekali: buat akun di database dev
npm run dev                             # http://127.0.0.1:8650 — tanpa gateway (kerja UI)
npm run dev -- --gateway                # sama, tapi tersambung ke agent Hermes sungguhan
```

Dev memakai port, folder upload, dan database sendiri di `data/dev/`
(gitignored). `CHAT_PORT=8643` ditolak supaya tidak bentrok dengan production.
Catatan: dengan `--gateway`, chat dev membuat sesi Hermes sungguhan.

## Konfigurasi

Semua variabel didokumentasikan di [`.env.example`](.env.example). Nilai
production ada di `~/.config/chat-center.env` (dibaca systemd, tidak di git).
`server.js` **menolak start** bila `HERMES_API_KEY` kosong, angka tidak valid,
atau belum ada satu pun user aktif — kecuali `CHAT_DEV=1`.

## Akun tim

Setiap anggota tim punya akun sendiri (password di-hash scrypt, minimal 10
karakter). Kelola dari folder ini; perubahan langsung berlaku tanpa restart.
Password selalu diminta lewat prompt tersembunyi, tidak pernah sebagai argumen.

```bash
node scripts/users.js add irfan --name "Irfan"        # anggota
node scripts/users.js add ilham --name "Ilham" --admin
node scripts/users.js list
node scripts/users.js reset-password irfan            # juga mengakhiri sesinya
node scripts/users.js disable irfan                   # blokir + logout di semua perangkat
node scripts/users.js enable irfan
node scripts/users.js revoke-sessions irfan           # logout di semua perangkat
```

Login gagal 5× dalam 15 menit (per IP atau per username) → 429 sampai jendela
lewat. Sesi berlaku 30 hari; tombol nama di pojok kiri bawah = keluar.

## API (untuk halaman chat)

Semua butuh login; percakapan milik user lain = 404.

| Method & path | Fungsi |
| --- | --- |
| `GET /api/me`, `GET /api/agents` | User yang login; daftar agent |
| `GET /api/conversations[?agent=dave&archived=1]` | Daftar percakapan milik user |
| `POST /api/conversations` `{agentId}` | Percakapan baru (= sesi Hermes baru) |
| `GET/PATCH /api/conversations/:id` | Detail; ganti `title` / `archived` |
| `GET /api/conversations/:id/messages` | Riwayat + `pending` |
| `POST /api/conversations/:id/messages` `{text, attachments}` | Kirim; balasan disimpan walau browser terputus |
| `POST /api/conversations/:id/retry` · `/stop` | Ulang pertanyaan terakhir setelah error · hentikan |
| `POST /api/import` `{history}` | Impor sekali riwayat lama dari localStorage |

Tidak ada lagi proxy `/v1/*`: browser tidak pernah menyentuh Hermes.

## Hermes (backend agent)

Agent = profil Hermes (`hermes profile list`). API server Hermes hanya aktif di
profil `default` (127.0.0.1:8642); profil lain diakses lewat prefix
`/p/<profil>/` dan hanya menerima `API_SERVER_KEY` dari
`~/.hermes/profiles/<profil>/.env`. Kelima profil agent memakai satu kunci yang
sama dengan `HERMES_API_KEY` di `~/.config/chat-center.env`.

Menambah agent baru `budi`: buat profil Hermes-nya, set kuncinya, lalu
tambahkan ke `CHAT_AGENTS` dan restart chat-center:

```bash
hermes -p budi config set API_SERVER_KEY "$(grep -oP '^HERMES_API_KEY=\K.*' ~/.config/chat-center.env)"
```

Restart Hermes: `systemctl --user restart hermes-gateway` (tanpa sudo;
WhatsApp/Telegram terputus beberapa detik).

## Operasional

### Backup & restore

`scripts/backup.js` membuat snapshot konsisten (`VACUUM INTO` dari koneksi
read-only, aman saat server jalan), memeriksanya (`integrity_check` + jumlah
baris), lalu menghapus backup lebih tua dari 14 hari — hanya setelah backup baru
terbukti baik. File: `data/backups/chat-center-YYYYMMDD-HHMMSS.db` (mode 600).

```bash
node scripts/backup.js                                   # backup sekarang
node scripts/backup.js --verify data/backups/<file>.db   # cek satu backup
bash scripts/install-backup-timer.sh                     # pasang jadwal harian 03:15 (user unit, tanpa sudo)
systemctl --user list-timers chat-center-backup.timer    # kapan backup berikutnya
journalctl --user -u chat-center-backup -n 20            # hasil backup terakhir
```

Restore (manusia, butuh sudo untuk stop/start):

```bash
sudo systemctl stop chat-center
cd "/home/hg/Documents/Chat Center"
node scripts/backup.js --verify data/backups/<file>.db
mkdir -p data/before-restore && mv data/chat-center.db* data/before-restore/
cp data/backups/<file>.db data/chat-center.db && chmod 600 data/chat-center.db
sudo systemctl start chat-center
```

### Health, log, audit

- `GET /healthz` (tanpa login): `200 {"ok":true,"db":"ok","hermes":"ok"}`, atau
  `503` bila database/Hermes bermasalah. Pakai untuk uptime monitor.
- Log request: satu baris per request di journald, tanpa query string, cookie,
  atau isi pesan: `journalctl -u chat-center | grep ' req '`.
- Audit login & perubahan akun (disimpan 180 hari): `node scripts/users.js audit 50`.

## Cek kualitas

```bash
npm run gates     # qa + test (unit + boot smoke) + security
```

Gate juga dijalankan oleh workflow agentic (lihat `CLAUDE.md`, `.agentic/config.yml`).

## Rilis ke production

1. Pastikan perubahan sudah di-commit di `main`.
2. Restart (manusia, bukan agent) — skrip ini menjalankan gate dulu, restart,
   lalu membuktikan PID berganti dan `/healthz` sehat:
   ```bash
   bash "/home/hg/Documents/Chat Center/scripts/restart.sh"
   ```
3. Buka agents.herrygunawan.com dan coba login + chat.
4. Gagal start? `journalctl -u chat-center -n 30` — pesan `config error` menyebut variabel yang salah.

Rilis pertama dengan akun per orang (EPIC-001): buat akun **sebelum** restart,
karena server menolak start tanpa user aktif. Setelah restart semua orang login
ulang dengan akunnya sendiri; `CHAT_USER`, `CHAT_PASS`, `CHAT_SECRET` di
`~/.config/chat-center.env` tidak dipakai lagi dan boleh dihapus.

Rollback: `git checkout <commit-sebelumnya> -- server.js public/` lalu restart.
