# HG Chat AI Agent
**Single-File HTML · Agent Intelligence Platform**

---

## Overview

HG Chat AI Agent adalah platform berbasis web untuk mengelola percakapan dengan berbagai AI agent yang masing-masing memiliki peran dan persona berbeda. Dibangun sebagai single-file HTML mandiri — tidak membutuhkan server, framework, atau dependencies eksternal selain Google Fonts.

```
hg-chat-ai-agent.html   ← satu file, semua fitur
```

---

## Screen Flow

```
[ LOGIN SCREEN ]
      │
      ▼  PIN: 101010
[ RIPPLE TRANSITION ]
      │
      ▼
[ MAIN APP ]
   ├── Top Bar
   ├── Sidebar
   ├── Sockets Panel
   └── Chat Area
```

---

## 1. Login Screen

**Komponen visual:**

| Elemen | Keterangan |
|---|---|
| Background | Dark `#0A0A0E` + ambient gold orbs + grid lines |
| Logo | HG Logo PNG (embedded base64) dengan glow animation |
| Brand title | "HG CHAT AI AGENT" — Playfair Display serif, gradient gold |
| Tagline | "Agent Intelligence Platform" |
| PIN dots | 6 lingkaran kecil — kosong → gold (filled) → hijau (ok) / merah (error) |
| Numpad | Grid 3×4 (angka 1–9, 0, backspace) |
| Status text | Pesan dinamis di bawah numpad |
| Footer | Logo kecil + versi |

**PIN Logic:**

```
Input 6 digit
     │
     ├── === "101010" → dots hijau → ripple transition → buka app
     │
     └── !== "101010" → dots merah → shake animation → reset
```

**Keyboard support:** angka `0–9` dan `Backspace` bisa diketik langsung.

---

## 2. Transition

Setelah PIN benar, ripple circle gold melebar menutuhi seluruh layar (`scale: 300`), login screen fade-out, main app fade-in.

```css
/* Ripple expand */
.ripple-circle.expand {
  transform: scale(300);
  opacity: 1;
}
```

---

## 3. Main App — Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                         TOP BAR (50px)                          │
├──────────────┬──────────────────┬───────────────────────────────┤
│              │                  │                               │
│   SIDEBAR    │  SOCKETS PANEL   │        CHAT AREA              │
│   (220px)    │    (296px)       │        (flex: 1)              │
│              │                  │                               │
│              │                  │                               │
└──────────────┴──────────────────┴───────────────────────────────┘
```

---

## 4. Top Bar

```
[ HG Logo ] [ HG Chat AI Agent ] | [ Prompt ] [ Agent ] | [ 🔍 Search... ] | [ Agent Selector ▾ ] [ 👤 ]
```

| Elemen | Fungsi |
|---|---|
| Logo + Brand | Identitas HG Chat AI Agent |
| Prompt / Agent tabs | Toggle mode (UI only) |
| Search bar | Input pencarian konversasi |
| Agent Selector | Dropdown pemilih agent aktif — menampilkan foto + nama |
| User avatar | Placeholder profil user |

**Agent Dropdown** muncul saat selector diklik — menampilkan daftar 5 agent dengan foto, nama, role, dan checkmark pada agent aktif.

---

## 5. Sidebar

```
[ Chat & Discussion ]   ← badge counter
[ Task Focus ]
[ Schedule ]
───────────────
Tools
[ Performance ]
[ Reports ]             ← badge counter
[ Automation ]
[ Settings ]
───────────────
Agents
[ 🖼 Dave   ]   ● online
[ 🖼 Jaden  ]
[ 🖼 Joel   ]
[ 🖼 Dylan  ]
[ 🖼 Nana   ]
───────────────
[ 👤 Guest User ]
  HG Chat AI Agent · v1.0
```

Klik nama agent di sidebar langsung switch agent aktif.

---

## 6. Sockets Panel (296px, collapsible)

Panel tengah berisi **AI Skills Sockets** — tool cards yang bisa dipanggil untuk memproses percakapan aktif.

| Socket | Warna | Fungsi |
|---|---|---|
| 📄 Document Generator | Merah | Ekspor chat ke PDF report |
| 📊 Spreadsheet Compiler | Hijau | Parsing data ke Excel |
| 🗄️ Database Sync | Biru | Commit data ke server cluster |
| 🔮 AI Analyzer | Ungu | Semantic analysis & sentiment |
| ⚡ Webhook Push | Oranye | Push payload ke endpoint |

Panel bisa di-toggle (sembunyikan/tampilkan) via tombol ⚙ di chat header.

---

## 7. Chat Area

### 7a. Chat Header
```
[ Agent Photo ] [ Nama · Role · Online ] | [ 🛡 Chat is Protected ] | [ ⚙ ][ 🔍 ][ ··· ]
```

### 7b. Welcome View (tampil saat belum ada chat)
```
        [ Foto Agent — circle 148px + gold border ]
              🛡 HG Certified Agent
          "Hi! I'm Dave." (dinamis per agent)
       "Your dedicated Relationship Manager..."

  [ 💬 Suggest reply ] [ 📝 Summarize ] [ 🔑 Extract key details ]
  [ 💡 Detect sentiment ] [ 🔍 Search knowledge base ] [ ✅ Create task ]
