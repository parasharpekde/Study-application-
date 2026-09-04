// ==========================================================================
// FlowState - Multiplayer Study Squad & Personal Space Engine
// ==========================================================================

import { store } from './state.js';

class SquadEngine {
  constructor() {
    this.activeLeaderboardFilter = 'today'; // 'today', 'week', 'all'
    this.presenceTimer = null;
  }

  init() {
    this.bindDOM();
    this.renderAll();
    this.startLivePresenceTicker();

    // Listen to state changes
    store.subscribe('change', () => {
      this.renderAll();
    });
  }

  bindDOM() {
    // Room code copy or open modal action
    document.getElementById('squad-room-code-badge')?.addEventListener('click', () => {
      const squad = store.get().currentSquad;
      if (squad && squad.isJoined && squad.code) {
        navigator.clipboard?.writeText(squad.code);
        store.emit('show_toast', {
          type: 'info',
          message: `📋 Copied squad room code: ${squad.code}`
        });
      } else {
        document.getElementById('squad-manage-modal')?.classList.add('active');
      }
    });

    // Deep view code badge copy or open modal action
    document.getElementById('squad-deep-code-badge')?.addEventListener('click', () => {
      const squad = store.get().currentSquad;
      if (squad && squad.isJoined && squad.code) {
        navigator.clipboard?.writeText(squad.code);
        store.emit('show_toast', {
          type: 'info',
          message: `📋 Copied squad room code: ${squad.code}`
        });
      } else {
        document.getElementById('squad-manage-modal')?.classList.add('active');
      }
    });

    // Leaderboard filter buttons
    const filterContainer = document.getElementById('leaderboard-filters-bar');
    filterContainer?.addEventListener('click', (e) => {
      const btn = e.target.closest('.lb-filter-btn');
      if (btn) {
        filterContainer.querySelectorAll('.lb-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeLeaderboardFilter = btn.dataset.filter || 'today';
        this.renderLeaderboard();
      }
    });

    // Create / Join Squad Buttons & Modal
    document.getElementById('btn-open-squad-modal')?.addEventListener('click', () => {
      document.getElementById('squad-manage-modal')?.classList.add('active');
    });

    document.getElementById('btn-close-squad-modal')?.addEventListener('click', () => {
      document.getElementById('squad-manage-modal')?.classList.remove('active');
    });

    // Close modal on clicking outside modal-box
    document.getElementById('squad-manage-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'squad-manage-modal') {
        document.getElementById('squad-manage-modal').classList.remove('active');
      }
    });

    // Create Squad Action
    document.getElementById('btn-create-squad-action')?.addEventListener('click', () => {
      const name = document.getElementById('input-new-squad-name')?.value.trim();
      if (name) {
        const newCode = 'FLOW-' + Math.floor(1000 + Math.random() * 9000);
        store.set(s => ({
          ...s,
          currentSquad: {
            id: 'sq-' + Date.now(),
            name: name,
            code: newCode,
            icon: '⚡',
            isJoined: true,
            members: [],
            feed: [],
            challenges: [
              {
                id: 'ch-1',
                title: `${name} Deep Work Sprint`,
                targetSeconds: 72000,
                currentSeconds: 0,
                daysLeft: 7,
                description: 'Collaborative focus sprint for squad members'
              }
            ]
          }
        }));
        document.getElementById('squad-manage-modal')?.classList.remove('active');
        const inputName = document.getElementById('input-new-squad-name');
        if (inputName) inputName.value = '';
        store.emit('show_toast', {
          type: 'success',
          message: `🚀 Created squad "${name}" with code ${newCode}!`
        });
      }
    });

    // Join Squad Action
    document.getElementById('btn-join-squad-action')?.addEventListener('click', () => {
      const code = document.getElementById('input-join-squad-code')?.value.trim().toUpperCase();
      if (code) {
        store.set(s => ({
          ...s,
          currentSquad: {
            id: 'sq-' + Date.now(),
            name: `Squad ${code}`,
            code: code,
            icon: '⚡',
            isJoined: true,
            members: [],
            feed: [],
            challenges: []
          }
        }));
        document.getElementById('squad-manage-modal')?.classList.remove('active');
        const inputCode = document.getElementById('input-join-squad-code');
        if (inputCode) inputCode.value = '';
        store.emit('show_toast', {
          type: 'success',
          message: `👥 Joined squad with code ${code}!`
        });
      }
    });

