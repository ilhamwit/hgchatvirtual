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
| `public/` | Satu-satunya folder yang bisa diakses lewat HTTP (`index.html`, `login.html`, `app.js`, `style.css`, `assets/`) |
| `test/` | Unit test (`node:test`) |
| `scripts/` | Gate (`qa.sh`, `test.sh`, `security-check.sh`), `dev.sh`, helper loop |
| `docs/epics/` | Rencana kerja (EPIC + task). Status hidup ada di `docs/epics/README.md` |

## Menjalankan lokal (dev)

Butuh Node.js ≥ 22.5 (server memakai Node v26). Tanpa dependency npm.

```bash
npm run dev                # http://127.0.0.1:8650 — tanpa login, tanpa gateway (kerja UI)
npm run dev -- --gateway   # sama, tapi tersambung ke agent OpenClaw sungguhan
```

Dev memakai port, folder upload, dan database sendiri di `data/dev/`
(gitignored). `CHAT_PORT=8643` ditolak supaya tidak bentrok dengan production.
Catatan: dengan `--gateway`, chat dev membuat sesi OpenClaw sungguhan.

## Konfigurasi

Semua variabel didokumentasikan di [`.env.example`](.env.example). Nilai
production ada di `~/.config/chat-center.env` (dibaca systemd, tidak di git).
`server.js` **menolak start** bila `GATEWAY_TOKEN`, `CHAT_USER`, `CHAT_PASS`,
atau `CHAT_SECRET` kosong, atau bila angka tidak valid — kecuali `CHAT_DEV=1`.

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

Rollback: `git checkout <commit-sebelumnya> -- server.js public/` lalu restart.
