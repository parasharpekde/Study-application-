/**
 * ==============================================================================
 * FlowState - Offline Deep Focus & Sync Queue Engine — TypeScript Module v2
 * ==============================================================================
 *
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  OfflineSyncManagerTS                                           │
 * │                                                                 │
 * │  Queue Layer: localStorage (primary) + IndexedDB (overflow)     │
 * │  Sync Layer:  Supabase REST (batched, 20 sessions / request)    │
 * │  Retry Layer: Exponential backoff (2s → 4s → 8s, max 3 tries)  │
 * │  BG Sync:     navigator.serviceWorker sync.register()           │
 * │  Periodic:    setInterval auto-retry every 30s when online      │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * INTEGRATION:
 *   import { offlineSyncManagerTS } from './offlineSyncManager';
 *
 *   // 1. Attach Supabase client once connected:
 *   offlineSyncManagerTS.setSupabaseClient(supabaseClient);
 *
 *   // 2. Queue a session (called when offline / shielded):
 *   offlineSyncManagerTS.queueSession({ mode, taskName, tag, ... });
 *
 *   // 3. Trigger manual sync:
 *   await offlineSyncManagerTS.syncPendingSessions();
 *
 *   // 4. React to status changes:
 *   offlineSyncManagerTS.subscribe('status_changed', (status) => { ... });
 *   offlineSyncManagerTS.subscribe('sync_progress', ({ synced, total }) => { ... });
 *   offlineSyncManagerTS.subscribe('sync_completed', ({ syncedCount }) => { ... });
 * ==============================================================================
 */

// ── Type Definitions ──────────────────────────────────────────────────────

export interface FocusSessionPayload {
  mode: 'pomodoro' | 'stopwatch';
  taskName: string;
  tag: string;
  durationSeconds: number;
  completedWork?: string;
  rating?: number;
  date?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface QueuedSession {
  queueId: string;
  mode: 'pomodoro' | 'stopwatch';
  task_name: string;
  tag: string;
  duration_seconds: number;
  completed_work: string;
  rating: number;
  created_at: string;
  started_at: string;
  ended_at: string;
  queuedAt: number;
  retryCount: number;
}

export interface OfflineStatus {
  isOnline: boolean;
  isDeepFocusActive: boolean;
  isShielded: boolean;
  pendingCount: number;
  isSyncing: boolean;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  error?: string;
}

export interface SyncProgressEvent {
  synced: number;
  total: number;
  percent: number;
}

export interface SupabaseClientLike {
  from(table: string): {
    insert(rows: Record<string, unknown>[]): {
      select(): Promise<{ data: unknown; error: { code: string; message: string } | null }>;
    };
  };
}

type EventMap = {
  status_changed: OfflineStatus;
  network_status_changed: { online: boolean };
  deep_focus_changed: { active: boolean };
  queue_updated: { pendingCount: number };
  sync_started: { pendingCount: number };
  sync_progress: SyncProgressEvent;
  sync_completed: { syncedCount: number };
  sync_failed: { error: string; retryIn?: number };
  sw_update_available: Record<string, never>;
};

// ── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'flowstate_offline_sync_queue_v1';
const FOCUS_MODE_KEY = 'flowstate_deep_focus_mode_v1';
const IDB_DB_NAME = 'flowstate_overflow_queue';
const IDB_STORE_NAME = 'sessions';
const SYNC_TAG = 'flowstate-offline-sync';
const BATCH_SIZE = 20;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 2000;
const PERIODIC_RETRY_INTERVAL_MS = 30_000;
const LS_SIZE_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MB safety threshold

// ── Main Class ────────────────────────────────────────────────────────────

export class OfflineSyncManagerTS {
  private isNetworkOnline: boolean;
  private isDeepFocusActive: boolean;
  private isSyncing = false;
  private supabaseClient: SupabaseClientLike | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Map<string, Set<(data: unknown) => void>>();
  private idbDb: IDBDatabase | null = null;

  constructor() {
    this.isNetworkOnline =
      typeof navigator !== 'undefined' ? navigator.onLine : true;
    this.isDeepFocusActive = false;

    try {
      this.isDeepFocusActive =
        localStorage.getItem(FOCUS_MODE_KEY) === 'true';
    } catch {
      this.isDeepFocusActive = false;
    }

    this.bindNetworkEvents();
    this.bindSWMessages();
    this.openIDB();
  }

  // ── Network Event Binding ───────────────────────────────────────────────

  private bindNetworkEvents(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      this.isNetworkOnline = true;
      this.emit('network_status_changed', { online: true });
      this.emit('status_changed', this.getStatus());
      this.registerSWSync();
      this.autoSyncIfReady();
    });

