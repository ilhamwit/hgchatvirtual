# EPIC-016: Voice Mode — Ngobrol Suara dengan Agent

status: on-progress
environment: dev
phase: 3
priority: P1
area: Fullstack + Infra
retries: 0
prd: ../product/PRD.md
stories: US-VOI-1 … US-VOI-4
tasks: T-094 … T-101

## Goal

Tombol **suara** di chat setiap agent: tampilan berubah menjadi mode bicara
(seperti voice ChatGPT) — user tinggal ngobrol, agent menjawab dengan suara,
dan di belakangnya terbuka **sesi chat baru** yang berisi transkripnya, jadi
setelah panggilan percakapan bisa dilanjutkan lewat teks.

Mesin suaranya **sama dengan aurix.herrygunawan.com** (`~/aurix-kit`): LiveKit
(WebRTC) + Silero VAD + Whisper GPU (Bahasa Indonesia) + OmniVoice (suara per
agent). Yang berbeda: **otaknya Hermes** — profil agent yang sama dengan chat
teks (`/p/<agent>/v1/chat/completions`, streaming), bukan OpenClaw/DeepSeek
langsung. Sesi Hermes-nya = sesi chat Chat Center (`hgchat-<id>`), sehingga
agent ingat obrolan suara saat dilanjutkan lewat teks.

Keputusan pemilik (2026-10-19): **opsi A** — LiveKit terpisah untuk Chat
Center (worker Reddie di aurix-kit otomatis bergabung ke semua room di
LiveKit-nya, jadi tidak bisa berbagi). Pemilik menambahkan hostname
`voice.herrygunawan.com` di Cloudflare dan port forward di router.

Temuan riset:
- Hermes API server mendukung `stream: true` (SSE OpenAI); chunk pertama ±1,2 s.
  Chunk `reasoning_content` harus diabaikan (jangan diucapkan).
- GPU RTX 5080 16 GB: backend Reddie memakai ±8,6 GB (2 proses idle). Worker
  kita memakai 0 proses idle → model dimuat saat panggilan pertama.
- Server di belakang NAT dengan IP publik dinamis; LiveKit membaca IP eksternal
  saat start (`use_external_ip`). Risiko yang sudah ada juga di aurix-kit.

## User Stories

- **US-VOI-1** — Sebagai anggota tim, saya ingin menekan tombol suara lalu langsung ngobrol dengan agent.
- **US-VOI-2** — Sebagai anggota tim, saya ingin melihat teks percakapan (caption) saat bicara, dan transkripnya tersimpan sebagai sesi chat.
- **US-VOI-3** — Sebagai anggota tim, saya ingin tiap agent punya suaranya sendiri.
- **US-VOI-4** — Sebagai admin, saya ingin tahu status mesin suara (LiveKit, worker) di Settings → Sistem.

## Tasks

### Infra
- [x] **T-094** `deploy/voice/`: LiveKit #2 (port 7890 ws, 7891 tcp, 7892 udp, ICE 62000–62300), worker suara (image Reddie + `app.py` kita, GPU), `scripts/install-voice.sh` (buat key, tulis `.env`, `docker compose up`, cetak langkah Cloudflare & router).
- [x] **T-095** Worker: VAD + Whisper + OmniVoice seperti Reddie; LLM = Hermes profil dari metadata peserta, header `X-Hermes-Session-Id`; `agent_name="hg-voice"` (dispatch eksplisit); suara per agent dari metadata; transkrip dikirim ke Chat Center; pengisi jeda bila Hermes lambat (>2,5 s).

### Chat Center
- [x] **T-096** `lib/voice.js`: token LiveKit (JWT HS256 tanpa dependensi) dengan grant room + `roomConfig.agents` + metadata; `POST /api/voice/session` membuat sesi chat (judul "Panggilan suara…") dan token; `POST /api/v1/voice/turns` (key worker) menulis transkrip ke sesi.
- [x] **T-097** UI mode suara: tombol 🎙️ di kepala chat → layar penuh (avatar agent berdenyut, status Mendengarkan/Berpikir/Berbicara, caption dua arah, bisukan, akhiri); `livekit-client` di `public/vendor/`; setelah selesai, sesi chat menampilkan transkrip.
- [x] **T-098** Suara per agent (Dave male_young, Jaden female_assistant, Joel male_news, Dylan male_teen, Nana female_cs) — dapat diubah lewat env `CHAT_VOICE_PROFILES`.
- [x] **T-099** Settings → Sistem: status LiveKit suara & worker.

### Uji
- [ ] **T-100** Uji nyata lewat voice.herrygunawan.com dari browser (pemilik), termasuk HP.
- [ ] **T-101** Penyempurnaan: interupsi, latensi, mobile.

## Acceptance Criteria

