// ==========================================================================
// FlowState - Dual-Mode Live Timer & Stopwatch Engine (Zero-Drift)
// ==========================================================================

import { store } from './state.js';
import { audio } from './audio-engine.js';

export class TimerEngine {
  constructor() {
    this.mode = 'pomodoro'; // 'pomodoro' | 'stopwatch'
    this.pomodoroPhase = 'work'; // 'work' | 'shortBreak' | 'longBreak'
    this.completedPomodoros = 0;

    this.isRunning = false;
    this.startTime = 0;
    this.accumulatedMs = 0;
    this.intervalId = null;

    // Default durations in seconds
    this.workDuration = 25 * 60;
    this.shortBreakDuration = 5 * 60;
    this.longBreakDuration = 15 * 60;

    this.targetDurationSeconds = this.workDuration;
    this.elapsedSeconds = 0;

    // Fullscreen state
    this.isFullscreen = false;

    // UI elements cached
    this.dom = {};
  }

  initDOM() {
    this.dom = {
      clock: document.getElementById('timer-clock-display'),
      fsClock: document.getElementById('fs-clock-display'),
      sublabel: document.getElementById('timer-sublabel-text'),
      ring: document.getElementById('timer-progress-ring'),
      playBtn: document.getElementById('btn-timer-play'),
      resetBtn: document.getElementById('btn-timer-reset'),
      skipBtn: document.getElementById('btn-timer-skip'),
      fullscreenBtn: document.getElementById('btn-timer-fullscreen'),
      fsOverlay: document.getElementById('fullscreen-focus-view'),
      fsExitBtn: document.getElementById('fs-exit-button'),
      displayCard: document.getElementById('timer-display-card'),
      modePomoBtn: document.getElementById('mode-pomo-btn'),
      modeStopwatchBtn: document.getElementById('mode-stopwatch-btn'),
      pomoPhasesContainer: document.getElementById('pomo-phases-bar'),
      phaseWork: document.getElementById('phase-work-btn'),
      phaseShort: document.getElementById('phase-short-btn'),
      phaseLong: document.getElementById('phase-long-btn'),
      activeTaskPill: document.getElementById('active-task-pill'),
      fsActiveTask: document.getElementById('fs-active-task-text'),
      fsActiveTag: document.getElementById('fs-active-tag-badge')
    };

    this.bindEvents();
    this.updateDisplay();
  }

  bindEvents() {
    this.dom.playBtn?.addEventListener('click', () => this.toggle());
    this.dom.resetBtn?.addEventListener('click', () => this.reset());
    this.dom.skipBtn?.addEventListener('click', () => this.skipPhase());
    this.dom.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());
    this.dom.fsExitBtn?.addEventListener('click', () => this.exitFullscreen());

    // Direct Log Session button click
    document.getElementById('btn-direct-log-session')?.addEventListener('click', () => {
      this.pause();
      store.emit('request_post_session_prompt', {
        durationSeconds: this.elapsedSeconds > 0 ? this.elapsedSeconds : (this.mode === 'pomodoro' ? 1500 : 300),
        mode: this.mode,
        phase: this.pomodoroPhase
      });
    });

    this.dom.modePomoBtn?.addEventListener('click', () => this.switchMode('pomodoro'));
    this.dom.modeStopwatchBtn?.addEventListener('click', () => this.switchMode('stopwatch'));

    this.dom.phaseWork?.addEventListener('click', () => this.switchPhase('work'));
    this.dom.phaseShort?.addEventListener('click', () => this.switchPhase('shortBreak'));
    this.dom.phaseLong?.addEventListener('click', () => this.switchPhase('longBreak'));

