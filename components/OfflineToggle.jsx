import React, { useState, useEffect, useCallback } from 'react';

/**
 * ==============================================================================
 * FlowState - Offline Deep Focus Mode Toggle (React Component)
 * ==============================================================================
 * Features:
 *  - 1-click toggle for Offline Deep Focus mode
 *  - Visual network status indicator (Online / Offline / Deep Focus)
 *  - Live pending sync queue counter & progress ring
 *  - Manual "Sync Now" trigger with animated spinner
 *  - Distraction silencing indicator (multiplayer paused, leaderboards muted)
 *  - Scoped CSS styling with modern dark glassmorphic aesthetics
 * ==============================================================================
 */

const STORAGE_KEY_QUEUE = 'flowstate_offline_sync_queue_v1';
const STORAGE_KEY_FOCUS = 'flowstate_deep_focus_mode_v1';

export default function OfflineToggle({
  syncManager = null,
  onToggle = null,
  compact = false,
}) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isDeepFocus, setIsDeepFocus] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_FOCUS) === 'true';
    } catch {
      return false;
    }
  });
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ synced: 0, total: 0 });
  const [statusMessage, setStatusMessage] = useState('');

  // Read queue count from localStorage
  const refreshQueueCount = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_QUEUE);
      if (raw) {
        const parsed = JSON.parse(raw);
        setQueueCount(Array.isArray(parsed) ? parsed.length : 0);
      } else {
        setQueueCount(0);
      }
    } catch {
      setQueueCount(0);
    }
  }, []);

  // Network & queue listeners
  useEffect(() => {
    refreshQueueCount();

    const handleOnline = () => {
      setIsOnline(true);
      setStatusMessage('Network restored');
      setTimeout(() => setStatusMessage(''), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setStatusMessage('Network offline');
      setTimeout(() => setStatusMessage(''), 3000);
    };

    const handleStorage = (e) => {
      if (e.key === STORAGE_KEY_QUEUE) {
        refreshQueueCount();
      }
      if (e.key === STORAGE_KEY_FOCUS) {
        setIsDeepFocus(e.newValue === 'true');
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('storage', handleStorage);

    // Subscribe to syncManager if provided
    let unsubFocus = null;
    let unsubQueue = null;
    let unsubSync = null;

    if (syncManager) {
      if (typeof syncManager.subscribe === 'function') {
        unsubFocus = syncManager.subscribe('focus_mode_changed', ({ active }) => {
          setIsDeepFocus(active);
        });
        unsubQueue = syncManager.subscribe('queue_updated', ({ count }) => {
          setQueueCount(count);
        });
        unsubSync = syncManager.subscribe('sync_status', ({ status, synced, total }) => {
          setIsSyncing(status === 'syncing');
          if (synced !== undefined && total !== undefined) {
            setSyncProgress({ synced, total });
          }
        });
      }
    }

    // Interval to refresh queue if changes happen locally
    const interval = setInterval(refreshQueueCount, 3000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleStorage);
      clearInterval(interval);
      if (unsubFocus) unsubFocus();
      if (unsubQueue) unsubQueue();
      if (unsubSync) unsubSync();
    };
  }, [syncManager, refreshQueueCount]);

  // Handle Toggle Switch
  const handleToggle = () => {
    const nextState = !isDeepFocus;
    setIsDeepFocus(nextState);

    try {
      localStorage.setItem(STORAGE_KEY_FOCUS, String(nextState));
    } catch (e) {
      console.warn('[OfflineToggle] LocalStorage write error:', e);
    }

    if (syncManager && typeof syncManager.setDeepFocusMode === 'function') {
      syncManager.setDeepFocusMode(nextState);
    }

    if (onToggle) {
      onToggle(nextState);
    }

    // Dispatch custom event for vanilla JS app components
    window.dispatchEvent(
      new CustomEvent('flowstate:deepfocus', { detail: { active: nextState } })
    );
  };

  // Handle Manual Sync
  const handleSyncNow = async () => {
    if (isSyncing || (!isOnline && !syncManager)) return;

    setIsSyncing(true);
    setStatusMessage('Syncing sessions...');

    try {
      if (syncManager && typeof syncManager.syncPendingSessions === 'function') {
        const result = await syncManager.syncPendingSessions();
        refreshQueueCount();
        setStatusMessage(
          result?.synced ? `Synced ${result.synced} sessions!` : 'All synced!'
        );
      } else {
        // Fallback simulation or trigger custom event
        window.dispatchEvent(new CustomEvent('flowstate:sync_requested'));
        setTimeout(() => {
          refreshQueueCount();
          setStatusMessage('Sync check completed');
        }, 1200);
      }
    } catch (err) {
      setStatusMessage('Sync failed: ' + (err.message || 'Error'));
    } finally {
      setIsSyncing(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  const effectiveOffline = !isOnline || isDeepFocus;

  return (
    <div className={`offline-toggle-root ${compact ? 'compact' : ''} ${effectiveOffline ? 'mode-offline' : 'mode-online'}`}>
      <style>{`
        .offline-toggle-root {
          background: rgba(18, 16, 38, 0.75);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(139, 92, 246, 0.2);
          border-radius: 14px;
          padding: 14px 18px;
          color: #f1f5f9;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          max-width: 100%;
        }
        .offline-toggle-root.mode-offline {
          border-color: rgba(168, 85, 247, 0.45);
          box-shadow: 0 8px 32px rgba(124, 58, 237, 0.15), inset 0 0 20px rgba(139, 92, 246, 0.08);
        }
        .offline-toggle-root.compact {
          padding: 8px 12px;
          border-radius: 10px;
        }
        .ot-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .ot-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .ot-icon-badge {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.2));
          border: 1px solid rgba(139, 92, 246, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          transition: all 0.3s ease;
        }
        .mode-offline .ot-icon-badge {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(236, 72, 153, 0.25));
          border-color: rgba(216, 180, 254, 0.5);
          box-shadow: 0 0 14px rgba(168, 85, 247, 0.4);
        }
        .ot-icon-badge svg {
          width: 20px;
          height: 20px;
          color: #c084fc;
        }
        .mode-offline .ot-icon-badge svg {
          color: #f472b6;
        }
        .ot-titles {
          display: flex;
          flex-direction: column;
        }
        .ot-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ot-title {
          font-size: 0.92rem;
          font-weight: 600;
          letter-spacing: -0.01em;
          color: #f8fafc;
        }
        .ot-badge {
          font-size: 0.65rem;
          padding: 2px 7px;
          border-radius: 999px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .ot-badge.badge-offline {
          background: rgba(236, 72, 153, 0.18);
          color: #f472b6;
          border: 1px solid rgba(236, 72, 153, 0.3);
        }
        .ot-badge.badge-live {
          background: rgba(34, 197, 94, 0.15);
          color: #4ade80;
          border: 1px solid rgba(34, 197, 94, 0.3);
        }
        .ot-subtitle {
          font-size: 0.74rem;
          color: #94a3b8;
          margin-top: 2px;
        }
        .ot-switch {
          position: relative;
          display: inline-block;
          width: 48px;
          height: 26px;
          cursor: pointer;
        }
        .ot-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .ot-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(51, 65, 85, 0.8);
          border: 1px solid rgba(148, 163, 184, 0.2);
          transition: 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          border-radius: 26px;
        }
        .ot-slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 2px;
          bottom: 2px;
          background-color: #f8fafc;
          transition: 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }
        input:checked + .ot-slider {
          background: linear-gradient(135deg, #a855f7, #7c3aed);
          border-color: rgba(216, 180, 254, 0.5);
          box-shadow: 0 0 12px rgba(168, 85, 247, 0.4);
        }
        input:checked + .ot-slider:before {
          transform: translateX(22px);
          background-color: #ffffff;
        }
        .ot-footer {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.76rem;
        }
        .ot-queue-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #cbd5e1;
        }
        .ot-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #4ade80;
        }
        .ot-dot.pulse {
          animation: ot-pulse-green 2s infinite;
        }
        .ot-dot.warning {
          background: #f59e0b;
          animation: ot-pulse-orange 1.5s infinite;
        }
        .ot-dot.offline {
          background: #ec4899;
          animation: ot-pulse-pink 2s infinite;
        }
        @keyframes ot-pulse-green {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.5); }
          50% { box-shadow: 0 0 0 6px rgba(74, 222, 128, 0); }
        }
        @keyframes ot-pulse-orange {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); }
          50% { box-shadow: 0 0 0 6px rgba(245, 158, 11, 0); }
        }
        @keyframes ot-pulse-pink {
          0%, 100% { box-shadow: 0 0 0 0 rgba(236, 72, 153, 0.5); }
          50% { box-shadow: 0 0 0 6px rgba(236, 72, 153, 0); }
        }
        .ot-sync-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 6px;
          background: rgba(139, 92, 246, 0.15);
          border: 1px solid rgba(139, 92, 246, 0.3);
          color: #d8b4fe;
          font-size: 0.74rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .ot-sync-btn:hover:not(:disabled) {
          background: rgba(139, 92, 246, 0.3);
          border-color: rgba(139, 92, 246, 0.5);
          color: #ffffff;
        }
        .ot-sync-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .ot-spinner {
          display: inline-block;
          width: 11px;
          height: 11px;
          border: 2px solid rgba(216, 180, 254, 0.3);
          border-radius: 50%;
          border-top-color: #d8b4fe;
          animation: ot-spin 0.8s linear infinite;
        }
        @keyframes ot-spin {
          to { transform: rotate(360deg); }
        }
        .ot-status-msg {
          font-size: 0.72rem;
          color: #a78bfa;
          margin-top: 6px;
          text-align: center;
          animation: ot-fade-in 0.2s ease;
        }
        @keyframes ot-fade-in {
          from { opacity: 0; transform: translateY(-3px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="ot-header">
        <div className="ot-left">
          <div className="ot-icon-badge">
            {effectiveOffline ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="m9 12 2 2 4-4"/>
              </svg>
            )}
          </div>
          <div className="ot-titles">
            <div className="ot-title-row">
              <span className="ot-title">Offline Deep Focus</span>
              {effectiveOffline ? (
                <span className="ot-badge badge-offline">Shield Active</span>
              ) : (
                <span className="ot-badge badge-live">Multiplayer Live</span>
              )}
            </div>
            <span className="ot-subtitle">
              {isDeepFocus
                ? 'Multiplayer feeds & leaderboards muted'
                : !isOnline
                ? 'Offline — sessions queue locally'
                : 'Silence online distractions during focus'}
            </span>
          </div>
        </div>

        <label className="ot-switch" title={isDeepFocus ? 'Disable Deep Focus' : 'Enable Deep Focus'}>
          <input
            type="checkbox"
            checked={isDeepFocus}
            onChange={handleToggle}
            aria-label="Offline Deep Focus toggle"
          />
          <span className="ot-slider" />
        </label>
      </div>

      {!compact && (
        <div className="ot-footer">
          <div className="ot-queue-indicator">
            <span
              className={`ot-dot ${
                queueCount > 0 ? 'warning' : effectiveOffline ? 'offline' : 'pulse'
              }`}
            />
            <span>
              {queueCount > 0
                ? `${queueCount} session${queueCount === 1 ? '' : 's'} queued offline`
                : isOnline
                ? 'Synced to Supabase'
                : 'Ready for offline logs'}
            </span>
          </div>

          {(queueCount > 0 || isSyncing) && isOnline && (
            <button
              className="ot-sync-btn"
              onClick={handleSyncNow}
              disabled={isSyncing}
              title="Push offline queued sessions to Supabase"
            >
              {isSyncing ? (
                <>
                  <span className="ot-spinner" />
                  <span>Syncing...</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  <span>Sync Queue</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {statusMessage && <div className="ot-status-msg">{statusMessage}</div>}
    </div>
  );
}
