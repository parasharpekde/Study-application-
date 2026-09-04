// ==========================================================================
// FlowState - Web Audio API Synthesis Engine & Ambient Player
// ==========================================================================

import { store } from './state.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.analyser = null;
    this.currentSourceNodes = [];
    this.isPlaying = false;
    this.isMuted = false;
    this.activePreset = 'brown';
    this.volume = 0.6;
    this.animFrameId = null;
    this.lofiTimer = null;

    // Custom Audio Player State (Zero-Knowledge Local Tracks)
    this.customAudioEl = null;
    this.customSourceNode = null;
    this.activeCustomTrack = null;
    this.activeObjectUrl = null;
    this.isCustomTrack = false;
    this.hasMediaElementRouting = false;

    // Load initial settings from store
    const state = store.get();
    if (state.timerSettings) {
      this.volume = state.timerSettings.soundVolume ?? 0.6;
      this.isMuted = state.timerSettings.soundMuted ?? false;
      this.activePreset = state.timerSettings.activePreset ?? 'brown';
    }

    this.initCustomAudioElement();
  }

  initCustomAudioElement() {
    if (typeof window === 'undefined') return;
    this.customAudioEl = new Audio();
    this.customAudioEl.loop = true;
    this.customAudioEl.crossOrigin = 'anonymous';

    this.customAudioEl.addEventListener('error', (e) => {
      console.warn('Audio playback error on custom track:', e);
      store.emit('show_toast', {
        type: 'warning',
        message: '⚠️ Could not stream or play this audio track. Check if link is live and permits CORS.'
      });
    });
  }

  initContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();

      // Master Gain Node
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);

      // Analyser for Live Visualizer
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Connect custom audio element to master gain if not yet connected
    if (this.customAudioEl && !this.hasMediaElementRouting && this.ctx) {
      try {
        this.customSourceNode = this.ctx.createMediaElementSource(this.customAudioEl);
        this.customSourceNode.connect(this.masterGain);
        this.hasMediaElementRouting = true;
      } catch (err) {
        // Fallback for strict CORS environments
        console.warn('MediaElementSource routing note:', err.message);
      }
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
    // Direct audio element volume as redundancy/fallback
    if (this.customAudioEl) {
      this.customAudioEl.volume = this.isMuted ? 0 : this.volume;
    }
    store.set(s => ({
      ...s,
      timerSettings: { ...s.timerSettings, soundVolume: this.volume }
    }));
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
    if (this.customAudioEl) {
      this.customAudioEl.volume = this.isMuted ? 0 : this.volume;
    }
    store.set(s => ({
      ...s,
      timerSettings: { ...s.timerSettings, soundMuted: this.isMuted }
    }));
    return this.isMuted;
  }

  cleanupActiveObjectUrl() {
    if (this.activeObjectUrl) {
      try {
        URL.revokeObjectURL(this.activeObjectUrl);
      } catch (e) {
        // ignore
      }
      this.activeObjectUrl = null;
    }
  }

  stopCurrentSound() {
    if (this.lofiTimer) {
      clearInterval(this.lofiTimer);
      this.lofiTimer = null;
    }

    for (const node of this.currentSourceNodes) {
      try {
        if (node.stop) node.stop();
        if (node.disconnect) node.disconnect();
      } catch (e) {
        // already stopped
      }
    }
    this.currentSourceNodes = [];

    // Pause custom audio element
    if (this.customAudioEl) {
      this.customAudioEl.pause();
    }
  }

  playPreset(presetKey) {
    this.initContext();
    this.stopCurrentSound();
    this.isCustomTrack = false;
    this.activeCustomTrack = null;

    if (presetKey) {
      this.activePreset = presetKey;
      store.set(s => ({
        ...s,
        timerSettings: { ...s.timerSettings, activePreset: presetKey }
      }));
    }

    switch (this.activePreset) {
      case 'brown':
        this.generateBrownNoise();
        break;
      case 'pink':
        this.generatePinkNoise();
        break;
      case 'binaural_gamma':
        this.generateBinauralBeats(210, 250); // 40 Hz Gamma Focus
        break;
      case 'binaural_beta':
        this.generateBinauralBeats(200, 214); // 14 Hz Beta Study
        break;
      case 'rain':
        this.generateRainAtmosphere();
        break;
      case 'lofi':
        this.generateLofiChords();
        break;
      default:
        this.generateBrownNoise();
        break;
    }

    this.isPlaying = true;
    this.startVisualizer();
    store.emit('audio_state_change', { isPlaying: true, preset: this.activePreset });
  }

  /**
   * Plays a private custom audio track (from local IndexedDB Blob or Stream URL).
   * @param {Object} track - Track record { id, trackName, type, audioBlob?, streamUrl? }
   */
  async playCustomTrack(track) {
    if (!track) return;
    this.initContext();
    this.stopCurrentSound();

    // Clean up previous blob URL to prevent memory leaks
    this.cleanupActiveObjectUrl();

    this.isCustomTrack = true;
    this.activeCustomTrack = track;
    this.activePreset = 'custom';

    try {
      if (track.type === 'blob' && track.audioBlob) {
        this.activeObjectUrl = URL.createObjectURL(track.audioBlob);
        this.customAudioEl.src = this.activeObjectUrl;
      } else if (track.type === 'stream' && track.streamUrl) {
        this.customAudioEl.src = track.streamUrl;
      } else {
        throw new Error('Invalid track format or missing audio source.');
      }

      this.customAudioEl.volume = this.isMuted ? 0 : this.volume;
      await this.customAudioEl.play();

      this.isPlaying = true;
      this.startVisualizer();
      store.emit('audio_state_change', {
        isPlaying: true,
        preset: 'custom',
        customTrack: track
      });
    } catch (err) {
      console.warn('Error starting custom track playback:', err);
      this.isPlaying = false;
      this.stopVisualizer();
      store.emit('show_toast', {
        type: 'warning',
        message: 'Could not play audio track: ' + (err.message || 'playback error')
      });
    }
  }

  pause() {
    if (this.customAudioEl) {
      this.customAudioEl.pause();
    }
    this.stopCurrentSound();
    this.isPlaying = false;
    this.stopVisualizer();
    store.emit('audio_state_change', {
      isPlaying: false,
      preset: this.activePreset,
      customTrack: this.activeCustomTrack
    });
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      if (this.isCustomTrack && this.activeCustomTrack) {
        if (this.customAudioEl && this.customAudioEl.src) {
          this.initContext();
          this.customAudioEl.play().catch(e => console.warn(e));
          this.isPlaying = true;
          this.startVisualizer();
          store.emit('audio_state_change', {
            isPlaying: true,
            preset: 'custom',
            customTrack: this.activeCustomTrack
          });
        } else {
          this.playCustomTrack(this.activeCustomTrack);
        }
      } else {
        this.playPreset(this.activePreset);
      }
    }
    return this.isPlaying;
  }

  // --- Sound Generators ---

  // 1. Warm Brown Noise (Random Walk with Lowpass Filter)
  generateBrownNoise() {
    const bufferSize = 5 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(2, bufferSize, this.ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const output = noiseBuffer.getChannelData(channel);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5; // Gain compensation
      }
    }

    const whiteSource = this.ctx.createBufferSource();
    whiteSource.buffer = noiseBuffer;
    whiteSource.loop = true;

    // Filter to warm deep rumble
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, this.ctx.currentTime);

    whiteSource.connect(filter);
    filter.connect(this.masterGain);
    whiteSource.start();

    this.currentSourceNodes.push(whiteSource, filter);
  }

  // 2. Pink Noise (Paul Kellet 1/f filter)
  generatePinkNoise() {
    const bufferSize = 5 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(2, bufferSize, this.ctx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
      const output = noiseBuffer.getChannelData(channel);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    source.connect(this.masterGain);
    source.start();
    this.currentSourceNodes.push(source);
  }

  // 3. Stereo Binaural Beats
  generateBinauralBeats(leftFreq, rightFreq) {
    const merger = this.ctx.createChannelMerger(2);

    // Left Ear Oscillator
    const oscL = this.ctx.createOscillator();
    oscL.type = 'sine';
    oscL.frequency.setValueAtTime(leftFreq, this.ctx.currentTime);

    // Right Ear Oscillator
    const oscR = this.ctx.createOscillator();
    oscR.type = 'sine';
    oscR.frequency.setValueAtTime(rightFreq, this.ctx.currentTime);

    // Soft Gain to keep pure tone gentle
    const toneGain = this.ctx.createGain();
    toneGain.gain.setValueAtTime(0.25, this.ctx.currentTime);

    oscL.connect(merger, 0, 0); // Left channel
    oscR.connect(merger, 0, 1); // Right channel
    merger.connect(toneGain);
    toneGain.connect(this.masterGain);

    oscL.start();
    oscR.start();

    this.currentSourceNodes.push(oscL, oscR, merger, toneGain);
  }

  // 4. Rain & Storm Atmosphere
  generateRainAtmosphere() {
    // Generate pink noise base
    const bufferSize = 4 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(2, bufferSize, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.35;
      }
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    // Dual filters for ambient rain sound
    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(900, this.ctx.currentTime);
    bandpass.Q.setValueAtTime(0.7, this.ctx.currentTime);

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(3200, this.ctx.currentTime);

    noiseSource.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(this.masterGain);
    noiseSource.start();

    this.currentSourceNodes.push(noiseSource, bandpass, lowpass);
  }

  // 5. Lo-Fi Chill Synthesizer Chords
  generateLofiChords() {
    // Warm jazz chords: Cmaj9, Am9, Dm9, G13
    const chordProgressions = [
      [261.63, 329.63, 392.00, 493.88, 587.33], // Cmaj9
      [220.00, 261.63, 329.63, 392.00, 493.88], // Am9
      [293.66, 349.23, 440.00, 523.25, 659.25], // Dm9
      [196.00, 246.94, 329.63, 392.00, 440.00]  // G13
    ];

    let chordIndex = 0;

    const playNextChord = () => {
      if (!this.isPlaying || this.activePreset !== 'lofi') return;

      const chord = chordProgressions[chordIndex];
      chordIndex = (chordIndex + 1) % chordProgressions.length;

      const now = this.ctx.currentTime;
      const duration = 4.2;

      chord.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const chordGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq + (Math.random() * 0.4 - 0.2), now);

        // Lowpass for vintage lo-fi warmth
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(750, now);

        // Gentle ADSR envelope
        chordGain.gain.setValueAtTime(0.001, now);
        chordGain.gain.linearRampToValueAtTime(0.04, now + 0.5);
        chordGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        osc.connect(filter);
        filter.connect(chordGain);
        chordGain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + duration);
        this.currentSourceNodes.push(osc, chordGain, filter);
      });
    };

    playNextChord();
    this.lofiTimer = setInterval(playNextChord, 4200);
  }

  // Meditative Tibetan Singing Bowl Sound on Session Finish
  playChime() {
    this.initContext();
    const now = this.ctx.currentTime;

    // Harmonic frequencies for zen bell
    const harmonics = [528, 1056, 1584];
    harmonics.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18 / (i + 1), now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.8);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 4);
    });
  }

  // --- Real-Time Live Canvas Visualizer ---
  startVisualizer() {
    const canvas = document.getElementById('audio-visualizer-canvas');
    if (!canvas || !this.analyser) return;

    const ctx = canvas.getContext('2d');
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      if (!this.isPlaying) return;
      this.animFrameId = requestAnimationFrame(render);

      this.analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / (bufferLength / 2)) * 1.5;
      let x = 0;

      for (let i = 0; i < bufferLength / 2; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.85 + 2;

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#00f2fe');
        gradient.addColorStop(1, '#8b5cf6');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

        x += barWidth;
      }
    };

    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    render();
  }

  stopVisualizer() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    const canvas = document.getElementById('audio-visualizer-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}

export const audio = new AudioEngine();
