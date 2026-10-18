# HG Chat Center

Antarmuka web untuk tim internal HG agar bisa chat dengan AI agent OpenClaw
(Dave, Jaden, Joel, Dylan, Nana). Production: **agents.herrygunawan.com**.

> ⚠️ **Folder ini adalah production.** `chat-center.service` menjalankan
> `server.js` langsung dari sini. Perubahan di `public/` langsung terlihat pada
> page load berikutnya; perubahan `server.js` aktif setelah service di-restart.
> Kembangkan di instance dev (di bawah), bukan di port 8643.

## Arsitektur singkat

```
browser ──▶ Cloudflare Tunnel ──▶ server.js (127.0.0.1:8643) ──▶ OpenClaw gateway (127.0.0.1:18789)
                                     │  login + cookie sesi            /v1/chat/completions
                                     │  menyajikan public/ saja        model = openclaw/<agentId>
                                     └─ /upload → ~/.openclaw/media/inbound
```

| Path | Isi |
| --- | --- |
| `server.js` | HTTP server: login, static `public/`, upload, proxy ke gateway |
| `lib/` | `db.js` (SQLite + migrasi), `auth.js` (akun, scrypt, sesi, rate limit) |
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
npm run dev -- --gateway                # sama, tapi tersambung ke agent OpenClaw sungguhan
```

Dev memakai port, folder upload, dan database sendiri di `data/dev/`
(gitignored). `CHAT_PORT=8643` ditolak supaya tidak bentrok dengan production.
Catatan: dengan `--gateway`, chat dev membuat sesi OpenClaw sungguhan.

## Konfigurasi

Semua variabel didokumentasikan di [`.env.example`](.env.example). Nilai
production ada di `~/.config/chat-center.env` (dibaca systemd, tidak di git).
`server.js` **menolak start** bila `GATEWAY_TOKEN` kosong, angka tidak valid,
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

## Cek kualitas

```bash
npm run gates     # qa + test (unit + boot smoke) + security
```

Gate juga dijalankan oleh workflow agentic (lihat `CLAUDE.md`, `.agentic/config.yml`).

## Rilis ke production

1. Pastikan `npm run gates` PASS dan perubahan sudah di-commit.
2. Restart service (manusia, bukan agent):
   ```bash
   sudo systemctl restart chat-center
   ```
3. Cek: `systemctl status chat-center` dan buka agents.herrygunawan.com.
4. Gagal start? `journalctl -u chat-center -n 30` — pesan `config error` menyebut variabel yang salah.

Rilis pertama dengan akun per orang (EPIC-001): buat akun **sebelum** restart,
karena server menolak start tanpa user aktif. Setelah restart semua orang login
ulang dengan akunnya sendiri; `CHAT_USER`, `CHAT_PASS`, `CHAT_SECRET` di
`~/.config/chat-center.env` tidak dipakai lagi dan boleh dihapus.

Rollback: `git checkout <commit-sebelumnya> -- server.js public/` lalu restart.
