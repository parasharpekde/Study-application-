// ==========================================================================
// FlowState - Application Main Orchestrator & Navigation
// ==========================================================================

import { store } from './state.js';
import { timer } from './timer.js';
import { audio } from './audio-engine.js';
import { taskLogger } from './task-logger.js';
import { squad } from './squad-engine.js';
import { analytics } from './analytics-engine.js';
import { supabaseSync } from './supabase-client.js';
import { customAudioDB } from './custom-audio-db.js';
import { offlineSyncManager } from './offline-sync-manager.js';
import { authEngine } from './auth-engine.js';

class FlowStateApp {
  constructor() {
    this.currentTab = 'timer'; // 'timer' | 'squad' | 'analytics'
  }

  init() {
    // Initialize components
    timer.initDOM();
    taskLogger.init();
    squad.init();
    analytics.init();
    supabaseSync.init();
    authEngine.init();

    this.bindNavigation();
    this.bindAudioDock();
    this.bindCustomMusicManager();
    this.bindToasts();
    this.bindHelpModal();
    this.bindOfflineDeepFocus();
    this.bindDashboardWidgets();

    console.log('✨ FlowState Web Application initialized successfully!');
  }

  bindNavigation() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetView = tab.dataset.view;
        this.switchTab(targetView);
      });
    });
  }

  switchTab(tabName) {
    this.currentTab = tabName;

    // Update nav buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === tabName);
    });

    // Update visible view sections
    document.querySelectorAll('.view-section').forEach(view => {
      view.classList.remove('active');
    });

    const activeSection = document.getElementById(`view-${tabName}`);
    if (activeSection) {
      activeSection.classList.add('active');
    }

    // Refresh charts or views if switching to analytics or squad
    if (tabName === 'analytics') {
      analytics.renderAll();
    } else if (tabName === 'squad') {
      squad.renderAll();
    }
  }

  bindAudioDock() {
    const dock = document.getElementById('audio-player-dock');
    const toggleCollapseBtn = document.getElementById('btn-toggle-audio-dock');
    const playPauseBtn = document.getElementById('btn-audio-play-toggle');
    const muteBtn = document.getElementById('btn-audio-mute-toggle');
    const volumeSlider = document.getElementById('audio-volume-slider');
    const presetsContainer = document.getElementById('sound-presets-container');
    const nowPlayingTitle = document.getElementById('audio-now-playing-title');

    // Preset labels dictionary
    const presetNames = {
      brown: 'Warm Brown Noise',
      pink: 'Gentle Pink Noise',
      binaural_gamma: '40Hz Gamma Focus (Binaural)',
      binaural_beta: '14Hz Beta Study (Binaural)',
      rain: 'Rain & Ambient Storm',
      lofi: 'Lo-Fi Chill Synthesizer'
    };

    // Toggle collapse
    toggleCollapseBtn?.addEventListener('click', () => {
      dock?.classList.toggle('collapsed');
      toggleCollapseBtn.innerHTML = dock?.classList.contains('collapsed')
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    });

    // Play / Pause Toggle
    playPauseBtn?.addEventListener('click', () => {
      const isPlaying = audio.togglePlay();
      this.updateAudioPlayIcon(isPlaying);
    });

    // Mute Toggle
    muteBtn?.addEventListener('click', () => {
      const isMuted = audio.toggleMute();
      muteBtn.style.color = isMuted ? 'var(--accent-rose)' : 'var(--text-muted)';
      store.emit('show_toast', {
        type: 'info',
        message: isMuted ? '🔇 Audio muted' : '🔊 Audio unmuted'
      });
    });

    // Volume Slider
    volumeSlider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      audio.setVolume(val);
    });

    // Preset selection
    presetsContainer?.addEventListener('click', (e) => {
      const chip = e.target.closest('.preset-chip');
      if (chip) {
        if (chip.id === 'btn-open-custom-music') return; // Handled in bindCustomMusicManager
        presetsContainer.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const presetKey = chip.dataset.preset;
        if (presetKey) {
          audio.playPreset(presetKey);
          this.updateAudioPlayIcon(true);
          if (nowPlayingTitle) nowPlayingTitle.textContent = presetNames[presetKey] || 'Ambient Sound';
          const sub = dock?.querySelector('.audio-subtitle');
          if (sub) sub.textContent = 'Web Audio Pure Synthesis • Zero Lag';
        }
      }
    });

    // Global 'M' hotkey for mute
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.code === 'KeyM') {
        e.preventDefault();
        const isMuted = audio.toggleMute();
        if (muteBtn) muteBtn.style.color = isMuted ? 'var(--accent-rose)' : 'var(--text-muted)';
      }
    });

    // Sync UI when state or audio changes
    store.subscribe('audio_state_change', ({ isPlaying, preset, customTrack }) => {
      this.updateAudioPlayIcon(isPlaying);
      const sub = dock?.querySelector('.audio-subtitle');
      if (preset === 'custom' && customTrack) {
        if (nowPlayingTitle) nowPlayingTitle.textContent = customTrack.trackName;
        if (sub) sub.textContent = 'Private Local Track • Stored in IndexedDB';
        presetsContainer?.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        document.getElementById('btn-open-custom-music')?.classList.add('active');
      } else {
        if (nowPlayingTitle) nowPlayingTitle.textContent = presetNames[preset] || 'Ambient Sound';
        if (sub) sub.textContent = 'Web Audio Pure Synthesis • Zero Lag';
        // Bug 8 fix: re-apply active class to the correct preset chip on resume
        presetsContainer?.querySelectorAll('.preset-chip').forEach(c => {
          const isMatch = c.dataset.preset === preset;
          c.classList.toggle('active', isMatch);
        });
        document.getElementById('btn-open-custom-music')?.classList.remove('active');
      }
      dock?.classList.toggle('audio-playing', isPlaying);
      this.updateCustomTracksActiveState();
    });
  }

  // ========================================================================
  // ZERO-KNOWLEDGE CUSTOM MUSIC MANAGER CONTROLLER
  // ========================================================================
  bindCustomMusicManager() {
    const modal = document.getElementById('custom-music-modal');
    const openBtn = document.getElementById('btn-open-custom-music');
    const closeBtn = document.getElementById('btn-close-custom-music-modal');
    const dropzone = document.getElementById('audio-dropzone');
    const fileInput = document.getElementById('audio-file-input');
    const browseBtn = document.getElementById('btn-browse-audio-files');
    const addStreamBtn = document.getElementById('btn-add-stream-track');
    const streamNameInput = document.getElementById('input-stream-name');
    const streamUrlInput = document.getElementById('input-stream-url');

    // Open Modal
    openBtn?.addEventListener('click', () => {
      this.refreshCustomMusicUI();
      modal?.classList.add('active');
    });

    // Close Modal
    closeBtn?.addEventListener('click', () => {
      modal?.classList.remove('active');
    });

    // File Browse Trigger
    browseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });
    dropzone?.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        fileInput?.click();
      }
    });

    // Drag & Drop Handling
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone?.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone?.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('drag-over');
      });
    });

    dropzone?.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      await this.handleAudioFilesUpload(files);
    });

    fileInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      await this.handleAudioFilesUpload(files);
      fileInput.value = '';
    });

    // Stream URL Add
    addStreamBtn?.addEventListener('click', async () => {
      const name = streamNameInput?.value.trim() || 'Web Audio Stream';
      const url = streamUrlInput?.value.trim();

      if (!url) {
        store.emit('show_toast', { type: 'warning', message: '⚠️ Please provide a valid audio stream URL.' });
        return;
      }

      try {
        await customAudioDB.addStreamTrack(name, url);
        if (streamNameInput) streamNameInput.value = '';
        if (streamUrlInput) streamUrlInput.value = '';
        store.emit('show_toast', { type: 'success', message: `📻 Added stream "${name}" to your private vault!` });
        await this.refreshCustomMusicUI();
      } catch (err) {
        store.emit('show_toast', { type: 'warning', message: '❌ ' + (err.message || 'Failed to add stream.') });
      }
    });

    // Initial load
    this.refreshCustomMusicUI();
  }

  async handleAudioFilesUpload(files) {
    if (!files.length) return;

    const validExtensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'weba'];
    let addedCount = 0;

    for (const file of files) {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!file.type.startsWith('audio/') && !validExtensions.includes(ext)) {
        continue;
      }

      try {
        await customAudioDB.addBlobTrack(file);
        addedCount++;
      } catch (err) {
        console.error('Track add error:', err);
        store.emit('show_toast', {
          type: 'warning',
          message: '⚠️ ' + (err.message || `Could not store ${file.name}`)
        });
      }
    }

    if (addedCount > 0) {
      store.emit('show_toast', {
        type: 'success',
        message: `🎵 Stored ${addedCount} audio file(s) locally in IndexedDB (0% cloud uploaded)!`
      });
      await this.refreshCustomMusicUI();
    }
  }

  async refreshCustomMusicUI() {
    try {
      const tracks = await customAudioDB.getAllTracks();
      const usage = await customAudioDB.getStorageUsage();

      // Badges
      const countBadge = document.getElementById('custom-track-count-badge');
      const playlistBadge = document.getElementById('playlist-count-badge');
      if (countBadge) countBadge.textContent = tracks.length;
      if (playlistBadge) playlistBadge.textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'}`;

      // Storage Meter
      const statText = document.getElementById('custom-storage-stat-text');
      const progressBar = document.getElementById('custom-storage-bar');
      const quotaText = document.getElementById('custom-storage-quota-text');

      if (statText) {
        statText.textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'} • ${usage.totalMB} MB`;
      }
      if (progressBar) {
        // Assume 500MB baseline quota visual or browser quota %
        const percent = usage.quotaInfo ? Math.min(100, Math.max(2, parseFloat(usage.quotaInfo.percent) || 0)) : Math.min(100, (usage.totalBytes / (250 * 1024 * 1024)) * 100);
        progressBar.style.width = `${Math.max(3, percent)}%`;
      }
      if (quotaText && usage.quotaInfo) {
        quotaText.textContent = `Browser storage usage: ${usage.quotaInfo.usageMB} MB of ${usage.quotaInfo.quotaMB} MB available (Safe)`;
      }

      this.renderCustomTracksList(tracks);
    } catch (err) {
      console.warn('Error refreshing custom audio UI:', err);
    }
  }

  renderCustomTracksList(tracks = []) {
    const list = document.getElementById('custom-tracks-list');
    if (!list) return;

    if (!tracks.length) {
      list.innerHTML = `
        <div class="custom-empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>
          </svg>
          <div style="font-weight: 600; color: var(--text-main); margin-bottom: 0.25rem;">Your private vault is empty</div>
          <div>Drag & drop .mp3, .wav, or .flac files above to enjoy custom focus music!</div>
        </div>
      `;
      return;
    }

    list.innerHTML = tracks.map(t => {
      const isCurrentActive = audio.isCustomTrack && audio.activeCustomTrack?.id === t.id && audio.isPlaying;
      const sizeFormatted = t.type === 'blob' ? `${(t.size / (1024 * 1024)).toFixed(1)} MB` : 'Stream Link';

      return `
        <div class="custom-track-item ${isCurrentActive ? 'active-playing' : ''}" data-id="${t.id}">
          <div class="custom-track-main">
            <button class="btn-play-custom-track" data-action="play" title="${isCurrentActive ? 'Pause' : 'Play Track'}">
              ${isCurrentActive 
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`
              }
            </button>
            <div class="custom-track-meta">
              <span class="custom-track-name" title="${t.trackName}">${t.trackName}</span>
              <div class="custom-track-details">
                <span class="track-format-tag">${t.format}</span>
                <span>• ${sizeFormatted}</span>
              </div>
            </div>
          </div>
          <div class="custom-track-actions">
            <button class="btn-track-action" data-action="rename" title="Rename Track">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button class="btn-track-action btn-delete" data-action="delete" title="Purge Track from IndexedDB">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach Delegation Actions
    list.querySelectorAll('.custom-track-item').forEach(item => {
      const trackId = item.dataset.id;

      item.querySelector('[data-action="play"]')?.addEventListener('click', async () => {
        const isCurrentActive = audio.isCustomTrack && audio.activeCustomTrack?.id === trackId && audio.isPlaying;
        if (isCurrentActive) {
          audio.pause();
        } else {
          const track = await customAudioDB.getTrack(trackId);
          if (track) {
            await audio.playCustomTrack(track);
          }
        }
      });

      item.querySelector('[data-action="rename"]')?.addEventListener('click', async () => {
        const currentName = item.querySelector('.custom-track-name')?.textContent || '';
        const newName = prompt('Enter new display name for this track:', currentName);
        if (newName && newName.trim() && newName.trim() !== currentName) {
          try {
            await customAudioDB.updateTrackName(trackId, newName.trim());
            store.emit('show_toast', { type: 'success', message: '✏️ Track renamed.' });
            await this.refreshCustomMusicUI();
          } catch (e) {
            store.emit('show_toast', { type: 'warning', message: e.message });
          }
        }
      });

      item.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        const trackName = item.querySelector('.custom-track-name')?.textContent || 'this track';
        if (confirm(`Purge "${trackName}" permanently from local browser storage?`)) {
          if (audio.isCustomTrack && audio.activeCustomTrack?.id === trackId) {
            audio.pause();
          }
          await customAudioDB.deleteTrack(trackId);
          store.emit('show_toast', { type: 'info', message: '🗑️ Track removed from local storage.' });
          await this.refreshCustomMusicUI();
        }
      });
    });
  }

  updateCustomTracksActiveState() {
    const list = document.getElementById('custom-tracks-list');
    if (!list) return;

    list.querySelectorAll('.custom-track-item').forEach(item => {
      const trackId = item.dataset.id;
      const isCurrentActive = audio.isCustomTrack && audio.activeCustomTrack?.id === trackId && audio.isPlaying;
      item.classList.toggle('active-playing', isCurrentActive);

      const playBtn = item.querySelector('[data-action="play"]');
      if (playBtn) {
        playBtn.title = isCurrentActive ? 'Pause' : 'Play Track';
        playBtn.innerHTML = isCurrentActive
          ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`
          : `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      }
    });
  }

  updateAudioPlayIcon(isPlaying) {
    const playBtn = document.getElementById('btn-audio-play-toggle');
    if (!playBtn) return;
    if (isPlaying) {
      playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>`;
    } else {
      playBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    }
  }

  bindToasts() {
    const container = document.getElementById('toast-container');
    if (!container) return;

    store.subscribe('show_toast', ({ type = 'info', message = '' }) => {
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `<span>${message}</span>`;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    });
  }

  bindHelpModal() {
    const modal = document.getElementById('shortcuts-help-modal');
    document.getElementById('btn-open-help')?.addEventListener('click', () => {
      modal?.classList.add('active');
    });
    document.getElementById('btn-close-help-modal')?.addEventListener('click', () => {
      modal?.classList.remove('active');
    });

    // Bug 9 fix: global Esc key handler to close any open modal overlay
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      // Don't interfere if fullscreen is active (timer.js handles that)
      const openModals = document.querySelectorAll('.modal-overlay.active');
      if (openModals.length > 0) {
        e.preventDefault();
        openModals.forEach(m => m.classList.remove('active'));
      }
    });
  }

  // ========================================================================
  // OFFLINE DEEP FOCUS MODE CONTROLLER
  // ========================================================================
  bindOfflineDeepFocus() {
    const toggle = document.getElementById('offline-focus-toggle');
    const syncQueueBar = document.getElementById('sync-queue-bar');
    const syncNowBtn = document.getElementById('btn-sync-now');
    const disableShieldBtn = document.getElementById('btn-disable-shield');

    // Restore persisted toggle state
    if (offlineSyncManager.isDeepFocusActive && toggle) {
      toggle.checked = true;
    }

    // Initial UI sync
    this.updateOfflineFocusUI(offlineSyncManager.getStatus());

    // Toggle switch interaction
    toggle?.addEventListener('change', () => {
      offlineSyncManager.setDeepFocusMode(toggle.checked);
      this.updateOfflineFocusUI(offlineSyncManager.getStatus());
    });

    // "Sync Now" manual trigger
    syncNowBtn?.addEventListener('click', async () => {
      syncNowBtn.textContent = 'Syncing...';
      syncNowBtn.disabled = true;
      const result = await offlineSyncManager.syncPendingSessions();
      syncNowBtn.textContent = 'Sync Now';
      syncNowBtn.disabled = false;
      if (result.success && result.syncedCount > 0) {
        this.updateOfflineFocusUI(offlineSyncManager.getStatus());
      }
    });

    // "Disable Shield" button inside squad distraction overlay
    disableShieldBtn?.addEventListener('click', () => {
      if (toggle) toggle.checked = false;
      offlineSyncManager.setDeepFocusMode(false);
      this.updateOfflineFocusUI(offlineSyncManager.getStatus());
    });

    // D-key hotkey for toggling deep focus
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const newState = offlineSyncManager.toggleDeepFocusMode();
        if (toggle) toggle.checked = newState;
        this.updateOfflineFocusUI(offlineSyncManager.getStatus());
      }
    });

    // Subscribe to offline manager events
    offlineSyncManager.subscribe('status_changed', (status) => {
      this.updateOfflineFocusUI(status);
    });

    offlineSyncManager.subscribe('queue_updated', ({ pendingCount }) => {
      const queueText = document.getElementById('sync-queue-text');
      if (queueText) queueText.textContent = `${pendingCount} session${pendingCount === 1 ? '' : 's'} queued for sync`;
      if (syncQueueBar) syncQueueBar.style.display = pendingCount > 0 ? 'flex' : 'none';
    });

    offlineSyncManager.subscribe('sync_progress', ({ synced, total }) => {
      const barWrap = document.getElementById('sync-progress-bar-wrap');
      const bar = document.getElementById('sync-progress-bar');
      if (barWrap && bar) {
        barWrap.classList.add('active');
        const pct = total > 0 ? Math.round((synced / total) * 100) : 0;
        bar.style.width = `${pct}%`;
      }
    });

    offlineSyncManager.subscribe('sync_completed', () => {
      const barWrap = document.getElementById('sync-progress-bar-wrap');
      const bar = document.getElementById('sync-progress-bar');
      if (bar) bar.style.width = '100%';
      setTimeout(() => {
        if (syncQueueBar) syncQueueBar.style.display = 'none';
        if (barWrap) barWrap.classList.remove('active');
        if (bar) bar.style.width = '0%';
      }, 700);
    });
  }

  /**
   * Master UI updater: refreshes all offline/deep-focus-related DOM elements
   * based on the current status from offlineSyncManager.
   * @param {{ isOnline: boolean, isDeepFocusActive: boolean, isShielded: boolean, pendingCount: number }} status
   */
  updateOfflineFocusUI(status) {
    const { isOnline, isDeepFocusActive, isShielded, pendingCount } = status;

    // ── Top-level Offline Banner ──
    const banner = document.getElementById('offline-mode-banner');
    const bannerText = document.getElementById('offline-banner-text');
    if (banner) {
      if (!isOnline) {
        banner.classList.add('visible');
        if (bannerText) bannerText.textContent = 'Network Offline — Focus sessions are safely recorded in local queue';
      } else if (isDeepFocusActive) {
        banner.classList.add('visible');
        if (bannerText) bannerText.textContent = '🛡️ Offline Deep Focus Active — Distractions muted, local session recording';
      } else {
        banner.classList.remove('visible');
      }
    }

    // ── Network Status Badge (top nav) ──
    const badge = document.getElementById('network-status-badge');
    const dot = document.getElementById('net-status-dot');
    const label = document.getElementById('net-status-label');

    if (badge && dot && label) {
      badge.classList.remove('offline', 'shielded');
      if (!isOnline) {
        badge.classList.add('offline');
        label.textContent = 'Offline';
      } else if (isDeepFocusActive) {
        badge.classList.add('shielded');
        label.textContent = 'Deep Focus';
      } else {
        label.textContent = 'Online';
      }
    }

    // ── Offline Focus Toggle Panel ──
    const panel = document.getElementById('offline-focus-panel');
    const subLabel = document.getElementById('offline-focus-sub');
    const toggle = document.getElementById('offline-focus-toggle');

    if (panel) panel.classList.toggle('active-shield', isShielded);
    if (toggle && toggle.checked !== isDeepFocusActive) toggle.checked = isDeepFocusActive;

    if (subLabel) {
      if (!isOnline) {
        subLabel.textContent = '⚠️ Network offline — sessions queued locally';
      } else if (isDeepFocusActive) {
        subLabel.textContent = '🛡️ Shield active — squad distractions muted';
      } else {
        subLabel.textContent = 'Distraction shield off — Squad feeds live';
      }
    }

    // ── Sync Queue Bar ──
    const queueBar = document.getElementById('sync-queue-bar');
    const queueText = document.getElementById('sync-queue-text');
    if (queueBar) queueBar.style.display = pendingCount > 0 ? 'flex' : 'none';
    if (queueText) queueText.textContent = `${pendingCount} session${pendingCount === 1 ? '' : 's'} queued for sync`;

    // ── Distraction Shield Overlay (squad view) ──
    const shield = document.getElementById('distraction-shield');
    if (shield) shield.classList.toggle('active', isShielded);

    // ── Body class for subtle global dimming ──
    document.body.classList.toggle('deep-focus-active', isShielded);
    document.body.classList.toggle('offline-mode', !isOnline);
  }

  // ==========================================================================
  // Modern Pastel Dashboard Widgets: Status Clock, Calendar & Schedule Timeline
  // ==========================================================================
  bindDashboardWidgets() {
    // 1. Dynamic Status Bar Clock ("9:41 AM" aesthetic)
    const statusClock = document.getElementById('status-clock-text');
    const updateClock = () => {
      if (statusClock) {
        const now = new Date();
        statusClock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    };
    updateClock();
    setInterval(updateClock, 15000);

    // 2. Interactive Calendar Week Strip (Sat to Fri)
    const calendarStrip = document.getElementById('calendar-week-strip');
    calendarStrip?.addEventListener('click', (e) => {
      const btn = e.target.closest('.calendar-day-btn');
      if (btn) {
        calendarStrip.querySelectorAll('.calendar-day-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const day = btn.dataset.day;
        const date = btn.dataset.date;
        store.emit('show_toast', {
          type: 'info',
          message: `📅 Viewing focus log for ${day}, Sep ${date}`
        });
      }
    });

    // 3. Initial Timeline Render & Store Subscription
    this.renderScheduleTimeline();
    store.subscribe('change', () => {
      this.renderScheduleTimeline();
    });
  }

  renderScheduleTimeline() {
    const container = document.getElementById('schedule-timeline-container');
    if (!container) return;

    const history = store.get().historyLogs || [];
    
    // If no custom history logged yet, use the initial high-value sample sessions
    const sessionsToShow = history.length > 0 ? history.slice(0, 4) : [
      {
        id: 'sess-sample-1',
        time: '11:00 AM',
        durationMinutes: 45,
        tag: '#FinancialLiteracy',
        taskName: 'Portfolio Allocation & Risk Models',
        colorClass: 'dot-cyan'
      },
      {
        id: 'sess-sample-2',
        time: '01:30 PM',
        durationMinutes: 50,
        tag: '#Coding',
        taskName: 'Architecting Supabase Realtime',
        colorClass: 'dot-emerald'
      },
      {
        id: 'sess-sample-3',
        time: '03:45 PM',
        durationMinutes: 30,
        tag: '#Design',
        taskName: 'Soft Pastel UI System & Components',
        colorClass: ''
      }
    ];

    container.innerHTML = sessionsToShow.map((item, idx) => {
      const timeStr = item.time || (item.date ? new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '10:00 AM');
      const mins = item.durationMinutes || (item.durationSeconds ? Math.round(item.durationSeconds / 60) : 30);
      const dotColor = item.colorClass || (idx % 3 === 0 ? 'dot-cyan' : (idx % 3 === 1 ? 'dot-emerald' : ''));

      return `
        <div class="timeline-item">
          <div class="timeline-track-col">
            <div class="timeline-dot ${dotColor}"></div>
            ${idx < sessionsToShow.length - 1 ? '<div class="timeline-line"></div>' : ''}
          </div>
          <div class="timeline-content-card">
            <div class="timeline-meta-row">
              <span class="timeline-time-badge">${timeStr}</span>
              <span class="timeline-duration-badge">${mins}m</span>
            </div>
            <div class="timeline-task-title">
              <span class="timeline-tag-pill">${item.tag || '#Focus'}</span>
              <span>${item.taskName || 'Deep Work Session'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

// Instantiate and start on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  const app = new FlowStateApp();
  app.init();
});
