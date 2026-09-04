import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * ==============================================================================
 * FlowState - Zero-Knowledge Private Custom Music Engine (React Component)
 * ==============================================================================
 * PRIVACY GUARANTEE:
 * 1. Audio files (Blobs) are stored 100% locally in browser IndexedDB.
 * 2. Zero bytes, titles, or metadata are ever uploaded to remote servers or Supabase.
 * 3. Object URLs are strictly revoked via URL.revokeObjectURL() to prevent memory leaks.
 * ==============================================================================
 */

const DB_NAME = 'userAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'custom_tracks';

// --- IndexedDB Low-Level Promise Wrapper ---
function openAudioDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('dateAdded', 'dateAdded', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export default function CustomMusicEngine({ onClose, onTrackPlaying }) {
  // State
  const [tracks, setTracks] = useState([]);
  const [activeTrack, setActiveTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [storageStats, setStorageStats] = useState({ totalMB: '0.0', count: 0, percent: 0 });
  const [streamName, setStreamName] = useState('');
  const [streamUrl, setStreamUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Audio References
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const masterGainRef = useRef(null);
  const analyserRef = useRef(null);
  const mediaSourceRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const activeBlobUrlRef = useRef(null);
  const fileInputRef = useRef(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // --- IndexedDB Operations ---
  const loadTracks = useCallback(async () => {
    try {
      const db = await openAudioDatabase();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = async () => {
        const list = req.result || [];
        list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        setTracks(list);

        // Calculate Storage Usage
        let totalBytes = 0;
        list.forEach((t) => {
          if (t.type === 'blob' && t.size) totalBytes += t.size;
        });
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);

        let pct = Math.min(100, (totalBytes / (300 * 1024 * 1024)) * 100);
        if (navigator.storage && navigator.storage.estimate) {
          try {
            const est = await navigator.storage.estimate();
            if (est.quota) pct = Math.min(100, ((est.usage || 0) / est.quota) * 100);
          } catch (e) {}
        }
        setStorageStats({ totalMB: mb, count: list.length, percent: Math.max(3, pct) });
      };
    } catch (err) {
      console.error('Failed to load tracks from IndexedDB:', err);
    }
  }, []);

  useEffect(() => {
    loadTracks();
  }, [loadTracks]);

  // --- Web Audio API Initialization ---
  const initWebAudio = () => {
    if (!audioRef.current) return;
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(isMuted ? 0 : volume, ctx.currentTime);
      masterGainRef.current = gain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      try {
        if (!mediaSourceRef.current) {
          mediaSourceRef.current = ctx.createMediaElementSource(audioRef.current);
          mediaSourceRef.current.connect(gain);
        }
      } catch (err) {
        console.warn('Media element routing notice:', err);
      }

      gain.connect(analyser);
      analyser.connect(ctx.destination);
    }

    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  };

  // --- Visualizer Loop ---
  const renderVisualizer = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current || !isPlaying) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyserRef.current.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / (bufferLength / 2)) * 1.5;
      let x = 0;

      for (let i = 0; i < bufferLength / 2; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.85 + 2;
        const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
        grad.addColorStop(0, '#00f2fe');
        grad.addColorStop(1, '#8b5cf6');

        ctx.fillStyle = grad;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    };
    draw();
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      renderVisualizer();
    } else if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, renderVisualizer]);

  // Clean up Object URL on unmount to prevent leaks
  useEffect(() => {
    return () => {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  // --- Volume & Mute Synchronization ---
  useEffect(() => {
    if (masterGainRef.current && audioContextRef.current) {
      const targetGain = isMuted ? 0 : volume;
      masterGainRef.current.gain.setTargetAtTime(targetGain, audioContextRef.current.currentTime, 0.05);
    }
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // --- Play Track Handler with Safe Object URL Lifecycle ---
  const playTrack = async (track) => {
    initWebAudio();

    if (activeTrack && activeTrack.id === track.id) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        await audioRef.current?.play();
        setIsPlaying(true);
      }
      return;
    }

    // Revoke previous Blob URL to prevent memory leaks
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }

    try {
      let sourceUrl = '';
      if (track.type === 'blob' && track.audioBlob) {
        const url = URL.createObjectURL(track.audioBlob);
        activeBlobUrlRef.current = url;
        sourceUrl = url;
      } else if (track.type === 'stream' && track.streamUrl) {
        sourceUrl = track.streamUrl;
      }

      if (audioRef.current) {
        audioRef.current.src = sourceUrl;
        audioRef.current.loop = true;
        await audioRef.current.play();
        setActiveTrack(track);
        setIsPlaying(true);
        if (onTrackPlaying) onTrackPlaying(track);
      }
    } catch (err) {
      console.error('Audio playback failed:', err);
      showToast('⚠️ Could not play audio. Ensure format is supported.');
    }
  };

  // --- File Drag & Drop Handler ---
  const handleFiles = async (files) => {
    const validExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
    let count = 0;

    try {
      const db = await openAudioDatabase();
      for (const file of files) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!file.type.startsWith('audio/') && !validExts.includes(ext)) continue;

        const record = {
          id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
          trackName: file.name.replace(/\.[^/.]+$/, ''),
          type: 'blob',
          format: ext.toUpperCase(),
          size: file.size,
          mimeType: file.type || 'audio/mpeg',
          audioBlob: file, // Stored as binary Blob in client-side IndexedDB
          dateAdded: Date.now()
        };

        const tx = db.transaction(STORE_NAME, 'readwrite');
        await new Promise((res, rej) => {
          const req = tx.objectStore(STORE_NAME).add(record);
          req.onsuccess = res;
          req.onerror = rej;
        });
        count++;
      }

      if (count > 0) {
        showToast(`🎵 Saved ${count} file(s) locally in IndexedDB (0% cloud uploaded)`);
        loadTracks();
      }
    } catch (err) {
      showToast('❌ Failed to save track: ' + err.message);
    }
  };

  // --- Stream URL Add ---
  const handleAddStream = async () => {
    if (!streamUrl.trim()) return;
    try {
      const db = await openAudioDatabase();
      const record = {
        id: 'stream-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
        trackName: (streamName.trim() || 'Web Stream'),
        type: 'stream',
        format: 'STREAM',
        size: 0,
        streamUrl: streamUrl.trim(),
        dateAdded: Date.now()
      };

      const tx = db.transaction(STORE_NAME, 'readwrite');
      await new Promise((res, rej) => {
        const req = tx.objectStore(STORE_NAME).add(record);
        req.onsuccess = res;
        req.onerror = rej;
      });

      setStreamName('');
      setStreamUrl('');
      showToast('📻 Stream added to your private library!');
      loadTracks();
    } catch (err) {
      showToast('❌ ' + err.message);
    }
  };

  // --- Rename Track ---
  const handleRename = async (track) => {
    const newName = prompt('Enter new display name for this track:', track.trackName);
    if (!newName || !newName.trim() || newName.trim() === track.trackName) return;

    try {
      const db = await openAudioDatabase();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      track.trackName = newName.trim();
      store.put(track);
      showToast('✏️ Track renamed.');
      loadTracks();
    } catch (e) {
      showToast('❌ ' + e.message);
    }
  };

  // --- Delete Track ---
  const handleDelete = async (trackId) => {
    if (!confirm('Permanently remove this track from local browser storage?')) return;
    try {
      if (activeTrack && activeTrack.id === trackId) {
        audioRef.current?.pause();
        setIsPlaying(false);
        setActiveTrack(null);
      }
      const db = await openAudioDatabase();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(trackId);
      showToast('🗑️ Track purged from local IndexedDB.');
      loadTracks();
    } catch (e) {
      showToast('❌ ' + e.message);
    }
  };

  return (
    <div style={styles.modalOverlay}>
      <audio ref={audioRef} crossOrigin="anonymous" style={{ display: 'none' }} />

      <div style={styles.modalBox}>
        {/* Header */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={styles.shieldIcon}>🛡️</div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>Private Audio Vault</h3>
              <span style={{ fontSize: '0.75rem', color: '#10b981' }}>
                Zero-Knowledge • IndexedDB Local Storage • No Cloud Uploads
              </span>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} style={styles.closeBtn}>
              &times;
            </button>
          )}
        </div>

        {/* Local Storage Meter */}
        <div style={styles.storageMeter}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
            <span style={{ fontWeight: 600, color: '#e2e8f0' }}>Local Device Storage</span>
            <span style={{ color: '#00f2fe', fontFamily: 'monospace' }}>
              {storageStats.count} tracks • {storageStats.totalMB} MB
            </span>
          </div>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressBar, width: `${storageStats.percent}%` }} />
          </div>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
            Stored exclusively in your browser's private sandbox.
          </span>
        </div>

        {/* Drag and Drop Zone */}
        <div
          style={{
            ...styles.dropzone,
            borderColor: isDragging ? '#00f2fe' : 'rgba(0, 242, 254, 0.3)',
            background: isDragging ? 'rgba(0, 242, 254, 0.1)' : 'rgba(0, 242, 254, 0.02)'
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".mp3,.wav,.ogg,.flac,.m4a,audio/*"
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(Array.from(e.target.files))}
          />
          <div style={{ fontSize: '1.8rem', marginBottom: '0.3rem' }}>📁</div>
          <div style={{ fontWeight: 600, color: '#fff', fontSize: '0.95rem' }}>
            Drag & Drop Audio Files Here
          </div>
          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
            Supports .mp3, .wav, .ogg, .flac, .m4a
          </div>
        </div>

        {/* Web Stream Input */}
        <div style={styles.streamCard}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1' }}>
            📻 Add Web Audio Stream URL
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
            <input
              type="text"
              placeholder="Stream Title (e.g. Lofi Station)"
              value={streamName}
              onChange={(e) => setStreamName(e.target.value)}
              style={styles.input}
            />
            <input
              type="url"
              placeholder="https://stream-url.mp3"
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              style={{ ...styles.input, flex: 1.5 }}
            />
            <button onClick={handleAddStream} style={styles.primaryBtn}>
              Add Link
            </button>
          </div>
        </div>

        {/* Playlist Container */}
        <div style={{ marginTop: '1rem', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h4 style={{ margin: 0, fontSize: '0.95rem', color: '#fff' }}>My Private Library</h4>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{tracks.length} tracks</span>
          </div>

          <div style={styles.trackList}>
            {tracks.length === 0 ? (
              <div style={styles.emptyState}>No custom tracks yet. Drop audio files above to get started!</div>
            ) : (
              tracks.map((t) => {
                const isCurrent = activeTrack && activeTrack.id === t.id && isPlaying;
                return (
                  <div
                    key={t.id}
                    style={{
                      ...styles.trackItem,
                      borderColor: isCurrent ? '#00f2fe' : 'rgba(255, 255, 255, 0.08)'
                    }}
                  >
                    <button onClick={() => playTrack(t)} style={styles.playBtn}>
                      {isCurrent ? '⏸' : '▶'}
                    </button>
                    <div style={{ flex: 1, minWidth: 0, padding: '0 0.75rem' }}>
                      <div style={styles.trackTitle}>{t.trackName}</div>
                      <div style={styles.trackMeta}>
                        <span style={styles.formatTag}>{t.format}</span>
                        <span>
                          {t.type === 'blob'
                            ? `${(t.size / (1024 * 1024)).toFixed(1)} MB`
                            : 'Live Web Stream'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      <button onClick={() => handleRename(t)} style={styles.iconBtn} title="Rename">
                        ✏️
                      </button>
                      <button onClick={() => handleDelete(t.id)} style={styles.iconBtn} title="Purge Track">
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Active Player Deck */}
        <div style={styles.playerDeck}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
            <button
              onClick={() => setIsMuted(!isMuted)}
              style={styles.iconBtn}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>
          <canvas ref={canvasRef} width="120" height="24" style={styles.canvas} />
        </div>

        {toastMessage && <div style={styles.toast}>{toastMessage}</div>}
      </div>
    </div>
  );
}

// Inline Styles for portable drop-in usage
const styles = {
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 7, 15, 0.85)',
    backdropFilter: 'blur(12px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    fontFamily: 'Inter, system-ui, sans-serif'
  },
  modalBox: {
    background: '#0d1322',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    padding: '1.5rem',
    width: '92%',
    maxWidth: '600px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 30px rgba(0, 242, 254, 0.1)',
    position: 'relative'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  shieldIcon: {
    fontSize: '1.4rem',
    background: 'rgba(16, 185, 129, 0.15)',
    padding: '6px 10px',
    borderRadius: '10px'
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: '1.6rem',
    cursor: 'pointer'
  },
  storageMeter: {
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '10px',
    padding: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    marginBottom: '0.9rem',
    border: '1px solid rgba(255, 255, 255, 0.06)'
  },
  progressTrack: {
    height: '6px',
    borderRadius: '999px',
    background: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden'
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #00f2fe, #8b5cf6)',
    transition: 'width 0.4s ease'
  },
  dropzone: {
    border: '2px dashed',
    borderRadius: '12px',
    padding: '1.2rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginBottom: '0.75rem'
  },
  streamCard: {
    background: 'rgba(255, 255, 255, 0.03)',
    padding: '0.75rem',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.06)'
  },
  input: {
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '8px',
    padding: '0.5rem 0.75rem',
    color: '#fff',
    fontSize: '0.85rem',
    outline: 'none',
    flex: 1
  },
  primaryBtn: {
    background: 'linear-gradient(135deg, #00f2fe, #3b82f6)',
    border: 'none',
    borderRadius: '8px',
    padding: '0.5rem 1rem',
    color: '#080a11',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: 'pointer'
  },
  trackList: {
    overflowY: 'auto',
    maxHeight: '220px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    paddingRight: '4px'
  },
  trackItem: {
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid',
    borderRadius: '10px',
    padding: '0.5rem 0.75rem'
  },
  playBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    background: 'linear-gradient(135deg, #00f2fe, #3b82f6)',
    color: '#080a11',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  trackTitle: {
    fontWeight: 600,
    fontSize: '0.85rem',
    color: '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  trackMeta: {
    display: 'flex',
    gap: '0.4rem',
    fontSize: '0.7rem',
    color: '#64748b',
    alignItems: 'center',
    marginTop: '2px'
  },
  formatTag: {
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#00f2fe',
    padding: '1px 5px',
    borderRadius: '4px',
    fontWeight: 700
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    fontSize: '0.9rem'
  },
  emptyState: {
    textAlign: 'center',
    padding: '1.5rem',
    color: '#64748b',
    fontSize: '0.85rem'
  },
  playerDeck: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: '0.75rem',
    marginTop: '0.75rem',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)'
  },
  canvas: {
    borderRadius: '4px',
    background: 'rgba(0, 0, 0, 0.3)'
  },
  toast: {
    position: 'absolute',
    bottom: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#10b981',
    color: '#fff',
    padding: '0.5rem 1rem',
    borderRadius: '999px',
    fontSize: '0.8rem',
    fontWeight: 600,
    boxShadow: '0 4px 15px rgba(0,0,0,0.4)'
  }
};
