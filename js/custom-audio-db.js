// ==========================================================================
// FlowState - Zero-Knowledge Private Local Audio IndexedDB Storage
// ==========================================================================
// PRIVACY GUARANTEE: Audio blobs and stream links are stored EXCLUSIVELY in
// the user's local browser IndexedDB. Zero bytes are ever transmitted to any
// remote server, database, or telemetry service.
// ==========================================================================

const DB_NAME = 'userAudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'custom_tracks';

class CustomAudioDatabase {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  /**
   * Initializes or connects to the local IndexedDB database.
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this browser.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('dateAdded', 'dateAdded', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  /**
   * Helper to execute a transaction on the custom_tracks store.
   */
  async getStore(mode = 'readonly') {
    const db = await this.init();
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  }

  /**
   * Add a local audio file (Blob/File) to IndexedDB.
   * @param {File} file - Audio file from file picker or drag-and-drop
   * @param {string} [customName] - Optional override for track display name
   * @returns {Promise<Object>} Created track metadata
   */
  async addBlobTrack(file, customName) {
    // Determine format from filename or mime type
    const ext = (file.name.split('.').pop() || 'mp3').toUpperCase();
    const baseName = customName || file.name.replace(/\.[^/.]+$/, '');

    const trackRecord = {
      id: 'custom-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      trackName: baseName.trim() || 'Custom Track',
      type: 'blob',
      format: ext,
      size: file.size,
      mimeType: file.type || 'audio/mpeg',
      audioBlob: file, // Stored as native Blob in IndexedDB
      dateAdded: Date.now()
    };

    try {
      const store = await this.getStore('readwrite');
      await new Promise((resolve, reject) => {
        const req = store.add(trackRecord);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => {
          if (e.target.error && e.target.error.name === 'QuotaExceededError') {
            reject(new Error('Browser storage quota exceeded. Please free up space by removing older tracks.'));
          } else {
            reject(e.target.error);
          }
        };
      });
      return trackRecord;
    } catch (err) {
      console.error('Failed to save audio file to IndexedDB:', err);
      throw err;
    }
  }

  /**
   * Add an external live web audio stream URL (stored locally).
   * @param {string} name - Display title
   * @param {string} streamUrl - Direct audio link (.mp3, shoutcast, stream link)
   * @returns {Promise<Object>} Created track metadata
   */
  async addStreamTrack(name, streamUrl) {
    const trimmedUrl = (streamUrl || '').trim();
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      throw new Error('Stream URL must begin with http:// or https://');
    }

    const trackRecord = {
      id: 'stream-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      trackName: (name || 'Web Audio Stream').trim(),
      type: 'stream',
      format: 'STREAM',
      size: 0,
      streamUrl: trimmedUrl,
      dateAdded: Date.now()
    };

    const store = await this.getStore('readwrite');
    await new Promise((resolve, reject) => {
      const req = store.add(trackRecord);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });

    return trackRecord;
  }

  /**
   * Retrieve all custom tracks.
   * @returns {Promise<Array<Object>>}
   */
  async getAllTracks() {
    const store = await this.getStore('readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        // Sort descending by dateAdded (newest first)
        list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        resolve(list);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Get a specific track by its ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getTrack(id) {
    const store = await this.getStore('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Rename an existing track.
   * @param {string} id
   * @param {string} newName
   */
  async updateTrackName(id, newName) {
    const cleanName = (newName || '').trim();
    if (!cleanName) throw new Error('Track name cannot be empty.');

    const track = await this.getTrack(id);
    if (!track) throw new Error('Track not found.');

    track.trackName = cleanName;

    const store = await this.getStore('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(track);
      req.onsuccess = () => resolve(track);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Delete a track from local IndexedDB.
   * @param {string} id
   */
  async deleteTrack(id) {
    const store = await this.getStore('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Calculates local storage usage for custom tracks and overall browser quota.
   * @returns {Promise<Object>} Usage stats
   */
  async getStorageUsage() {
    const tracks = await this.getAllTracks();
    let totalCustomBytes = 0;
    let localBlobCount = 0;
    let streamCount = 0;

    for (const t of tracks) {
      if (t.type === 'blob' && t.size) {
        totalCustomBytes += t.size;
        localBlobCount++;
      } else if (t.type === 'stream') {
        streamCount++;
      }
    }

    const customMB = (totalCustomBytes / (1024 * 1024)).toFixed(1);

    let quotaInfo = null;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usageMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
        const quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(0);
        const percent = est.quota ? (((est.usage || 0) / est.quota) * 100).toFixed(1) : 0;
        quotaInfo = { usageMB, quotaMB, percent };
      } catch (e) {
        // storage.estimate fallback
      }
    }

    return {
      totalBytes: totalCustomBytes,
      totalMB: customMB,
      trackCount: tracks.length,
      localBlobCount,
      streamCount,
      quotaInfo
    };
  }
}

export const customAudioDB = new CustomAudioDatabase();