    window.addEventListener('offline', () => {
      this.isNetworkOnline = false;
      this.clearRetryTimer();
      this.emit('network_status_changed', { online: false });
      this.emit('status_changed', this.getStatus());
    });
  }

  // ── Service Worker Message Bridge ───────────────────────────────────────

  private bindSWMessages(): void {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type } = event.data || {};

      // Background sync triggered by the SW when browser reconnects
      if (type === 'BG_SYNC_TRIGGER') {
        console.log('[OfflineSyncTS] Background sync triggered by SW.');
        this.autoSyncIfReady();
      }

      // SW updated — notify UI to show update banner
      if (type === 'SW_UPDATED') {
        console.log('[OfflineSyncTS] SW updated to version:', event.data.version);
        this.emit('sw_update_available', {});
      }
    });
  }

  // ── SW Background Sync Registration ────────────────────────────────────

  private async registerSWSync(): Promise<void> {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('SyncManager' in window)
    ) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      // @ts-ignore — BackgroundSyncManager not in all TS lib.dom yet
      await registration.sync.register(SYNC_TAG);
      console.log('[OfflineSyncTS] Background sync registered:', SYNC_TAG);
    } catch (err) {
      console.warn('[OfflineSyncTS] Background sync registration unavailable:', err);
    }
  }

  // ── IndexedDB Overflow Queue ────────────────────────────────────────────

  private openIDB(): void {
    if (typeof indexedDB === 'undefined') return;

    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: 'queueId' });
      }
    };
    req.onsuccess = (e) => {
      this.idbDb = (e.target as IDBOpenDBRequest).result;
    };
    req.onerror = () => {
      console.warn('[OfflineSyncTS] IndexedDB overflow queue unavailable.');
    };
  }

  private async writeToIDB(session: QueuedSession): Promise<void> {
    if (!this.idbDb) return;
    return new Promise((resolve, reject) => {
      const tx = this.idbDb!.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.add(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private async readAllFromIDB(): Promise<QueuedSession[]> {
    if (!this.idbDb) return [];
    return new Promise((resolve) => {
      const tx = this.idbDb!.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  private async clearIDB(): Promise<void> {
    if (!this.idbDb) return;
    return new Promise((resolve) => {
      const tx = this.idbDb!.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
    });
  }

  // ── Public API: Configuration ───────────────────────────────────────────

  public setSupabaseClient(client: SupabaseClientLike): void {
    this.supabaseClient = client;
    this.startPeriodicRetry();
    this.autoSyncIfReady();
  }

  public setDeepFocusMode(enabled: boolean): void {
    this.isDeepFocusActive = enabled;
    try {
      localStorage.setItem(FOCUS_MODE_KEY, enabled ? 'true' : 'false');
    } catch { /* ignore */ }

    this.emit('deep_focus_changed', { active: enabled });
    this.emit('status_changed', this.getStatus());

    if (!enabled) {
      this.autoSyncIfReady();
    }
  }

  public toggleDeepFocusMode(): boolean {
    this.setDeepFocusMode(!this.isDeepFocusActive);
    return this.isDeepFocusActive;
  }

  public isOfflineOrShielded(): boolean {
    return !this.isNetworkOnline || this.isDeepFocusActive;
  }

  public getStatus(): OfflineStatus {
    return {
      isOnline: this.isNetworkOnline,
      isDeepFocusActive: this.isDeepFocusActive,
      isShielded: this.isOfflineOrShielded(),
      pendingCount: this.getPendingCount(),
      isSyncing: this.isSyncing,
    };
  }

  // ── Queue Management ────────────────────────────────────────────────────

  public getPendingQueue(): QueuedSession[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as QueuedSession[]) : [];
    } catch {
      return [];
    }
  }

  private saveQueue(queue: QueuedSession[]): void {
    try {
      const serialized = JSON.stringify(queue);
      // If approaching LocalStorage size limit, write overflow to IndexedDB
      if (serialized.length > LS_SIZE_LIMIT_BYTES) {
        console.warn('[OfflineSyncTS] Queue approaching LS limit, overflowing to IDB.');
        // Keep last 50 in LS, move rest to IDB (handled at sync time)
        const trimmed = queue.slice(-50);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } else {
        localStorage.setItem(STORAGE_KEY, serialized);
      }
    } catch (e) {
      console.error('[OfflineSyncTS] Could not persist queue to localStorage:', e);
    }
    this.emit('queue_updated', { pendingCount: this.getPendingCount() });
    this.emit('status_changed', this.getStatus());
  }

  public getPendingCount(): number {
    return this.getPendingQueue().length;
  }

  public queueSession(session: FocusSessionPayload): QueuedSession {
    const queue = this.getPendingQueue();
    const duration = session.durationSeconds || 1500;
    const nowIso = new Date().toISOString();

    const record: QueuedSession = {
      queueId: `q-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      mode: session.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro',
      task_name: session.taskName || 'Deep Work Session',
      tag: session.tag || '#DeepWork',
      duration_seconds: duration,
      completed_work: session.completedWork || 'Completed focus session.',
      rating: session.rating ?? 5,
      // Preserve original timestamps for leaderboard / analytics integrity
      created_at: session.date || nowIso,
      started_at:
        session.startedAt ||
        new Date(Date.now() - duration * 1000).toISOString(),
      ended_at: session.endedAt || session.date || nowIso,
      queuedAt: Date.now(),
      retryCount: 0,
    };

    queue.push(record);
    this.saveQueue(queue);
    return record;
  }

  // ── Sync Logic ──────────────────────────────────────────────────────────

  public async autoSyncIfReady(): Promise<void> {
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
   * Main sync method with exponential backoff retry.
   * Syncs in batches of BATCH_SIZE (20) to respect Supabase payload limits.
   */
  public async syncPendingSessions(
    client?: SupabaseClientLike
  ): Promise<SyncResult> {
    const sb = client || this.supabaseClient;
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

    // ── Batch loop ────────────────────────────────────────────────────────
    for (let batchStart = 0; batchStart < fullQueue.length; batchStart += BATCH_SIZE) {
      const batch = fullQueue.slice(batchStart, batchStart + BATCH_SIZE);

      const success = await this.syncBatchWithRetry(sb, batch);

      if (success) {
        totalSynced += batch.length;
      } else {
        totalFailed += batch.length;
        // Re-queue failed items with incremented retry count
        batch.forEach((item) => {
          item.retryCount = (item.retryCount || 0) + 1;
        });
      }

      const total = fullQueue.length;
      const percent = Math.round((totalSynced / total) * 100);
      this.emit('sync_progress', { synced: totalSynced, total, percent });
    }

    // Clear both queues on full success, partial clear on partial success
    const failedItems = fullQueue.filter(
      (_, i) => i >= totalSynced && i < totalSynced + totalFailed
    );

    this.saveQueue(failedItems.filter((i) => i.retryCount < MAX_RETRY_ATTEMPTS * 2));
    await this.clearIDB();

    this.isSyncing = false;

    if (totalFailed === 0) {
      this.emit('sync_completed', { syncedCount: totalSynced });
      return { success: true, syncedCount: totalSynced, failedCount: 0 };
    } else {
      this.emit('sync_failed', { error: `${totalFailed} sessions failed to sync.` });
      return { success: false, syncedCount: totalSynced, failedCount: totalFailed };
    }
  }

  /**
   * Syncs a single batch with up to MAX_RETRY_ATTEMPTS retries
   * using exponential backoff (2s → 4s → 8s).
   */
  private async syncBatchWithRetry(
    sb: SupabaseClientLike,
    batch: QueuedSession[]
  ): Promise<boolean> {
    const payloads = batch.map((item) => ({
      mode: item.mode,
      task_name: item.task_name,
      tag: item.tag,
      duration_seconds: item.duration_seconds,
      completed_work: item.completed_work,
      rating: item.rating,
      created_at: item.created_at, // Original session timestamp preserved
    }));

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const { error } = await sb.from('focus_sessions').insert(payloads).select();

        if (!error) return true;

        // PGRST116 = empty table (not an error)
        if (error.code === 'PGRST116') return true;

        throw new Error(error.message);
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRY_ATTEMPTS - 1;
        if (isLastAttempt) {
          console.error('[OfflineSyncTS] Batch sync failed after retries:', err);
          return false;
        }

        // Exponential backoff: 2s, 4s, 8s
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `[OfflineSyncTS] Sync attempt ${attempt + 1} failed. Retrying in ${delay}ms…`
        );
        this.emit('sync_failed', { error: String(err), retryIn: delay });
        await sleep(delay);
      }
    }
    return false;
  }

  // ── Periodic Auto-Retry ─────────────────────────────────────────────────

  public startPeriodicRetry(intervalMs = PERIODIC_RETRY_INTERVAL_MS): void {
    this.stopPeriodicRetry();
    this.periodicTimer = setInterval(() => {
      if (this.getPendingCount() > 0) {
        console.log('[OfflineSyncTS] Periodic retry: attempting queued session sync…');
        this.autoSyncIfReady();
      }
    }, intervalMs);
    console.log(`[OfflineSyncTS] Periodic retry started (every ${intervalMs / 1000}s).`);
  }

  public stopPeriodicRetry(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ── PubSub ───────────────────────────────────────────────────────────────

  public subscribe<K extends keyof EventMap>(
    event: K,
    callback: (data: EventMap[K]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const cb = callback as (data: unknown) => void;
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  private emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (e) {
        console.error(`[OfflineSyncTS] Error in listener for "${event}":`, e);
      }
    });
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  public destroy(): void {
    this.stopPeriodicRetry();
    this.clearRetryTimer();
    this.listeners.clear();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Singleton Export ─────────────────────────────────────────────────────

export const offlineSyncManagerTS = new OfflineSyncManagerTS();