- Token LiveKit hanya untuk user login, hanya room miliknya, kedaluwarsa ≤ 1 jam; worker Reddie tidak pernah masuk ke room Chat Center.
- Transkrip (user + agent) tersimpan di sesi chat agent itu; melanjutkan lewat teks memakai sesi Hermes yang sama.
- Teks `reasoning_content` tidak pernah diucapkan.
- Tanpa LiveKit/worker, tombol suara menjelaskan "mesin suara belum aktif" — chat teks tetap berjalan.

## Automation Log

- 2026-10-19 Epic dibuat; riset aurix-kit (compose, app.py Reddie, livekit-agents 1.6.6, plugin OmniVoice/FasterWhisper, token API), Hermes streaming OK, NAT + IP dinamis ditemukan — on-progress
- 2026-10-19 T-094…T-099 dibangun. `deploy/voice/`: compose (LiveKit #2 + worker image Reddie dengan `app.py` kita, GPU, `host.docker.internal` ke Hermes & Chat Center), `livekit.yaml.example`, `.env.example`, `scripts/install-voice.sh` (buat key, tulis `.env`/`livekit.yaml` 600, tulis `CHAT_VOICE_*` ke env Chat Center, compose up, cetak langkah Cloudflare/router). Worker: `@server.rtc_session(agent_name="hg-voice")` (AgentServer 1.6.6 tidak menerima agent_name di konstruktor), `HermesAgent.llm_node` hanya mengirim pesan terbaru ke `/p/<agent>/v1` dengan `X-Hermes-Session-Id`, aturan mode suara di giliran pertama + pengingat singkat tiap giliran, `reasoning_content` diabaikan, transkrip user/assistant → `POST /api/v1/voice/turns`. Chat Center: `lib/voice.js` (JWT HS256 tanpa dependensi: grant room + `roomConfig.agents` + metadata agent/conversationId/hermesSession/user/voiceProfile; sesi = percakapan baru "🎙️ Panggilan suara · <waktu>"; turns dengan kunci worker, timingSafeEqual), `GET /api/voice/status`, `POST /api/voice/session`, `POST /api/v1/voice/turns`. UI: tombol Suara di kepala chat, layar penuh (orb avatar berdenyut per state `lk.agent.state`, caption dua arah dari stream `lk.transcription`, bisukan, akhiri, Esc), setelah selesai membuka sesi transkrip; Settings → Sistem baris Mode suara. Tes 142/142 (3 baru), gates PASS. Belum: `public/vendor/livekit-client.umd.min.js` (perlu unduhan, izin pemilik), hostname Cloudflare & port forward (pemilik), uji nyata (T-100).
- 2026-10-19 `install-voice.sh` dijalankan: key dibuat, `CHAT_VOICE_*` ditulis, **LiveKit #2 berjalan** (HTTP 200 di 127.0.0.1:7890, nodeIP 118.99.70.166). Rentang ICE dipindah ke UDP 62000–62300 karena 60425/udp sudah dipakai proses lain. **Worker gagal start**: `/run/nvidia-persistenced/socket` tidak ada — driver NVIDIA di-upgrade otomatis (unattended-upgrades 14 Okt: 595.84 → 595.99.02) sementara modul kernel masih 595.84 (`nvidia-smi`: Driver/library version mismatch); container GPU baru tidak bisa dibuat sampai server **reboot** (container Reddie masih hidup karena dibuat sebelum upgrade). Perbaikan skrip: `getv` dan pembuatan key tidak lagi gagal karena `pipefail`.
- 2026-10-19 `livekit.yaml` hasil generate sempat ikut ter-commit (repo lokal, tanpa remote) → dihapus dari riwayat (amend), key LiveKit dirotasi, `.gitignore` ditambah; gate keamanan tidak lagi menganggap nilai `*_URL/_HTTP/_PATH` sebagai rahasia. Restart chat-center PID 976240 → 1022069: **voice on** (token API aktif). Status: LiveKit #2 up; worker menunggu reboot server (driver NVIDIA); `public/vendor/livekit-client.umd.min.js` menunggu izin unduh; Cloudflare hostname + port forward menunggu pemilik.
- 2026-10-19 Server di-reboot pemilik (kernel 7.0.0-38, driver 595.99.02 aktif, `nvidia-smi` normal). Semua layanan naik sendiri: chat-center, hermes-gateway, aurix-kit, LiveKit #2. Worker `chat-center-voice` di-`compose up` manual (container yang belum pernah jalan tidak di-autostart) → **terdaftar di LiveKit sebagai `hg-voice`** (livekit-agents 1.6.6). GPU: 8,7 GB terpakai (Reddie); worker memuat model saat panggilan pertama. Sisa: Cloudflare hostname + port forward (pemilik), pustaka `livekit-client` (izin unduh), uji nyata.
- 2026-10-19 Uji nyata pertama oleh pemilik (setelah route `voice` di Cloudflare; DNS router sempat menyimpan NXDOMAIN ±30 menit): browser tersambung ke LiveKit, worker masuk ke room, OmniVoice `male_young` siap — lalu worker **crash** saat menyapa: `RuntimeError: trying to generate reply without an LLM model` (AgentSession 1.6.6 menolak `generate_reply` tanpa `llm=` walau `Agent.llm_node` di-override). Perbaikan: AgentSession diberi `lk_openai.LLM` yang menunjuk ke profil Hermes yang sama (tidak dipanggil langsung), sapaan pembuka dikirim lewat `llm_node` saat belum ada ucapan user. Container worker dibuat ulang (file app.py di-bind-mount, inode berubah saat merge).

## Dependencies

- EPIC-007 (Hermes), EPIC-002 (sesi chat), EPIC-013 (API key worker), aurix-kit (image & model GPU).
- 2026-10-19 Panggilan nyata kedua: audio dua arah jalan (STT menerima ucapan, TTS Dave terdengar), tetapi setiap jawaban "Maaf, saya sedang tidak bisa menjawab". Log: `hermes failed: Connection error` dan `transcript write failed … 172.17.0.1:8643`. Penyebab: Hermes (8642) dan Chat Center (8643) hanya mendengarkan di 127.0.0.1, sehingga tidak terjangkau dari container di jaringan bridge. Perbaikan: worker memakai `network_mode: host` (URL ke 127.0.0.1, LiveKit `ws://127.0.0.1:7890`), health server worker diikat ke 127.0.0.1:8093 (8081 dipakai Nextcloud). Bind address Hermes/Chat Center tidak diubah.
- 2026-10-19 Uji Hermes dari dalam worker (jaringan host) berhasil: "Koneksi aman, Dave standby. 🛠️". Karena model bisa tetap mengeluarkan emoji walau dilarang aturan suara, ditambah filter `speakable()` di `llm_node` yang membuang emoji, variation selector, ZWJ dan penanda markdown (`* # ` ~ |`) sebelum masuk TTS.
- 2026-10-19 T-101 tuning (permintaan pemilik: "lebih smooth respon dan kepintarannya"). Dari log panggilan nyata: ucapan terpecah jadi beberapa giliran dan hanya potongan terakhir dikirim ke Hermes (pertanyaan hilang); kunci `endpointing_delay`/`preemptive_tts` lama ternyata diabaikan livekit-agents 1.6.6 (opsi yang benar bersarang: `endpointing`, `preemptive_generation`); interupsi 0,12 dtk membuat bunyi kecil memotong Dave; hening 8–10 dtk saat Hermes memakai tool; proses suara baru dimuat saat diangkat. Perbaikan di `deploy/voice/app.py`: (1) `pending_user_text` menggabungkan semua ucapan sejak jawaban agent terakhir, dan bila jawaban sebelumnya dipotong, Hermes diberi tahu bagian yang sempat terdengar; (2) `TurnDetector(version="v1-mini")` lokal + endpointing min 0,6 / max 2,5 dtk; (3) interupsi VAD min 0,6 dtk dengan `resume_false_interruption`; preemptive generation dimatikan supaya tiap permintaan Hermes (yang bisa menjalankan tool) terkirim sekali; (4) kalimat pengisi ("Sebentar, saya cek dulu ya.") setelah 1,6 dtk tanpa jawaban dan sekali lagi di 12 dtk, diucapkan segera lewat penanda FLUSH di `tts_node` (flush tokenizer), dibuang dari caption/transkrip; (5) `NUM_IDLE_PROCESSES=1` (satu proses hangat). Aturan suara: boleh lebih panjang bila diminta detail, pakai tool bila perlu, ucapan pengguna hasil ASR bisa salah dengar. Semua bisa diatur lewat env `VOICE_*`. Logika diuji di dalam container (gabung ucapan, pengisi cepat/lambat, error). UI: tombol bergaya panggilan WhatsApp (bulat 64 px, ikon SVG mikrofon/mikrofon-mati putih saat dibisukan, tombol tutup merah #EA0038 dengan ikon gagang telepon), nama agent besar + jam panggilan mm:ss yang mulai saat agent hadir. Tes 143/143, gates PASS.
- 2026-10-19 Regresi dari tuning sebelumnya (pemilik: "kurang responsive, yang sebelum ini lebih lancar"). Log: GPU kehabisan memori. Proses panggilan pertama masih memegang ~4,7 GB saat panggilan berikutnya datang, ditambah proses hangat (~2,3 GB) dan beban GPU lain di server (Reddie dll. ~8,6 GB dari 16 GB). Panggilan kedua crash saat memuat OmniVoice, panggilan ketiga STT gagal ("CUDA failed with error out of memory"), sehingga ucapan tidak dikenali. Selain itu, kalimat pengisi ikut terucap sebelum sapaan, dan pengisi pada 1,6 dtk menunda jawaban normal (jawaban diantrekan setelah pengisi selesai diucapkan). Perbaikan: `NUM_IDLE_PROCESSES=0` lagi (compose, `.env.example`, `.env` lokal); tanpa pengisi pada sapaan; pengisi baru setelah 3 dtk (hanya jawaban lambat/tool); endpointing min 0,4 dtk; interupsi min 0,5 dtk. Uji logika di container: OK, termasuk sapaan tanpa pengisi.