    // Keyboard hotkeys
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        this.reset();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        this.toggleFullscreen();
      } else if (e.code === 'Escape' && this.isFullscreen) {
        e.preventDefault();
        this.exitFullscreen();
      } else if (e.key === '1') {
        this.switchMode('pomodoro');
      } else if (e.key === '2') {
        this.switchMode('stopwatch');
      }
    });

    // Listen to task changes
    store.subscribe('change', (state) => {
      this.updateTaskPill(state.currentUser);
    });
  }

  updateTaskPill(user) {
    if (!user) return;
    const taskTitle = user.currentTask || 'Deep Work Session';
    const tag = user.currentTag || '#Coding';

    if (this.dom.activeTaskPill) {
      this.dom.activeTaskPill.innerHTML = `
        <span class="active-tag-badge">${tag}</span>
        <span style="max-width: 170px; overflow:hidden; text-overflow:ellipsis;">${taskTitle}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      `;
    }

    if (this.dom.fsActiveTask) this.dom.fsActiveTask.textContent = taskTitle;
    if (this.dom.fsActiveTag) this.dom.fsActiveTag.textContent = tag;
  }

  switchMode(newMode) {
    if (this.isRunning) this.pause();
    this.mode = newMode;
    this.elapsedSeconds = 0;
    this.accumulatedMs = 0;

    if (this.dom.modePomoBtn && this.dom.modeStopwatchBtn) {
      this.dom.modePomoBtn.classList.toggle('active', newMode === 'pomodoro');
      this.dom.modeStopwatchBtn.classList.toggle('active', newMode === 'stopwatch');
    }

    if (this.dom.pomoPhasesContainer) {
      this.dom.pomoPhasesContainer.style.display = newMode === 'pomodoro' ? 'flex' : 'none';
    }

    this.updateDisplay();
  }

  switchPhase(phase) {
    if (this.isRunning) this.pause();
    this.pomodoroPhase = phase;
    this.elapsedSeconds = 0;
    this.accumulatedMs = 0;

    if (phase === 'work') this.targetDurationSeconds = this.workDuration;
    else if (phase === 'shortBreak') this.targetDurationSeconds = this.shortBreakDuration;
    else if (phase === 'longBreak') this.targetDurationSeconds = this.longBreakDuration;

    // Update phase pills
    [this.dom.phaseWork, this.dom.phaseShort, this.dom.phaseLong].forEach(btn => btn?.classList.remove('active', 'break-active'));
    if (phase === 'work') this.dom.phaseWork?.classList.add('active');
    else if (phase === 'shortBreak') this.dom.phaseShort?.classList.add('break-active');
    else if (phase === 'longBreak') this.dom.phaseLong?.classList.add('break-active');

    this.updateDisplay();
  }

  toggle() {
    if (this.isRunning) {
      this.pause();
    } else {
      this.start();
    }
  }

  start() {
    // If starting a fresh focus session and no target set, prompt task setting
    const user = store.get().currentUser;
    if (!this.isRunning && this.elapsedSeconds === 0 && (!user.currentTask || user.currentTask === 'Deep Work Session')) {
      store.emit('request_pre_session_prompt', { mode: this.mode, phase: this.pomodoroPhase });
    }

    this.isRunning = true;
    this.startTime = Date.now() - this.accumulatedMs;

    this.dom.displayCard?.classList.add('timer-running');
    this.dom.fsOverlay?.classList.add('timer-running');
    this.updatePlayBtnIcon(true);

    // Auto-resume ambient focus sound or custom track
    if (!audio.isPlaying && !audio.isMuted) {
      if (audio.isCustomTrack && audio.activeCustomTrack) {
        audio.playCustomTrack(audio.activeCustomTrack);
      } else {
        audio.playPreset();
      }
    }

    // High frequency interval (100ms) with zero drift calculation
    this.intervalId = setInterval(() => {
      this.tick();
    }, 100);

    store.emit('timer_started', { mode: this.mode, phase: this.pomodoroPhase });
  }

  // Bug fix: added `silent` param so internal calls (reset, onPomodoroComplete)
  // can skip the post-session prompt to prevent double modals or unwanted popups.
  pause({ silent = false } = {}) {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.dom.displayCard?.classList.remove('timer-running');
    this.dom.fsOverlay?.classList.remove('timer-running');
    this.updatePlayBtnIcon(false);

    // Auto-pause audio engine
    if (audio.isPlaying) {
      audio.pause();
    }

    // Bug 3 fix: Only show post-session prompt on user-initiated pause
    // during a work/stopwatch session (not on break phases, not silently).
    if (
      !silent &&
      this.elapsedSeconds >= 60 &&
      (this.mode === 'stopwatch' || this.pomodoroPhase === 'work')
    ) {
      store.emit('request_post_session_prompt', {
        durationSeconds: this.elapsedSeconds,
        mode: this.mode,
        phase: this.pomodoroPhase
      });
    }

    store.emit('timer_paused', { elapsedSeconds: this.elapsedSeconds });
  }

  reset() {
    // Bug 10 fix: use silent pause so reset() never triggers the post-session modal
    this.pause({ silent: true });
    this.accumulatedMs = 0;
    this.elapsedSeconds = 0;
    this.updateDisplay();
    store.emit('timer_reset', {});
  }

  skipPhase() {
    // Use silent pause — the post-session prompt is emitted explicitly below when needed
    this.pause({ silent: true });
    if (this.mode === 'pomodoro') {
      if (this.pomodoroPhase === 'work') {
        this.completedPomodoros++;
        // Prompt reflection to log the session
        store.emit('request_post_session_prompt', {
          durationSeconds: this.elapsedSeconds > 0 ? this.elapsedSeconds : this.targetDurationSeconds,
          mode: 'pomodoro',
          phase: 'work',
          autoCompleted: true
        });
        if (this.completedPomodoros % 4 === 0) {
          this.switchPhase('longBreak');
        } else {
          this.switchPhase('shortBreak');
        }
      } else {
        this.switchPhase('work');
      }
    } else {
      if (this.elapsedSeconds > 0) {
        store.emit('request_post_session_prompt', {
          durationSeconds: this.elapsedSeconds,
          mode: 'stopwatch'
        });
      }
      this.reset();
    }
  }

  tick() {
    const now = Date.now();
    this.accumulatedMs = now - this.startTime;
    this.elapsedSeconds = Math.floor(this.accumulatedMs / 1000);

    if (this.mode === 'pomodoro') {
      const remainingSeconds = Math.max(0, this.targetDurationSeconds - this.elapsedSeconds);

      if (remainingSeconds === 0) {
        this.onPomodoroComplete();
        return;
      }
    }

    this.updateDisplay();
  }

  onPomodoroComplete() {
    // Bug 2 fix: use silent pause to prevent double post-session modal.
    // pause() would normally emit request_post_session_prompt, but we handle it below.
    this.pause({ silent: true });
    audio.playChime();

    const isWorkSession = this.pomodoroPhase === 'work';

    if (isWorkSession) {
      this.completedPomodoros++;
      // Log session
      store.emit('request_post_session_prompt', {
        durationSeconds: this.targetDurationSeconds,
        mode: 'pomodoro',
        phase: 'work',
        autoCompleted: true
      });

      // Switch to break
      if (this.completedPomodoros % 4 === 0) {
        this.switchPhase('longBreak');
      } else {
        this.switchPhase('shortBreak');
      }
    } else {
      // Break finished, ready for work
      this.switchPhase('work');
    }
  }

  updateDisplay() {
    let displayTime = '';
    let progressRatio = 0;

    if (this.mode === 'pomodoro') {
      const remainingSeconds = Math.max(0, this.targetDurationSeconds - this.elapsedSeconds);
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      displayTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      progressRatio = this.elapsedSeconds / this.targetDurationSeconds;

      if (this.dom.sublabel) {
        this.dom.sublabel.innerHTML = `
          <span class="status-dot"></span>
          <span>${this.pomodoroPhase === 'work' ? 'Deep Focus Session' : (this.pomodoroPhase === 'shortBreak' ? 'Short Recovery Break' : 'Restorative Long Break')}</span>
        `;
      }
    } else {
      // Stopwatch Mode
      const hours = Math.floor(this.elapsedSeconds / 3600);
      const mins = Math.floor((this.elapsedSeconds % 3600) / 60);
      const secs = this.elapsedSeconds % 60;
      if (hours > 0) {
        displayTime = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      } else {
        displayTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
      // Fluid continuous rotation for stopwatch
      progressRatio = (this.elapsedSeconds % 3600) / 3600;

      if (this.dom.sublabel) {
        this.dom.sublabel.innerHTML = `
          <span class="status-dot"></span>
          <span>Continuous Flow State</span>
        `;
      }
    }

    if (this.dom.clock) this.dom.clock.textContent = displayTime;
    if (this.dom.fsClock) this.dom.fsClock.textContent = displayTime;

    // Update document title for background tab glance
    document.title = `${displayTime} • FlowState`;

    // Circular progress ring animation (circumference = 2 * PI * 150 ~= 942.48)
    if (this.dom.ring) {
      const circumference = 942.48;
      const offset = circumference - (Math.min(1, Math.max(0, progressRatio)) * circumference);
      this.dom.ring.style.strokeDashoffset = offset;
    }
  }

  updatePlayBtnIcon(isPlaying) {
    if (!this.dom.playBtn) return;
    if (isPlaying) {
      this.dom.playBtn.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="2"></rect>
          <rect x="14" y="4" width="4" height="16" rx="2"></rect>
        </svg>
      `;
    } else {
      this.dom.playBtn.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      `;
    }
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
      this.dom.fsOverlay?.classList.add('active');
    } else {
      this.dom.fsOverlay?.classList.remove('active');
    }
  }

  exitFullscreen() {
    this.isFullscreen = false;
    this.dom.fsOverlay?.classList.remove('active');
  }
}

export const timer = new TimerEngine();
