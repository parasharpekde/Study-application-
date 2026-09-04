# ⚡ FlowState — Distraction-Free Focus Timer & Multiplayer Study Squads

A sleek, modern, distraction-free Web Application engineered to track deep work focus time, record work outputs, deliver real-time study analytics, and foster social accountability through competitive study groups.

---

## 🌟 Core Features

### 1. Dual-Mode Live Timer & Stopwatch
- **Zero Timer Drift**: Driven by high-precision timestamp differentials (`Date.now() - startTime`) ensuring 100% precision even when switching tabs or backgrounding the browser.
- **Pomodoro Mode**: Customizable Focus (25m), Short Break (5m), and Long Break (15m) with automated cycle tracking (every 4 sessions).
- **Continuous Flow Stopwatch**: Fluid count-up mode for deep work flow states logging exact duration.
- **Distraction-Free Zen Fullscreen Mode**: Press `[F]` or click the expand button to toggle an ambient, glowing, distraction-free live clock canvas with pulsing aura.

### 2. Integrated Focus Audio & Music Player
- **Pure Web Audio API Synthesis**: 100% offline reliability with zero broken third-party audio stream URLs:
  - **Warm Brown Noise**: Low-pass Brownian random walk ideal for ADHD focus and deep work immersion.
  - **Gentle Pink Noise**: Soft natural waterfall spectrum.
  - **40Hz Gamma Binaural Beats**: Dual sine wave stereo oscillators for high cognitive performance.
  - **14Hz Beta Study Binaural Beats**: Relaxed concentration and memory retention.
  - **Rain & Ambient Storm**: Real-time noise modulation with dynamic raindrop bursts.
  - **Lo-Fi Chill Synthesizer**: Warm jazz chord progressions (Cmaj9, Am9, Dm9, G13) synthesized with vintage tape warmth.
- **Sound Controls**: Volume slider, mute button (`[M]`), track switcher, live canvas frequency visualizer, and auto-pause when timer is paused.
- **Zen Bell Alert**: Meditative Tibetan singing bowl tone synthesized on Pomodoro completion.

### 3. Work & Task Logging Engine
- **Pre-Session Target Setting**: Set your focus goal and choose from color-coded category tags (`#Coding`, `#Math`, `#Writing`, `#Reading`, `#Design`, `#Research`).
- **Post-Session Reflection**: Rate session productivity (1–5 stars) and record notes on work completed.
- **Persistent Log Storage**: Sessions saved locally with search, tag filtering, and one-click **CSV** and **JSON** export.

### 4. Multiplayer Study Groups & Competition Engine
- **Study Squad Rooms**: Create private squads or join with room invite codes (e.g. `FLOW-7749`).
- **Real-Time Live Presence**: Live cards showing which members are actively in deep work, their current task and tag, with live ticking seconds.
- **Competitive Leaderboard**: Filter rankings by **Today**, **This Week**, or **All-Time** with gold/silver/bronze trophies and streak counters.
- **Team Challenges**: Visual progress bars tracking group goals (e.g., *First to 20 Hours This Week*).
- **Activity Stream & Reactions**: Real-time session completion feed with interactive emoji reactions (🔥, 👏, ⚡, ☕, 🧠) and floating particle physics.

### 5. Real-Time Study Analytics & Dashboard
- **Daily Focus vs. Goal Widget**: Live progress tracker (e.g. `2.3h / 5h` with % meter).
- **Interactive SVG Weekly Distribution**: Bar chart displaying hours focused across the last 7 days.
- **Interactive SVG Category Donut**: Visual percentage breakdown of time spent per tag.
- **Interactive History Table**: Full log of previous work with rating, duration, and notes.

### 6. Dual-Mode Data Layer & Supabase Realtime
- **Offline / LocalStorage Fallback**: Fully functional out of the box with zero external configuration required.
- **Supabase Cloud Sync**: Connect your Supabase project in the Cloud Sync modal by entering your `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- Includes full SQL migration file: [`supabase-schema.sql`](supabase-schema.sql).

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Start / Pause Timer |
| `R` | Reset Timer |
| `F` | Toggle Distraction-Free Fullscreen Mode |
| `M` | Mute / Unmute Focus Audio |
| `1` | Switch to Pomodoro Mode |
| `2` | Switch to Stopwatch Mode |
| `Esc` | Exit Fullscreen Mode / Close Modals |

---

## 🚀 Running Locally

To run the local development server:

```bash
node server.js
```

Then navigate to: **`http://localhost:3000`** in your browser.
