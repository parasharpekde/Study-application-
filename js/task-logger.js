// ==========================================================================
// FlowState - Work & Task Logging Engine (Pre/Post Session Prompts)
// ==========================================================================

import { store } from './state.js';

class TaskLoggerEngine {
  constructor() {
    this.pendingSessionData = null;
    this.currentSelectedTag = '#Coding';
    this.selectedRating = 5;
  }

  init() {
    this.preModal = document.getElementById('pre-session-modal');
    this.postModal = document.getElementById('post-session-modal');

    this.preInput = document.getElementById('pre-task-input');
    this.preTagContainer = document.getElementById('pre-tag-pills');
    this.preSubmitBtn = document.getElementById('btn-save-pre-task');
    this.preCloseBtn = document.getElementById('btn-close-pre-modal');

    this.postTaskTitle = document.getElementById('post-session-task-title');
    this.postDuration = document.getElementById('post-session-duration');
    this.postNotes = document.getElementById('post-reflection-input');
    this.postStars = document.querySelectorAll('.star-rating-btn');
    this.postSubmitBtn = document.getElementById('btn-save-post-session');
    this.postDiscardBtn = document.getElementById('btn-discard-post-session');
    this.postCloseBtn = document.getElementById('btn-close-post-modal');

    this.bindEvents();
  }

  bindEvents() {
    // Open Pre-Session Modal from active task pill click
    document.getElementById('active-task-pill')?.addEventListener('click', () => {
      this.openPreSessionModal();
    });

    store.subscribe('request_pre_session_prompt', () => {
      this.openPreSessionModal();
    });

    store.subscribe('request_post_session_prompt', (data) => {
      this.openPostSessionModal(data);
    });

    // Tag pills selection in Pre-Session
    this.preTagContainer?.addEventListener('click', (e) => {
      const pill = e.target.closest('.tag-pill');
      if (pill) {
        this.preTagContainer.querySelectorAll('.tag-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentSelectedTag = pill.dataset.tag || '#Coding';
      }
    });

    // Pre-Session Save
    this.preSubmitBtn?.addEventListener('click', () => {
      this.savePreSession();
    });
    this.preInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.savePreSession();
    });
    this.preCloseBtn?.addEventListener('click', () => this.closePreModal());

    // Star rating selection
    this.postStars?.forEach(star => {
      star.addEventListener('click', () => {
        const rating = parseInt(star.dataset.value, 10) || 5;
        this.setRating(rating);
      });
    });

    // Post-Session Save
    this.postSubmitBtn?.addEventListener('click', () => {
      this.savePostSession();
    });
    this.postDiscardBtn?.addEventListener('click', () => {
      this.closePostModal();
    });
    this.postCloseBtn?.addEventListener('click', () => {
      this.closePostModal();
    });
  }

  openPreSessionModal() {
    const user = store.get().currentUser;
    if (this.preInput) {
      this.preInput.value = user.currentTask || '';
      setTimeout(() => this.preInput.focus(), 50);
    }
    this.currentSelectedTag = user.currentTag || '#Coding';

    this.preTagContainer?.querySelectorAll('.tag-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.tag === this.currentSelectedTag);
    });

    this.preModal?.classList.add('active');
  }

  closePreModal() {
    this.preModal?.classList.remove('active');
  }

  savePreSession() {
    const taskTitle = this.preInput?.value.trim() || 'Deep Work Session';
    store.set(s => ({
      ...s,
      currentUser: {
        ...s.currentUser,
        currentTask: taskTitle,
        currentTag: this.currentSelectedTag
      }
    }));
    this.closePreModal();
  }

  openPostSessionModal(data) {
    this.pendingSessionData = data;
    const user = store.get().currentUser;

    const mins = Math.max(1, Math.round(data.durationSeconds / 60));
    if (this.postDuration) this.postDuration.textContent = `${mins} minutes`;
    if (this.postTaskTitle) this.postTaskTitle.textContent = `${user.currentTag} • ${user.currentTask || 'Focus Session'}`;
    const quickNote = document.getElementById('timer-quick-reflection')?.value.trim() || '';
    if (this.postNotes) {
      this.postNotes.value = quickNote;
      setTimeout(() => this.postNotes.focus(), 50);
    }

    this.setRating(5);
    this.postModal?.classList.add('active');
  }

  closePostModal() {
    this.postModal?.classList.remove('active');
    this.pendingSessionData = null;
  }

  setRating(rating) {
    this.selectedRating = rating;
    this.postStars?.forEach(star => {
      const val = parseInt(star.dataset.value, 10);
      star.style.opacity = val <= rating ? '1' : '0.25';
      star.style.transform = val <= rating ? 'scale(1.15)' : 'scale(1)';
    });
  }

  savePostSession() {
    if (!this.pendingSessionData) return;

    const user = store.get().currentUser;
    const notes = this.postNotes?.value.trim() || 'Target completed with high focus.';

    const session = {
      id: 'sess-' + Date.now(),
      date: new Date().toISOString(),
      taskName: user.currentTask || 'Deep Work Session',
      tag: user.currentTag || '#Coding',
      durationSeconds: this.pendingSessionData.durationSeconds,
      completedWork: notes,
      rating: this.selectedRating
    };

    store.addSessionLog(session);

    // Clear quick reflection field on card
    const quickInput = document.getElementById('timer-quick-reflection');
    if (quickInput) quickInput.value = '';

    // Trigger toast notification
    store.emit('show_toast', {
      type: 'success',
      message: `🎉 Session logged! Added ${Math.round(session.durationSeconds / 60)}m of focus time.`
    });

    this.closePostModal();
  }
}

export const taskLogger = new TaskLoggerEngine();
