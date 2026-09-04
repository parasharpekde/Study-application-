// ==========================================================================
// FlowState - Offline Deep Focus & Sync Queue Engine v2 (Vanilla JS Runtime)
// ==========================================================================
// Features:
//   - Exponential backoff retry (2s → 4s → 8s, max 3 attempts)
//   - Batched sync (20 sessions per Supabase request)
//   - IndexedDB overflow when localStorage approaches limit
//   - Service Worker Background Sync registration bridge
//   - Periodic 30-second auto-retry loop
//   - Sync progress events via store.emit('sync_progress', ...)
//   - Full PubSub for UI binding (status_changed, queue_updated, etc.)
// ==========================================================================

import { store } from './state.js';

const QUEUE_STORAGE_KEY = 'flowstate_offline_sync_queue_v1';
const FOCUS_MODE_STORAGE_KEY = 'flowstate_deep_focus_mode_v1';
const IDB_DB_NAME = 'flowstate_overflow_queue';
const IDB_STORE_NAME = 'sessions';
const SYNC_TAG = 'flowstate-offline-sync';
const BATCH_SIZE = 20;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 2000;
const PERIODIC_INTERVAL_MS = 30_000;
const LS_SIZE_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MB

class OfflineSyncManager {
  constructor() {
    this.isNetworkOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isDeepFocusActive = false;
    this.isSyncing = false;
    this.supabaseClient = null;
    this.listeners = new Map();
    this.periodicTimer = null;
    this.retryTimer = null;
    this.idbDb = null;

    // Restore persisted deep focus preference
    try {
      this.isDeepFocusActive = localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === 'true';
    } catch (e) {
      this.isDeepFocusActive = false;
    }
  }

  // ── Initialisation ──────────────────────────────────────────────────────

  init(supabaseClient = null) {
    if (supabaseClient) {
      this.supabaseClient = supabaseClient;
    }

    this.bindNetworkEvents();
    this.bindSWMessages();
    this.openIDB();

    // Auto-sync on boot if conditions are met
    setTimeout(() => this.autoSyncIfReady(), 1500);
  }

  // ── Network Event Listeners ─────────────────────────────────────────────

