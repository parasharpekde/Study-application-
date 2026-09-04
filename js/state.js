// ==========================================================================
// FlowState - Central State Management & Local Storage Store
// ==========================================================================

const STORAGE_KEY = 'flowstate_app_data_v1';

// Squad data defaults to empty for private personal space
const DEFAULT_SQUAD_MEMBERS = [];
const DEFAULT_FEED_ACTIVITIES = [];
const DEFAULT_CHALLENGES = [];

const DEFAULT_RECENT_SESSIONS = [
  {
    id: 'sess-1',
    date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    taskName: 'Architecting Supabase Realtime Schema',
    tag: '#Coding',
    durationSeconds: 3000, // 50m
    notes: 'Designed tables, RLS policies, and publication events',
    rating: 5
  },
  {
    id: 'sess-2',
    date: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    taskName: 'Synthesizing Web Audio Binaural Beats',
    tag: '#Coding',
    durationSeconds: 2700, // 45m
    notes: 'Integrated StereoPannerNode for 40Hz Gamma wave focus',
    rating: 5
  },
  {
    id: 'sess-3',
    date: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
    taskName: 'Read Clean Architecture Chapter 8',
    tag: '#Reading',
    durationSeconds: 1800, // 30m
    notes: 'Took notes on dependency inversion and boundaries',
    rating: 4
  },
  {
    id: 'sess-4',
    date: new Date(Date.now() - 74 * 3600 * 1000).toISOString(),
    taskName: 'Discrete Mathematics Graph Theory',
    tag: '#Math',
    durationSeconds: 3600, // 1h
    notes: 'Solved Eulerian path and Hamiltonian cycle problems',
    rating: 5
  }
];

class StateManager {
  constructor() {
    this.listeners = new Map();
    this.state = this.loadState();
  }

  loadState() {
    let state = null;
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        state = JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Could not read from localStorage', e);
    }

    const defaultSupabaseConfig = {
      url: 'https://ntybhertbxnibbrgncuj.supabase.co',
      anonKey: 'sb_publishable_NavP4oysvqn0fng1venY8Q_SUQhSxd5',
      connected: true
    };

    if (state) {
      // Migrate any state that might be missing the supabaseConfig key or credentials
      if (!state.supabaseConfig || !state.supabaseConfig.url || !state.supabaseConfig.anonKey) {
        state.supabaseConfig = defaultSupabaseConfig;
      }
      // Purge any legacy mock squad data so user always starts in personal space
      if (!state.currentSquad || !state.currentSquad.isJoined || state.currentSquad.code === 'FLOW-7749') {
        state.currentSquad = {
          id: null,
          code: null,
          name: 'Personal Space',
          icon: '🧘',
          isJoined: false,
          members: [],
          feed: [],
          challenges: []
        };
      }
      if (state.currentUser && (state.currentUser.name === 'You (FlowMaster)' || state.currentUser.name === 'Tommy')) {
        state.currentUser.name = 'FocusMaster';
      }
      return state;
    }

    // Default initial state
    return {
      currentUser: {
        id: 'me-active',
        name: 'FocusMaster',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80',
        dailyGoalSeconds: 18000, // 5h default
        todayFocusSeconds: 8280, // 2.3h
        totalFocusSeconds: 154800, // 43h
        streakDays: 7,
        currentTask: 'Deep Work Session',
        currentTag: '#Coding'
      },
      currentSquad: {
        id: null,
        code: null,
        name: 'Personal Space',
        icon: '🧘',
        isJoined: false,
        members: [],
        feed: [],
        challenges: []
      },
      timerSettings: {
        workDuration: 25 * 60,
        shortBreakDuration: 5 * 60,
        longBreakDuration: 15 * 60,
        longBreakInterval: 4,
        autoStartBreaks: false,
        soundVolume: 0.7,
        soundMuted: false,
        activePreset: 'brown' // 'brown', 'pink', 'binaural_gamma', 'binaural_beta', 'rain', 'lofi'
      },
      historyLogs: DEFAULT_RECENT_SESSIONS,
      supabaseConfig: defaultSupabaseConfig
    };
  }

  saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('Could not write to localStorage', e);
    }
  }

  get() {
    return this.state;
  }

  set(updater) {
    if (typeof updater === 'function') {
      this.state = updater(this.state);
    } else {
      this.state = { ...this.state, ...updater };
    }
    this.saveState();
    this.emit('change', this.state);
  }

  subscribe(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in listener for event ${event}:`, err);
        }
      }
    }
  }

  // Helper methods
  addSessionLog(session) {
    this.state.historyLogs.unshift(session);
    this.state.currentUser.todayFocusSeconds += session.durationSeconds;
    this.state.currentUser.totalFocusSeconds += session.durationSeconds;

    // Add to recentSessions for personal activity
    if (!this.state.recentSessions) this.state.recentSessions = [];
    this.state.recentSessions.unshift(session);

    // If currently joined in a squad, add to squad feed as well
    if (this.state.currentSquad && this.state.currentSquad.isJoined) {
      if (!this.state.currentSquad.feed) this.state.currentSquad.feed = [];
      const feedItem = {
        id: 'act-' + Date.now(),
        userName: this.state.currentUser.name,
        userAvatar: this.state.currentUser.avatar,
        taskName: session.completedWork || session.taskName,
        tag: session.tag,
        durationMinutes: Math.max(1, Math.round(session.durationSeconds / 60)),
        timestamp: Date.now(),
        reactions: { '🔥': 1 }
      };
      this.state.currentSquad.feed.unshift(feedItem);

      // Update challenge progress if any
      if (this.state.currentSquad.challenges) {
        for (const ch of this.state.currentSquad.challenges) {
          ch.currentSeconds = Math.min(ch.targetSeconds, (ch.currentSeconds || 0) + session.durationSeconds);
        }
      }
    }

    this.saveState();
    this.emit('session_logged', session);
    this.emit('change', this.state);
  }

  addFeedReaction(activityId, emoji) {
    const act = this.state.currentSquad.feed.find(f => f.id === activityId);
    if (act) {
      if (!act.reactions) act.reactions = {};
      act.reactions[emoji] = (act.reactions[emoji] || 0) + 1;
      this.saveState();
      this.emit('feed_updated', this.state.currentSquad.feed);
      this.emit('change', this.state);
    }
  }
}

export const store = new StateManager();