    // Leave Squad / Return to Personal Space Action
    document.getElementById('btn-leave-squad-action')?.addEventListener('click', () => {
      this.leaveSquad();
    });

    // Activity Feed Reactions Click Delegate
    document.getElementById('squad-activity-feed-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.reaction-btn');
      if (btn) {
        const actId = btn.dataset.actId;
        const emoji = btn.dataset.emoji;
        if (actId && emoji) {
          store.addFeedReaction(actId, emoji);
          this.spawnEmojiParticle(btn, emoji);
        }
      }
    });
  }

  leaveSquad() {
    store.set(s => ({
      ...s,
      currentSquad: {
        id: null,
        code: null,
        name: 'Personal Space',
        icon: '🧘',
        isJoined: false,
        members: [],
        feed: [],
        challenges: []
      }
    }));
    document.getElementById('squad-manage-modal')?.classList.remove('active');
    store.emit('show_toast', {
      type: 'info',
      message: '🧘 Returned to Personal Space (Solo Mode)'
    });
  }

  startLivePresenceTicker() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => {
      const squad = store.get().currentSquad;
      if (!squad || !squad.isJoined || !squad.members || squad.members.length === 0) return;

      let modified = false;
      squad.members.forEach(member => {
        if (member.status === 'deepwork' || member.status === 'break') {
          member.elapsedSeconds = (member.elapsedSeconds || 0) + 1;
          modified = true;
        }
      });

      if (modified) {
        this.renderPresenceGrid();
      }
    }, 1000);
  }

  renderAll() {
    this.renderHeader();
    this.renderPresenceGrid();
    this.renderLeaderboard();
    this.renderChallenges();
    this.renderActivityFeed();
  }

  renderHeader() {
    const squad = store.get().currentSquad;
    const isSquadJoined = squad && squad.isJoined && squad.id;

    const nameEl = document.getElementById('squad-banner-name');
    const iconEl = document.getElementById('squad-banner-icon');
    const codeEl = document.getElementById('squad-room-code-badge');
    const pillEl = document.getElementById('squad-active-pill');
    const modalBtnText = document.getElementById('squad-open-modal-text');

    // Deep view elements
    const deepName = document.getElementById('squad-deep-view-name');
    const deepCode = document.getElementById('squad-deep-code-badge');
    const deepMeta = document.getElementById('squad-deep-members-count');

    // Modal status elements
    const modalModeTitle = document.getElementById('squad-status-mode-title');
    const modalModeSub = document.getElementById('squad-status-mode-sub');
    const leaveBtn = document.getElementById('btn-leave-squad-action');

    if (isSquadJoined) {
      if (nameEl) nameEl.textContent = squad.name;
      if (iconEl) iconEl.textContent = squad.icon || '⚡';
      if (codeEl) {
        codeEl.textContent = squad.code;
        codeEl.title = 'Click to copy room code';
      }
      if (pillEl) {
        const count = (squad.members?.length || 0) + 1;
        pillEl.textContent = `${count} Live`;
      }
      if (modalBtnText) modalBtnText.textContent = 'Manage';

      if (deepName) deepName.textContent = squad.name;
      if (deepCode) deepCode.textContent = squad.code;
      if (deepMeta) deepMeta.textContent = `• ${(squad.members?.length || 0) + 1} Members`;

      if (modalModeTitle) modalModeTitle.innerHTML = `⚡ ${squad.name} <span style="color:#7C3AED;font-size:0.8rem;">(${squad.code})</span>`;
      if (modalModeSub) modalModeSub.textContent = 'Active Study Squad • Group sync active';
      if (leaveBtn) leaveBtn.style.display = 'inline-block';
    } else {
      if (nameEl) nameEl.textContent = 'Personal Space';
      if (iconEl) iconEl.textContent = '🧘';
      if (codeEl) {
        codeEl.textContent = 'Solo';
        codeEl.title = 'In Personal Space. Click to join a squad';
      }
      if (pillEl) pillEl.textContent = 'Solo';
      if (modalBtnText) modalBtnText.textContent = 'Join / Create';

      if (deepName) deepName.textContent = 'Personal Space';
      if (deepCode) deepCode.textContent = 'Solo Mode';
      if (deepMeta) deepMeta.textContent = '• Private Focus';

      if (modalModeTitle) modalModeTitle.textContent = '🧘 Personal Space (Solo)';
      if (modalModeSub) modalModeSub.textContent = 'Private focus space • No multiplayer distractions';
      if (leaveBtn) leaveBtn.style.display = 'none';
    }
  }

  renderPresenceGrid() {
    const container = document.getElementById('squad-presence-cards-grid');
    if (!container) return;

    const squad = store.get().currentSquad;
    const currentUser = store.get().currentUser;
    const isSquadJoined = squad && squad.isJoined && squad.id;

    if (!isSquadJoined || !squad.members || squad.members.length === 0) {
      // Personal space rendering - only user in their private flow zone
      container.innerHTML = `
        <div class="member-presence-card status-deepwork" style="border-radius: 1.1rem; padding: 0.9rem; background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(245,243,255,0.85)); border: 1px solid rgba(124, 58, 237, 0.15); box-shadow: 0 4px 16px rgba(124, 58, 237, 0.05);">
          <div class="member-card-header" style="margin-bottom: 0.6rem;">
            <div class="avatar-wrapper">
              <img src="${currentUser.avatar}" alt="${currentUser.name}" class="avatar-img" />
              <div class="presence-dot dot-deepwork" title="Personal Focus"></div>
            </div>
            <div class="member-name-block">
              <span class="member-name">${currentUser.name} (You)</span>
              <span class="member-role" style="color: #7C3AED; font-weight: 700;">🧘 Personal Space Active</span>
            </div>
          </div>
          
          <div class="member-task-info">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
              <span class="active-tag-badge">${currentUser.currentTag || '#Focus'}</span>
              <span class="member-elapsed-live" style="color: #6366F1; font-weight: 700;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Active
              </span>
            </div>
            <div class="member-task-title" style="font-size: 0.84rem; color: #1E1B4B; font-weight: 600;">${currentUser.currentTask || 'Deep Work Session'}</div>
          </div>

          <div style="margin-top: 0.75rem; padding-top: 0.65rem; border-top: 1px dashed rgba(203, 213, 225, 0.7); display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 0.75rem; color: #64748B;">No group distractions</span>
            <button class="btn-secondary btn-sm" id="btn-grid-join-squad" style="font-size: 0.74rem; padding: 0.25rem 0.6rem; border-radius: 0.6rem;">
              + Join Group
            </button>
          </div>
        </div>
      `;

      document.getElementById('btn-grid-join-squad')?.addEventListener('click', () => {
        document.getElementById('squad-manage-modal')?.classList.add('active');
      });
      return;
    }

    // Combine current user with other real members
    const allMembers = [
      {
        id: currentUser.id,
        name: currentUser.name + ' (You)',
        avatar: currentUser.avatar,
        status: 'deepwork',
        currentTask: currentUser.currentTask,
        currentTag: currentUser.currentTag,
        elapsedSeconds: Math.floor((currentUser.todayFocusSeconds || 0) % 3600)
      },
      ...squad.members
    ];

    container.innerHTML = allMembers.map(member => {
      const statusClass = member.status === 'deepwork' ? 'status-deepwork' : (member.status === 'break' ? 'status-break' : 'status-idle');
      const dotClass = member.status === 'deepwork' ? 'dot-deepwork' : (member.status === 'break' ? 'dot-break' : 'dot-idle');
      const statusLabel = member.status === 'deepwork' ? 'Deep Work' : (member.status === 'break' ? 'On Break' : 'Idle');

      const mins = Math.floor((member.elapsedSeconds || 0) / 60);
      const secs = (member.elapsedSeconds || 0) % 60;
      const elapsedDisplay = `${mins}m ${String(secs).padStart(2, '0')}s`;

      return `
        <div class="member-presence-card ${statusClass}">
          <div class="member-card-header">
            <div class="avatar-wrapper">
              <img src="${member.avatar}" alt="${member.name}" class="avatar-img" />
              <div class="presence-dot ${dotClass}" title="${statusLabel}"></div>
            </div>
            <div class="member-name-block">
              <span class="member-name">${member.name}</span>
              <span class="member-role">${statusLabel}</span>
            </div>
          </div>
          
          <div class="member-task-info">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span class="active-tag-badge">${member.currentTag || '#Focus'}</span>
              <span class="member-elapsed-live">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                ${elapsedDisplay}
              </span>
            </div>
            <div class="member-task-title" title="${member.currentTask}">${member.currentTask || 'Focus Session'}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderLeaderboard() {
    const listContainer = document.getElementById('squad-leaderboard-list');
    if (!listContainer) return;

    const squad = store.get().currentSquad;
    const currentUser = store.get().currentUser;
    const isSquadJoined = squad && squad.isJoined && squad.id;

    if (!isSquadJoined || !squad.members || squad.members.length === 0) {
      const todayHours = ((currentUser.todayFocusSeconds || 0) / 3600).toFixed(1);

      listContainer.innerHTML = `
        <div class="lb-row top-1" style="background: rgba(248, 250, 252, 0.9); border: 1px solid rgba(226, 232, 240, 0.8); border-radius: 0.9rem; padding: 0.75rem 0.9rem;">
          <div class="lb-left">
            <div class="lb-rank">👑</div>
            <div class="avatar-wrapper" style="width: 34px; height: 34px;">
              <img src="${currentUser.avatar}" alt="${currentUser.name}" class="avatar-img" />
            </div>
            <div>
              <div style="font-weight: 700; font-size: 0.88rem; color: #1E1B4B;">${currentUser.name} (You)</div>
              <div class="lb-sessions-count">🔥 ${currentUser.streakDays || 1}d streak • Solo Focus</div>
            </div>
          </div>
          <div style="text-align: right;">
            <div class="lb-hours" style="color: #7C3AED; font-weight: 800;">${todayHours}h</div>
            <div class="lb-sessions-count" style="font-size: 0.72rem; color: #64748B;">today</div>
          </div>
        </div>
        <div style="text-align: center; margin-top: 0.75rem; padding: 0.6rem; background: rgba(241, 245, 249, 0.6); border-radius: 0.75rem; font-size: 0.76rem; color: #64748B;">
          <span>Solo tracking mode. </span>
          <a href="javascript:void(0)" id="link-join-squad-lb" style="color: #7C3AED; font-weight: 700; text-decoration: underline;">Join a squad</a>
          <span> to view competitive rankings.</span>
        </div>
      `;

      document.getElementById('link-join-squad-lb')?.addEventListener('click', () => {
        document.getElementById('squad-manage-modal')?.classList.add('active');
      });
      return;
    }

    const filterKey = this.activeLeaderboardFilter === 'today' ? 'totalTodaySeconds'
      : (this.activeLeaderboardFilter === 'week' ? 'totalWeekSeconds' : 'totalAllTimeSeconds');

    const membersWithUser = [
      {
        id: currentUser.id,
        name: currentUser.name + ' (You)',
        avatar: currentUser.avatar,
        totalTodaySeconds: currentUser.todayFocusSeconds || 0,
        totalWeekSeconds: (currentUser.todayFocusSeconds || 0) + 42000,
        totalAllTimeSeconds: currentUser.totalFocusSeconds || 0,
        streakDays: currentUser.streakDays || 1,
        sessionsCount: Math.round((currentUser.todayFocusSeconds || 0) / 1800) + 12
      },
      ...squad.members
    ];

    // Sort descending by selected filter
    membersWithUser.sort((a, b) => (b[filterKey] || 0) - (a[filterKey] || 0));

    listContainer.innerHTML = membersWithUser.map((member, index) => {
      const rank = index + 1;
      const rankClass = rank === 1 ? 'top-1' : (rank === 2 ? 'top-2' : (rank === 3 ? 'top-3' : ''));
      const rankIcon = rank === 1 ? '👑' : (rank === 2 ? '🥈' : (rank === 3 ? '🥉' : `#${rank}`));

      const totalSec = member[filterKey] || 0;
      const hours = (totalSec / 3600).toFixed(1);

      return `
        <div class="lb-row ${rankClass}">
          <div class="lb-left">
            <div class="lb-rank">${rankIcon}</div>
            <div class="avatar-wrapper" style="width: 32px; height: 32px;">
              <img src="${member.avatar}" alt="${member.name}" class="avatar-img" />
            </div>
            <div>
              <div style="font-weight: 600; font-size: 0.88rem; color: #1E1B4B;">${member.name}</div>
              <div class="lb-sessions-count">🔥 ${member.streakDays || 1}d streak • ${member.sessionsCount || 1} sessions</div>
            </div>
          </div>
          <div style="text-align: right;">
            <div class="lb-hours" style="color: #7C3AED;">${hours}h</div>
            <div class="lb-sessions-count">${Math.floor(totalSec / 60)} mins</div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderChallenges() {
    const container = document.getElementById('squad-challenges-container');
    if (!container) return;

    const squad = store.get().currentSquad;
    const currentUser = store.get().currentUser;
    const isSquadJoined = squad && squad.isJoined && squad.id;
    const challenges = squad.challenges || [];

    if (!isSquadJoined || challenges.length === 0) {
      // Personal goal progress card
      const dailyGoal = currentUser.dailyGoalSeconds || 18000;
      const todayFocus = currentUser.todayFocusSeconds || 0;
      const pct = Math.min(100, Math.round((todayFocus / dailyGoal) * 100));
      const hoursDone = (todayFocus / 3600).toFixed(1);
      const hoursTarget = (dailyGoal / 3600).toFixed(1);

      container.innerHTML = `
        <div class="challenge-card" style="background: rgba(248, 250, 252, 0.85); border: 1px solid rgba(226, 232, 240, 0.9); border-radius: 1rem; padding: 1.1rem;">
          <div class="challenge-top" style="margin-bottom: 0.4rem;">
            <span class="challenge-title" style="font-weight: 700; color: #1E1B4B;">🎯 Personal Daily Focus Milestone</span>
            <span class="challenge-days-left" style="color: #7C3AED; font-weight: 600;">Active Today</span>
          </div>
          <div style="font-size: 0.82rem; color: #64748B; margin-bottom: 0.75rem;">Your daily focus target in personal space.</div>
          <div class="challenge-progress-bar" style="height: 8px; background: #E2E8F0; border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem;">
            <div class="challenge-progress-fill" style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #7C3AED, #6366F1); border-radius: 4px; transition: width 0.4s ease;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.76rem; color: #64748B;">
            <span>${hoursDone}h completed</span>
            <span style="font-weight: 700; color: #7C3AED;">${pct}% (${hoursTarget}h target)</span>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = challenges.map(ch => {
      const pct = Math.min(100, Math.round((ch.currentSeconds / ch.targetSeconds) * 100));
      const currentHours = (ch.currentSeconds / 3600).toFixed(1);
      const targetHours = (ch.targetSeconds / 3600).toFixed(0);

      return `
        <div class="challenge-card">
          <div class="challenge-top">
            <span class="challenge-title">${ch.title}</span>
            <span class="challenge-days-left">⏳ ${ch.daysLeft}d left</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${ch.description}</div>
          <div class="challenge-progress-bar">
            <div class="challenge-progress-fill" style="width: ${pct}%;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-dim);">
            <span>${currentHours}h completed</span>
            <span style="font-weight: 700; color: var(--accent-violet);">${pct}% (${targetHours}h goal)</span>
          </div>
        </div>
      `;
    }).join('');
  }

  renderActivityFeed() {
    const container = document.getElementById('squad-activity-feed-list');
    if (!container) return;

    const squad = store.get().currentSquad;
    const isSquadJoined = squad && squad.isJoined && squad.id;
    const feed = squad.feed || [];

    if (!isSquadJoined || feed.length === 0) {
      // Personal space activity: show recent personal focus sessions
      const recentSessions = store.get().recentSessions || [];
      if (recentSessions.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2rem 1rem; color: #94A3B8; font-size: 0.85rem;">
            🧘 No activity yet. Start your timer to log your first personal focus session.
          </div>
        `;
        return;
      }

      container.innerHTML = recentSessions.slice(0, 5).map(session => {
        const mins = Math.round(session.durationSeconds / 60);
        const dateStr = new Date(session.date).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `
          <div class="feed-item" style="padding: 0.85rem; border-radius: 0.85rem; background: rgba(248, 250, 252, 0.85); border: 1px solid rgba(226, 232, 240, 0.8); margin-bottom: 0.75rem;">
            <div class="feed-item-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
              <div class="feed-user" style="display: flex; align-items: center; gap: 0.5rem;">
                <span class="active-tag-badge">${session.tag || '#Focus'}</span>
                <span style="font-weight: 700; font-size: 0.85rem; color: #1E1B4B;">${mins} min session</span>
              </div>
              <span class="feed-time-ago" style="font-size: 0.74rem; color: #94A3B8;">${dateStr}</span>
            </div>
            <div style="font-size: 0.82rem; color: #475569; font-weight: 500;">"${session.taskName}"</div>
            ${session.notes ? `<div style="font-size: 0.76rem; color: #64748B; margin-top: 0.25rem;">${session.notes}</div>` : ''}
          </div>
        `;
      }).join('');
      return;
    }

    container.innerHTML = feed.map(item => {
      const minsAgo = Math.max(1, Math.round((Date.now() - item.timestamp) / 60000));
      const timeDisplay = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.round(minsAgo / 60)}h ago`;

      const reactions = item.reactions || {};
      const emojis = ['🔥', '👏', '⚡', '☕', '🧠'];

      const reactionButtons = emojis.map(emoji => {
        const count = reactions[emoji] || 0;
        return `
          <button class="reaction-btn ${count > 0 ? 'user-reacted' : ''}" data-act-id="${item.id}" data-emoji="${emoji}">
            <span>${emoji}</span>
            <span>${count}</span>
          </button>
        `;
      }).join('');

      return `
        <div class="feed-item">
          <div class="feed-item-header">
            <div class="feed-user">
              <img src="${item.userAvatar}" alt="${item.userName}" style="width: 22px; height: 22px; border-radius: 50%;" />
              <span>${item.userName}</span>
              <span class="active-tag-badge">${item.tag}</span>
            </div>
            <span class="feed-time-ago">${timeDisplay}</span>
          </div>
          <div class="feed-task-details">
            <div style="font-weight: 600; color: #1E1B4B;">Clocked ${item.durationMinutes}m focus</div>
            <div style="color: var(--text-muted); font-size: 0.82rem; margin-top: 2px;">"${item.taskName}"</div>
          </div>
          <div class="feed-reactions-row">
            ${reactionButtons}
          </div>
        </div>
      `;
    }).join('');
  }

  spawnEmojiParticle(buttonEl, emoji) {
    const rect = buttonEl.getBoundingClientRect();
    const particle = document.createElement('div');
    particle.textContent = emoji;
    particle.style.position = 'fixed';
    particle.style.left = `${rect.left + 10}px`;
    particle.style.top = `${rect.top}px`;
    particle.style.fontSize = '1.4rem';
    particle.style.pointerEvents = 'none';
    particle.style.zIndex = '9999';
    particle.style.transition = 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    document.body.appendChild(particle);

    requestAnimationFrame(() => {
      particle.style.transform = `translate(${Math.random() * 40 - 20}px, -45px) scale(1.4)`;
      particle.style.opacity = '0';
    });

    setTimeout(() => particle.remove(), 800);
  }
}

export const squad = new SquadEngine();
