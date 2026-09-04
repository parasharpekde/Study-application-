// ==========================================================================
// FlowState - Supabase Authentication & User Profile Engine
// ==========================================================================

import { store } from './state.js';
import { supabaseSync } from './supabase-client.js';

class AuthEngine {
  constructor() {
    this.client = null;
    this.currentUser = null;
    this.activeAuthTab = 'signin'; // 'signin' | 'signup'
  }

  async init() {
    this.bindDOM();

    // Acquire or wait for Supabase client
    try {
      const config = store.get().supabaseConfig;
      if (config && config.url && config.anonKey) {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        this.client = createClient(config.url, config.anonKey);

        // Check active session
        const { data: { session }, error } = await this.client.auth.getSession();
        if (session && session.user) {
          this.handleAuthUser(session.user);
        } else {
          this.handleGuestUser();
        }

        // Listen for auth state changes
        this.client.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session?.user) {
            this.handleAuthUser(session.user);
          } else if (event === 'SIGNED_OUT') {
            this.handleGuestUser();
          }
        });
      }
    } catch (err) {
      console.warn('Auth engine initialization note:', err.message);
      this.handleGuestUser();
    }
  }

  bindDOM() {
    // Open Auth Modal from top navigation button
    document.getElementById('btn-auth-user')?.addEventListener('click', () => {
      this.openAuthModal();
    });

    // Also open Auth Modal when clicking avatar in the center header
    document.getElementById('user-profile-avatar')?.addEventListener('click', () => {
      this.openAuthModal();
    });

    // Close Auth Modal
    document.getElementById('btn-close-auth-modal')?.addEventListener('click', () => {
      this.closeAuthModal();
    });

    // Auth Tabs Switcher (Sign In vs Create Account)
    document.getElementById('auth-tab-signin')?.addEventListener('click', () => {
      this.switchAuthTab('signin');
    });

    document.getElementById('auth-tab-signup')?.addEventListener('click', () => {
      this.switchAuthTab('signup');
    });

    // Form Submit
    document.getElementById('auth-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleFormSubmit();
    });

    // Sign Out Button (inside authenticated profile view)
    document.getElementById('btn-auth-signout')?.addEventListener('click', () => {
      this.signOut();
    });

    // "Continue as Guest" link
    document.getElementById('btn-continue-guest')?.addEventListener('click', () => {
      this.closeAuthModal();
    });
  }

  switchAuthTab(tab) {
    this.activeAuthTab = tab;
    const signinTab = document.getElementById('auth-tab-signin');
    const signupTab = document.getElementById('auth-tab-signup');
    const nameGroup = document.getElementById('auth-name-group');
    const submitBtn = document.getElementById('btn-auth-submit');
    const alertBox = document.getElementById('auth-alert-message');

    if (alertBox) alertBox.style.display = 'none';

    if (tab === 'signup') {
      signinTab?.classList.remove('active');
      signupTab?.classList.add('active');
      if (nameGroup) nameGroup.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Create Account';
    } else {
      signupTab?.classList.remove('active');
      signinTab?.classList.add('active');
      if (nameGroup) nameGroup.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Sign In';
    }
  }

  openAuthModal() {
    const isAuth = store.get().currentUser?.isAuthenticated;
    if (!isAuth) {
      // Direct user to the dedicated login page
      window.location.href = 'login.html';
      return;
    }

    // If authenticated, show the profile management modal
    const guestView = document.getElementById('auth-guest-view');
    const profileView = document.getElementById('auth-profile-view');
    const modalTitle = document.getElementById('auth-modal-title');
    const alertBox = document.getElementById('auth-alert-message');

    if (alertBox) alertBox.style.display = 'none';

    if (guestView) guestView.style.display = 'none';
    if (profileView) profileView.style.display = 'block';
    if (modalTitle) modalTitle.textContent = 'User Profile';

    // Populate profile view details
    const user = store.get().currentUser;
    const nameEl = document.getElementById('auth-profile-name');
    const emailEl = document.getElementById('auth-profile-email');
    const avatarEl = document.getElementById('auth-profile-avatar-img');

    if (nameEl) nameEl.textContent = user.name;
    if (emailEl) emailEl.textContent = user.email || 'Account Verified';
    if (avatarEl) avatarEl.src = user.avatar;

    document.getElementById('auth-modal')?.classList.add('active');
  }

  closeAuthModal() {
    document.getElementById('auth-modal')?.classList.remove('active');
  }

  showAlert(message, isError = true) {
    const alertBox = document.getElementById('auth-alert-message');
    if (alertBox) {
      alertBox.textContent = message;
      alertBox.className = isError ? 'auth-alert auth-alert-error' : 'auth-alert auth-alert-success';
      alertBox.style.display = 'block';
    }
  }

  async handleFormSubmit() {
    const email = document.getElementById('auth-input-email')?.value.trim();
    const password = document.getElementById('auth-input-password')?.value;
    const displayName = document.getElementById('auth-input-name')?.value.trim() || '';
    const submitBtn = document.getElementById('btn-auth-submit');

    if (!email || !password) {
      this.showAlert('Please enter both email and password.');
      return;
    }

    if (password.length < 6) {
      this.showAlert('Password must be at least 6 characters.');
      return;
    }

    if (!this.client) {
      this.showAlert('Connecting to database... please try again in a moment.');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
      }

      if (this.activeAuthTab === 'signup') {
        const { data, error } = await this.client.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || email.split('@')[0]
            }
          }
        });

        if (error) throw error;

        if (data.user) {
          store.emit('show_toast', {
            type: 'success',
            message: `🎉 Account created! Welcome, ${displayName || email.split('@')[0]}!`
          });
          this.handleAuthUser(data.user);
          this.closeAuthModal();
        }
      } else {
        const { data, error } = await this.client.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        if (data.user) {
          store.emit('show_toast', {
            type: 'success',
            message: '✨ Signed in successfully!'
          });
          this.handleAuthUser(data.user);
          this.closeAuthModal();
        }
      }
    } catch (err) {
      this.showAlert(err.message || 'Authentication failed. Please check credentials.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = this.activeAuthTab === 'signup' ? 'Create Account' : 'Sign In';
      }
    }
  }

  handleAuthUser(user) {
    this.currentUser = user;
    const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'FlowMaster';
    const avatarUrl = user.user_metadata?.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(displayName)}`;

    store.set(s => ({
      ...s,
      currentUser: {
        ...s.currentUser,
        id: user.id,
        name: displayName,
        email: user.email,
        avatar: avatarUrl,
        isAuthenticated: true
      }
    }));

    this.updateUI(true, displayName, avatarUrl);
  }

  handleGuestUser() {
    this.currentUser = null;
    store.set(s => ({
      ...s,
      currentUser: {
        ...s.currentUser,
        id: 'me-guest',
        name: 'Focus User',
        email: null,
        isAuthenticated: false
      }
    }));

    this.updateUI(false, 'Focus User', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80');
  }

  async signOut() {
    try {
      if (this.client) {
        await this.client.auth.signOut();
      }
      this.handleGuestUser();
      this.closeAuthModal();
      store.emit('show_toast', {
        type: 'info',
        message: 'Signed out. Switched to Guest Mode.'
      });
    } catch (err) {
      console.error('Sign out error:', err);
    }
  }

  updateUI(isAuthenticated, name, avatar) {
    // 1. Top navigation auth button
    const authBtn = document.getElementById('btn-auth-user');
    const authLabel = document.getElementById('auth-user-btn-label');
    const authAvatar = document.getElementById('auth-user-nav-avatar');

    if (authBtn && authLabel) {
      if (isAuthenticated) {
        authBtn.classList.add('authenticated');
        authLabel.textContent = name;
        if (authAvatar) {
          authAvatar.src = avatar;
          authAvatar.style.display = 'block';
        }
      } else {
        authBtn.classList.remove('authenticated');
        authLabel.textContent = 'Sign In';
        if (authAvatar) authAvatar.style.display = 'none';
      }
    }

    // 2. Center column user greeting and profile avatar
    const greetingHeading = document.getElementById('user-greeting-heading');
    const centerAvatar = document.getElementById('user-profile-avatar');

    if (greetingHeading) {
      greetingHeading.textContent = `Hello, ${name}!`;
    }
    if (centerAvatar) {
      centerAvatar.src = avatar;
    }
  }

  getUserId() {
    return this.currentUser?.id || null;
  }
}

export const authEngine = new AuthEngine();