```

### 7c. Chat Messages View
```
[ Agent Photo ] [ bubble: teks dari agent ]      ← agent bubble (abu terang)
               [ Foto User  ] [ bubble: pesan user ] ← user bubble (hitam + teks gold)

typing indicator: 3 dot bounce gold
```

### 7d. Chat Input Bar
```
[ 📎 Attach ] | [ ⚙ Options ] | [ 🖥 Model ]

[ textarea: "Ask AI to draft a reply..." ] [ 🎤 ] [ ➤ send ]
```

Send button: gradient gold. Tekan Enter untuk kirim, Shift+Enter untuk baris baru.

---

## 8. Agents

Lima agent tersedia, semua dengan foto real (embedded base64 JPEG):

| ID | Nama | Role | Persona |
|---|---|---|---|
| `dave` | Dave | Relationship Manager | Personal, premium approach |
| `jaden` | Jaden | Client Success Agent | Onboarding & satisfaction focused |
| `joel` | Joel | Strategic Analyst | Data-driven, strategic mindset |
| `dylan` | Dylan | Customer Experience | Empathetic, journey-focused |
| `nana` | Nana | Business Development | Growth, upsell, pipeline |

**Struktur data agent (JavaScript):**

```js
{
  id:      'dave',
  name:    'Dave',
  role:    'Relationship Manager',
  img:     'data:image/jpeg;base64,...',   // foto embedded
  greet:   "Hi! I'm Dave.",
  sub:     'Your dedicated Relationship Manager, ready to help.',
  replies: [ /* 5 variasi respons simulasi */ ]
}
```

---

## 9. Warna & Token Desain

```css
/* Gold palette */
--gold:  #C9A84C   /* main accent */
--gold2: #E8C96A   /* lighter gold */
--gold3: #F5DFA0   /* highlight */

/* Dark backgrounds */
--dark:  #0A0A0E   /* login bg */
--dark2: #111118   /* topbar */
--dark3: #16161F   /* panels */

/* Sidebar */
sidebar bg: #0C0C10

/* Chat */
chat bg:    #FFFFFF
panel bg:   #F6F6F9

/* Text */
text primary:   #111118
text secondary: #5A5A72
text muted:     #9898B2
border:         #E4E4EE
```

---

## 10. Tipografi

| Penggunaan | Font | Weight |
|---|---|---|
| Brand / Login title | Playfair Display | 400, 600, 700 |
| UI umum | Inter | 300–800 |

---

## 11. Animasi

| Nama | Trigger | Deskripsi |
|---|---|---|
| `orbFloat` | Auto (infinite) | Background orbs bergerak naik-turun |
| `logoGlow` | Auto (infinite) | Logo bernapas dengan glow gold |
| `cardIn` | Page load | Login card slide up + scale masuk |
| `shake` | PIN salah | Dots goyang kiri-kanan |
| `ripple expand` | PIN benar | Circle gold menutup layar |
| `dropIn` | Buka dropdown | Dropdown slide turun |
| `msgIn` | Pesan baru | Bubble chat fade + slide up |
| `tdot` | Typing | 3 dot bounce gold (stagger 200ms) |

---

## 12. Fitur Interaktif

- **PIN login** — 6 digit, numpad + keyboard
- **Agent switching** — 5 agent, switch dari topbar / sidebar
- **Chat simulasi** — kirim pesan, agent balas dengan typing indicator
- **Quick chips** — shortcut prompt populer
- **Sockets** — 5 tool cards dengan action button masing-masing
- **Panel toggle** — sockets panel bisa disembunyikan
- **Toast notification** — muncul saat socket diaktifkan
- **Auto-resize textarea** — input bar menyesuaikan panjang teks

---

## 13. File Assets (Embedded)

Semua asset diembed sebagai base64 di dalam HTML — tidak ada file eksternal:

| Asset | Format | Ukuran approx. |
|---|---|---|
| HG Logo | PNG → base64 | ~12 KB |
| Foto Dave | JPEG 300×300 → base64 | ~18 KB |
| Foto Jaden | JPEG 300×300 → base64 | ~19 KB |
| Foto Joel | JPEG 300×300 → base64 | ~19 KB |
| Foto Dylan | JPEG 300×300 → base64 | ~18 KB |
| Foto Nana | JPEG 300×300 → base64 | ~15 KB |
| **Total file** | HTML | **~172 KB** |

---

## 14. Dependensi Eksternal

Hanya satu — Google Fonts (membutuhkan koneksi internet):

```html
<link href="https://fonts.googleapis.com/css2?
  family=Inter:wght@300;400;500;600;700;800&
  family=Playfair+Display:wght@400;600;700
  &display=swap" rel="stylesheet">
```

Jika offline, browser akan fallback ke `-apple-system, sans-serif`.

---

## 15. Cara Kustomisasi

### Ganti PIN
```js
const CORRECT_PIN = '101010';   // ← ganti di sini
```

### Tambah Agent Baru
```js
{
  id:      'alex',
  name:    'Alex',
  role:    'Finance Advisor',
  img:     'data:image/jpeg;base64,...',
  greet:   "Hi! I'm Alex.",
  sub:     'Your finance advisor.',
  replies: ['Respons 1...', 'Respons 2...']
}
```

### Ganti Warna Tema
```css
:root {
  --gold:  #C9A84C;   /* ganti dengan warna brand */
  --gold2: #E8C96A;
}
```

---

*HG Chat AI Agent · v1.0 · Built by WIT.id*
