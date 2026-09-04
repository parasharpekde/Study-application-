// ==========================================================================
// FlowState - Dedicated Login Page Controller (Redirect to main dashboard)
// ==========================================================================

import { store } from './state.js';

class LoginPageController {
  constructor() {
    this.client = null;
    this.activeTab = 'signin'; // 'signin' | 'signup'
  }

  async init() {
    this.bindDOM();

    // Initialize Supabase Client
    try {
      const config = store.get().supabaseConfig;
      if (config && config.url && config.anonKey) {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        this.client = createClient(config.url, config.anonKey);

        // Check if user is already logged in
        const { data: { session } } = await this.client.auth.getSession();
        if (session?.user) {
          console.log('User already signed in, redirecting to dashboard...');
          this.saveAuthUserToStore(session.user);
          // Quick redirect to main website
          window.location.href = 'index.html';
        }
      }
    } catch (err) {
      console.warn('Supabase initialization on login page:', err.message);
    }
  }

  bindDOM() {
    const tabSignIn = document.getElementById('tab-btn-signin');
    const tabSignUp = document.getElementById('tab-btn-signup');
    const form = document.getElementById('login-form');
    const guestBtn = document.getElementById('btn-login-guest');

    tabSignIn?.addEventListener('click', () => this.switchTab('signin'));
    tabSignUp?.addEventListener('click', () => this.switchTab('signup'));

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    guestBtn?.addEventListener('click', () => {
      this.continueAsGuest();
    });
  }

  switchTab(tab) {
    this.activeTab = tab;
    const tabSignIn = document.getElementById('tab-btn-signin');
    const tabSignUp = document.getElementById('tab-btn-signup');
    const nameGroup = document.getElementById('group-display-name');
    const submitBtn = document.getElementById('btn-login-submit');
    const subtitle = document.getElementById('login-subtitle-text');
    const alertBox = document.getElementById('login-alert');

    if (alertBox) alertBox.style.display = 'none';

    if (tab === 'signup') {
      tabSignIn?.classList.remove('active');
      tabSignUp?.classList.add('active');
      if (nameGroup) nameGroup.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Create Account & Launch';
      if (subtitle) subtitle.textContent = 'Start tracking focus with cloud sync & squads';
    } else {
      tabSignUp?.classList.remove('active');
      tabSignIn?.classList.add('active');
      if (nameGroup) nameGroup.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Sign In & Launch';
      if (subtitle) subtitle.textContent = 'Enter your personal focus sanctuary';
    }
  }

  showAlert(message, isError = true) {
    const alertBox = document.getElementById('login-alert');
    if (alertBox) {
      alertBox.textContent = message;
      alertBox.className = isError ? 'auth-alert auth-alert-error' : 'auth-alert auth-alert-success';
      alertBox.style.display = 'block';
    }
  }

  async handleSubmit() {
    const email = document.getElementById('login-input-email')?.value.trim();
    const password = document.getElementById('login-input-password')?.value;
    const displayName = document.getElementById('login-input-name')?.value.trim() || '';
    const submitBtn = document.getElementById('btn-login-submit');

    if (!email || !password) {
      this.showAlert('Please fill in both email and password.');
      return;
    }

    if (password.length < 6) {
      this.showAlert('Password must be at least 6 characters.');
      return;
    }

    if (!this.client) {
      this.showAlert('Database connecting... please retry in a second.');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Launching FlowState...';
      }

      if (this.activeTab === 'signup') {
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
          this.saveAuthUserToStore(data.user);
          this.showAlert('Account created! Redirecting to main dashboard...', false);
          setTimeout(() => {
            window.location.href = 'index.html';
          }, 400);
        }
      } else {
        const { data, error } = await this.client.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        if (data.user) {
          this.saveAuthUserToStore(data.user);
          this.showAlert('Success! Redirecting to main dashboard...', false);
          setTimeout(() => {
            window.location.href = 'index.html';
          }, 300);
        }
      }
    } catch (err) {
      this.showAlert(err.message || 'Authentication failed. Please verify credentials.');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = this.activeTab === 'signup' ? 'Create Account & Launch' : 'Sign In & Launch';
      }
    }
  }

  saveAuthUserToStore(user) {
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
  }

  continueAsGuest() {
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

    // Set a session pass so the auth guard in index.html lets guest through
    sessionStorage.setItem('flowstate_guest_pass', '1');
    // Redirect to main website
    window.location.href = 'index.html';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const loginApp = new LoginPageController();
  loginApp.init();
});
