// ==========================================================================
// FlowState - Supabase Realtime & Cloud Sync Client
// ==========================================================================

import { store } from './state.js';
import { offlineSyncManager } from './offline-sync-manager.js';

class SupabaseSyncEngine {
  constructor() {
    this.client = null;
    this.channel = null;
    this.isConnected = false;
  }

  init() {
    this.bindDOM();
    offlineSyncManager.init();

    const config = store.get().supabaseConfig;
    const navBtn = document.getElementById('btn-open-cloud-sync');
    if (config && config.url && config.anonKey) {
      // Hide cloud button immediately to prevent flash if connected
      if (navBtn) navBtn.style.display = 'none';
      this.connect(config.url, config.anonKey, false);
    }

    // Automatically sync newly logged sessions to Supabase or offline queue
    store.subscribe('session_logged', async (session) => {
      if (offlineSyncManager.isOfflineOrShielded() || !this.isConnected || !this.client) {
        offlineSyncManager.queueSession(session);
      } else {
        await this.syncSessionToSupabase(session);
      }
    });
  }

  bindDOM() {
    // Open Cloud Sync modal from top navigation button
    document.getElementById('btn-open-cloud-sync')?.addEventListener('click', () => {
      this.openModal();
    });

    document.getElementById('btn-close-supabase-modal')?.addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('btn-test-supabase')?.addEventListener('click', () => {
      const url = document.getElementById('input-supabase-url')?.value.trim();
      const key = document.getElementById('input-supabase-key')?.value.trim();
      if (url && key) {
        this.connect(url, key, true);
      } else {
        store.emit('show_toast', {
          type: 'warning',
          message: '⚠️ Please provide both Supabase URL and Anon Public Key.'
        });
      }
    });

    document.getElementById('btn-disconnect-supabase')?.addEventListener('click', () => {
      this.disconnect();
    });
  }

  openModal() {
    const config = store.get().supabaseConfig;
    const urlInput = document.getElementById('input-supabase-url');
    const keyInput = document.getElementById('input-supabase-key');

    if (urlInput) urlInput.value = config.url || '';
    if (keyInput) keyInput.value = config.anonKey || '';

    this.updateStatusBadge();
    document.getElementById('supabase-sync-modal')?.classList.add('active');
  }

  closeModal() {
    document.getElementById('supabase-sync-modal')?.classList.remove('active');
  }

  async connect(supabaseUrl, supabaseAnonKey, showToast = true) {
    try {
      if (showToast) {
        store.emit('show_toast', { type: 'info', message: '🔄 Connecting to Supabase...' });
      }

      // Dynamically import Supabase client from ESM
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const testClient = createClient(supabaseUrl, supabaseAnonKey);

      // Verify connection by attempting to read from focus_sessions
      // PGRST116 = no rows (empty table, still a valid connection)
      // Any other error likely means bad credentials or wrong URL
      const { data, error } = await testClient.from('focus_sessions').select('id').limit(1);

      if (error && error.code !== 'PGRST116') {
        // Bug 7 fix: treat non-PGRST116 errors as a real connection failure
        throw new Error(error.message || 'Connection verification failed.');
      }

      // Only reach here if connection is verified
      this.client = testClient;
      this.isConnected = true;
      offlineSyncManager.setSupabaseClient(this.client);
      store.set(s => ({
        ...s,
        supabaseConfig: {
          url: supabaseUrl,
          anonKey: supabaseAnonKey,
          connected: true
        }
      }));

      this.subscribeRealtime();
      this.updateStatusBadge();

      this.closeModal();

      if (showToast) {
        store.emit('show_toast', {
          type: 'success',
          message: '⚡ Connected to Supabase! Cloud sync active.'
        });
      }
    } catch (err) {
      console.error('Supabase connection error:', err);
      this.isConnected = false;
      this.updateStatusBadge();
      if (showToast) {
        store.emit('show_toast', {
          type: 'warning',
          message: '❌ Could not connect to Supabase. Check your URL and Key.'
        });
      }
    }
  }

  disconnect() {
    if (this.channel && this.client) {
      this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.client = null;
    this.isConnected = false;

    store.set(s => ({
      ...s,
      supabaseConfig: {
        url: '',
        anonKey: '',
        connected: false
      }
    }));

    this.updateStatusBadge();
    store.emit('show_toast', {
      type: 'info',
      message: 'Switched to Local Offline Storage.'
    });
  }

  subscribeRealtime() {
    if (!this.client) return;

    // Listen to focus_sessions and group_reactions real-time broadcasts
    this.channel = this.client
      .channel('flowstate-squad-presence')
      .on('presence', { event: 'sync' }, () => {
        const presenceState = this.channel.presenceState();
        console.log('Realtime Squad Presence synced:', presenceState);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'focus_sessions' }, (payload) => {
        console.log('New remote focus session received:', payload.new);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Supabase Realtime Channel Subscribed!');
        }
      });
  }

  updateStatusBadge() {
    const navBtn = document.getElementById('btn-open-cloud-sync');
    const modalBadge = document.getElementById('supabase-status-indicator');

    if (this.isConnected) {
      // If connected to Supabase, remove/hide the cloud sync button completely
      if (navBtn) {
        navBtn.style.display = 'none';
      }
      if (modalBadge) {
        modalBadge.innerHTML = `<span style="color: var(--accent-emerald);">● Connected (Syncing with Supabase PostgreSQL)</span>`;
      }
    } else {
      if (navBtn) {
        navBtn.style.display = '';
        navBtn.classList.remove('active-glow');
        navBtn.title = 'Storage: Local Fallback (Click to connect Supabase)';
      }
      if (modalBadge) {
        modalBadge.innerHTML = `<span style="color: var(--accent-cyan);">● Local Fallback Mode (Instant & Offline)</span>`;
      }
    }
  }

  async syncSessionToSupabase(session) {
    if (!this.client || offlineSyncManager.isOfflineOrShielded()) {
      offlineSyncManager.queueSession(session);
      return;
    }
    try {
      const currentUser = store.get().currentUser;
      const payload = {
        user_id: currentUser?.isAuthenticated ? currentUser.id : null,
        mode: session.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro',
        task_name: session.taskName || 'Deep Work Session',
        tag: session.tag || '#DeepWork',
        duration_seconds: session.durationSeconds || 1500,
        completed_work: session.completedWork || 'Completed deep work focus session.',
        rating: session.rating || 5,
        created_at: session.date || new Date().toISOString()
      };

      const { data, error } = await this.client
        .from('focus_sessions')
        .insert([payload])
        .select();

      if (error) {
        console.warn('Supabase sync note, queuing session offline:', error.message);
        offlineSyncManager.queueSession(session);
      } else {
        console.log('✅ Focus session successfully synced to Supabase:', data);
        store.emit('show_toast', {
          type: 'success',
          message: '☁️ Synced focus session to Supabase database!'
        });
      }
    } catch (err) {
      console.warn('Failed to push session to Supabase, queuing locally:', err);
      offlineSyncManager.queueSession(session);
    }
  }
}

export const supabaseSync = new SupabaseSyncEngine();