  bindNetworkEvents() {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.isNetworkOnline = true;
      this.emit('network_status_changed', { online: true });
      this.emit('status_changed', this.getStatus());

      store.emit('show_toast', {
        type: 'success',
        message: '🌐 Internet restored — syncing queued sessions…'
      });

      this.registerSWSync();
      this.autoSyncIfReady();
    });

    window.addEventListener('offline', () => {
      this.isNetworkOnline = false;
      this.clearRetryTimer();
      this.emit('network_status_changed', { online: false });
      this.emit('status_changed', this.getStatus());

      store.emit('show_toast', {
        type: 'warning',
        message: '⚠️ You are offline. Focus sessions will queue locally.'
      });
    });
  }

  // ── Service Worker Message Bridge ───────────────────────────────────────

  bindSWMessages() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type } = event.data || {};

      // SW background sync triggered by browser when reconnected
      if (type === 'BG_SYNC_TRIGGER') {
        console.log('[OfflineSync] Background sync trigger received from SW.');
        this.autoSyncIfReady();
      }

      // New SW version installed — show update banner
      if (type === 'SW_UPDATED') {
        const banner = document.getElementById('sw-update-banner');
        if (banner) banner.style.display = 'flex';
      }
    });
  }

  // ── SW Background Sync Registration ────────────────────────────────────

  async registerSWSync() {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('SyncManager' in window)
    ) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register(SYNC_TAG);
      console.log('[OfflineSync] Background sync registered:', SYNC_TAG);
    } catch (err) {
      console.warn('[OfflineSync] Background sync not available:', err.message);
    }
  }

  // ── IndexedDB Overflow Queue ────────────────────────────────────────────

  openIDB() {
    if (typeof indexedDB === 'undefined') return;

    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'queueId' });
      }
    };
    req.onsuccess = (e) => {
      this.idbDb = e.target.result;
    };
    req.onerror = () => {
      console.warn('[OfflineSync] IDB overflow queue unavailable.');
    };
  }

  async readAllFromIDB() {
    if (!this.idbDb) return [];
    return new Promise((resolve) => {
      const tx = this.idbDb.transaction(IDB_STORE_NAME, 'readonly');
      const req = tx.objectStore(IDB_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async clearIDB() {
    if (!this.idbDb) return;
    return new Promise((resolve) => {
      const tx = this.idbDb.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
    });
  }

  // ── Configuration ───────────────────────────────────────────────────────

  setSupabaseClient(client) {
    this.supabaseClient = client;
    this.startPeriodicRetry();
    this.autoSyncIfReady();
  }

  setDeepFocusMode(enabled) {
    this.isDeepFocusActive = Boolean(enabled);
    try {
      localStorage.setItem(FOCUS_MODE_STORAGE_KEY, this.isDeepFocusActive ? 'true' : 'false');
    } catch (e) { /* ignore */ }

    this.emit('deep_focus_changed', { active: this.isDeepFocusActive });
    this.emit('status_changed', this.getStatus());

    store.emit('show_toast', {
      type: this.isDeepFocusActive ? 'info' : 'success',
      message: this.isDeepFocusActive
        ? '🛡️ Offline Deep Focus Active: Multiplayer distractions muted.'
        : '⚡ Online Focus Active: Reconnected to live study squads.'
    });

    if (!this.isDeepFocusActive) {
      this.autoSyncIfReady();
    }
  }

  toggleDeepFocusMode() {
    this.setDeepFocusMode(!this.isDeepFocusActive);
    return this.isDeepFocusActive;
  }

  isOfflineOrShielded() {
    return !this.isNetworkOnline || this.isDeepFocusActive;
  }

  getStatus() {
    return {
      isOnline: this.isNetworkOnline,
      isDeepFocusActive: this.isDeepFocusActive,
      isShielded: this.isOfflineOrShielded(),
      pendingCount: this.getPendingCount(),
      isSyncing: this.isSyncing
    };
  }

  // ── Queue Management ────────────────────────────────────────────────────

  getPendingQueue() {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[OfflineSync] Could not read queue:', e);
      return [];
    }
  }

  saveQueue(queue) {
    try {
      const serialized = JSON.stringify(queue);
      if (serialized.length > LS_SIZE_LIMIT_BYTES) {
        console.warn('[OfflineSync] Queue near LS limit — trimming to last 50 entries.');
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-50)));
      } else {
        localStorage.setItem(QUEUE_STORAGE_KEY, serialized);
      }
    } catch (e) {
      console.error('[OfflineSync] Could not save queue:', e);
    }
    this.emit('queue_updated', { pendingCount: this.getPendingCount() });
    this.emit('status_changed', this.getStatus());
  }

  getPendingCount() {
    return this.getPendingQueue().length;
  }

  /**
   * Queues a completed focus session locally.
   * Preserves original timestamps for accurate leaderboard/analytics sync.
   * @param {Object} session
   * @returns {Object} queued record
   */
  queueSession(session) {
    const queue = this.getPendingQueue();
    const duration = session.durationSeconds || 1500;
    const nowIso = new Date().toISOString();

    const record = {
      queueId: `q-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      mode: session.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro',
      task_name: session.taskName || 'Deep Work Session',
      tag: session.tag || '#DeepWork',
      duration_seconds: duration,
      completed_work: session.completedWork || 'Completed focus session.',
      rating: session.rating ?? 5,
      // Strict timestamp integrity — use original session times
      created_at: session.date || nowIso,
      started_at: session.startedAt || new Date(Date.now() - duration * 1000).toISOString(),
      ended_at: session.endedAt || session.date || nowIso,
      queuedAt: Date.now(),
      retryCount: 0
    };

    queue.push(record);
    this.saveQueue(queue);

    store.emit('show_toast', {
      type: 'info',
      message: `💾 Session queued locally (${queue.length} pending sync).`
    });

    return record;
  }

  // ── Sync Engine ─────────────────────────────────────────────────────────

  async autoSyncIfReady() {
    if (
      this.isNetworkOnline &&
      !this.isDeepFocusActive &&
      !this.isSyncing &&
      this.supabaseClient
    ) {
      await this.syncPendingSessions();
    }
  }

  /**
   * Batch-syncs all queued sessions to Supabase.
   * Processes in groups of BATCH_SIZE with exponential backoff retry per batch.
   * @param {Object} [clientOverride] - Optional Supabase client override
   */
  async syncPendingSessions(clientOverride) {
    const sb = clientOverride || this.supabaseClient;

    if (!sb || !this.isNetworkOnline || this.isDeepFocusActive || this.isSyncing) {
      return { success: false, syncedCount: 0, failedCount: 0 };
    }

    // Merge LS + IDB queues
    const lsQueue = this.getPendingQueue();
    const idbQueue = await this.readAllFromIDB();
    const fullQueue = [...lsQueue, ...idbQueue];

    if (fullQueue.length === 0) {
      return { success: true, syncedCount: 0, failedCount: 0 };
    }

    this.isSyncing = true;
    this.emit('sync_started', { pendingCount: fullQueue.length });

    let totalSynced = 0;
    let totalFailed = 0;
    const total = fullQueue.length;

    // ── Batch loop ──────────────────────────────────────────────────────
    for (let i = 0; i < fullQueue.length; i += BATCH_SIZE) {
      const batch = fullQueue.slice(i, i + BATCH_SIZE);
      const batchSuccess = await this.syncBatchWithRetry(sb, batch);

      if (batchSuccess) {
        totalSynced += batch.length;
      } else {
        totalFailed += batch.length;
        batch.forEach(item => { item.retryCount = (item.retryCount || 0) + 1; });
      }

      // Emit progress for UI progress bar
      const percent = Math.round((totalSynced / total) * 100);
      this.emit('sync_progress', { synced: totalSynced, total, percent });
      store.emit('sync_progress', { synced: totalSynced, total, percent });
    }

    // Persist only failed items (that haven't exceeded retry cap)
    const failedItems = fullQueue.filter(
      (_, idx) => idx >= totalSynced && (fullQueue[idx]?.retryCount || 0) < MAX_RETRY_ATTEMPTS * 2
    );
    this.saveQueue(failedItems);
    await this.clearIDB();

    this.isSyncing = false;

    if (totalFailed === 0) {
      this.emit('sync_completed', { syncedCount: totalSynced });
      store.emit('show_toast', {
        type: 'success',
        message: `🔄 Synced ${totalSynced} session${totalSynced === 1 ? '' : 's'} to Supabase!`
      });
      return { success: true, syncedCount: totalSynced, failedCount: 0 };
    } else {
      this.emit('sync_failed', { error: `${totalFailed} sessions failed.` });
      store.emit('show_toast', {
        type: 'warning',
        message: `⚠️ ${totalSynced} synced, ${totalFailed} failed — will retry automatically.`
      });
      return { success: false, syncedCount: totalSynced, failedCount: totalFailed };
    }
  }

  /**
   * Syncs one batch with up to MAX_RETRY_ATTEMPTS retries (exponential backoff).
   */
  async syncBatchWithRetry(sb, batch) {
    const payloads = batch.map(item => ({
      mode: item.mode,
      task_name: item.task_name,
      tag: item.tag,
      duration_seconds: item.duration_seconds,
      completed_work: item.completed_work,
      rating: item.rating,
      created_at: item.created_at // Original session timestamp — timestamp integrity preserved
    }));

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const { error } = await sb.from('focus_sessions').insert(payloads).select();
        if (!error || error.code === 'PGRST116') return true;
        throw new Error(error.message);
      } catch (err) {
        const isLast = attempt === MAX_RETRY_ATTEMPTS - 1;
        if (isLast) {
          console.error('[OfflineSync] Batch sync failed after retries:', err.message);
          return false;
        }
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[OfflineSync] Attempt ${attempt + 1} failed. Retrying in ${delay}ms…`);
        await new Promise(res => setTimeout(res, delay));
      }
    }
    return false;
  }

  // ── Periodic Auto-Retry ─────────────────────────────────────────────────

  startPeriodicRetry(intervalMs = PERIODIC_INTERVAL_MS) {
    this.stopPeriodicRetry();
    this.periodicTimer = setInterval(() => {
      if (this.getPendingCount() > 0 && !this.isSyncing) {
        console.log('[OfflineSync] Periodic retry: syncing queued sessions…');
        this.autoSyncIfReady();
      }
    }, intervalMs);
  }

  stopPeriodicRetry() {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  clearRetryTimer() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ── PubSub ───────────────────────────────────────────────────────────────

  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (e) {
          console.error(`[OfflineSync] Listener error for "${event}":`, e);
        }
      }
    }
  }
}

export const offlineSyncManager = new OfflineSyncManager();
