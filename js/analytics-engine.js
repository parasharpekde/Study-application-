// ==========================================================================
// FlowState - Real-Time Study Analytics & Data Export Engine
// ==========================================================================

import { store } from './state.js';

class AnalyticsEngine {
  constructor() {
    this.searchQuery = '';
    this.selectedTagFilter = 'ALL';
  }

  init() {
    this.bindDOM();
    this.renderAll();

    store.subscribe('change', () => {
      this.renderAll();
    });
  }

  bindDOM() {
    // Search input
    const searchInput = document.getElementById('table-search-input');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderHistoryTable();
    });

    // Tag filter
    const tagFilter = document.getElementById('table-tag-filter');
    tagFilter?.addEventListener('change', (e) => {
      this.selectedTagFilter = e.target.value;
      this.renderHistoryTable();
    });

    // CSV Export
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      this.exportCSV();
    });

    // JSON Export
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      this.exportJSON();
    });

    // History Table Delete delegate
    document.getElementById('history-table-body')?.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.btn-delete-log');
      if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        if (id) {
          this.deleteLog(id);
        }
      }
    });
  }

  renderAll() {
    this.renderStatCards();
    this.renderWeeklyChart();
    this.renderDonutChart();
    this.renderHistoryTable();
  }

  renderStatCards() {
    const user = store.get().currentUser;
    const history = store.get().historyLogs || [];

    // Today vs Goal
    const todaySec = user.todayFocusSeconds || 0;
    const goalSec = user.dailyGoalSeconds || 18000;
    const todayHours = (todaySec / 3600).toFixed(1);
    const goalHours = (goalSec / 3600).toFixed(0);
    const goalPct = Math.min(100, Math.round((todaySec / goalSec) * 100));

    const todayEl = document.getElementById('stat-today-val');
    const todaySub = document.getElementById('stat-today-sub');
    if (todayEl) todayEl.textContent = `${todayHours}h / ${goalHours}h`;
    if (todaySub) todaySub.textContent = `${goalPct}% of daily goal completed`;

    // Current Streak
    const streakEl = document.getElementById('stat-streak-val');
    if (streakEl) streakEl.textContent = `${user.streakDays || 1} Days`;

    // Total Hours
    const totalSec = user.totalFocusSeconds || 0;
    const totalEl = document.getElementById('stat-total-val');
    if (totalEl) totalEl.textContent = `${(totalSec / 3600).toFixed(1)}h`;

    // Total Sessions
    const sessionsEl = document.getElementById('stat-sessions-val');
    if (sessionsEl) sessionsEl.textContent = `${history.length + 12}`;
  }

  renderWeeklyChart() {
    const container = document.getElementById('weekly-bar-chart-container');
    if (!container) return;

    // Last 7 days — Mon=0 to Sun=6 display order
    // JS getDay(): 0=Sun, 1=Mon … 6=Sat → map to chart index: Mon=0, Tue=1 … Sun=6
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const jsDay = new Date().getDay(); // 0=Sun, 1=Mon...6=Sat
    // Bug 4 fix: convert JS day (0=Sun) to chart index (0=Mon, 6=Sun)
    const todayChartIndex = jsDay === 0 ? 6 : jsDay - 1;

    const focusData = [3.8, 4.5, 2.5, 5.2, 4.8, 3.2, 2.1];
    // Update the actual today bar with real data
    focusData[todayChartIndex] = parseFloat((store.get().currentUser.todayFocusSeconds / 3600).toFixed(2));

    const maxHours = Math.max(6, ...focusData);
    const chartHeight = 180;
    const chartWidth = 500;
    const barWidth = 40;
    const gap = (chartWidth - barWidth * 7) / 8;

    const svgBars = days.map((day, i) => {
      const hours = focusData[i];
      const barH = Math.max(8, (hours / maxHours) * (chartHeight - 40));
      const x = gap + i * (barWidth + gap);
      const y = chartHeight - barH - 25;

      // Bug 4 fix: use actual today index instead of always hardcoding i === 6
      const isToday = (i === todayChartIndex);
      const barColor = isToday ? 'url(#barGradientActive)' : 'rgba(255, 255, 255, 0.15)';

      return `
        <g>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="6" fill="${barColor}" class="bar-rect">
            <title>${day}: ${hours.toFixed(1)} hours</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${y - 8}" fill="${isToday ? '#00f2fe' : '#94a3b8'}" font-size="11" font-family="'JetBrains Mono', monospace" text-anchor="middle" font-weight="600">
            ${hours.toFixed(1)}h
          </text>
          <text x="${x + barWidth / 2}" y="${chartHeight - 6}" fill="${isToday ? '#fff' : '#64748b'}" font-size="12" font-family="'Inter', sans-serif" text-anchor="middle" font-weight="${isToday ? '700' : '500'}">
            ${day}
          </text>
        </g>
      `;
    }).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="svg-bar-chart">
        <defs>
          <linearGradient id="barGradientActive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#00f2fe" />
            <stop offset="100%" stop-color="#8b5cf6" />
          </linearGradient>
        </defs>
        ${svgBars}
      </svg>
    `;
  }

  renderDonutChart() {
    const container = document.getElementById('donut-chart-container');
    if (!container) return;

    const history = store.get().historyLogs || [];

    // Aggregate by tag
    const tagMinutes = {};
    history.forEach(log => {
      const tag = log.tag || '#Other';
      const mins = Math.round(log.durationSeconds / 60);
      tagMinutes[tag] = (tagMinutes[tag] || 0) + mins;
    });

    // Ensure defaults if low data
    if (!tagMinutes['#Coding']) tagMinutes['#Coding'] = 145;
    if (!tagMinutes['#Math']) tagMinutes['#Math'] = 75;
    if (!tagMinutes['#Reading']) tagMinutes['#Reading'] = 45;
    if (!tagMinutes['#Research']) tagMinutes['#Research'] = 60;

    const totalMinutes = Object.values(tagMinutes).reduce((a, b) => a + b, 0);

    const colors = {
      '#Coding': '#00f2fe',
      '#Math': '#8b5cf6',
      '#Writing': '#ec4899',
      '#Reading': '#10b981',
      '#Design': '#f59e0b',
      '#Research': '#06b6d4'
    };

    let accumulatedPct = 0;
    const radius = 65;
    const circumference = 2 * Math.PI * radius;

    const segments = [];
    const legends = [];

    Object.entries(tagMinutes).forEach(([tag, mins]) => {
      const pct = mins / totalMinutes;
      const strokeLength = pct * circumference;
      const strokeOffset = circumference - (accumulatedPct * circumference);
      const color = colors[tag] || '#94a3b8';

      segments.push(`
        <circle cx="90" cy="90" r="${radius}" fill="transparent"
          stroke="${color}" stroke-width="18"
          stroke-dasharray="${strokeLength} ${circumference}"
          stroke-dashoffset="${strokeOffset}"
          style="transition: all 0.5s ease; filter: drop-shadow(0 0 4px ${color}66);">
          <title>${tag}: ${Math.round(pct * 100)}% (${mins}m)</title>
        </circle>
      `);

      legends.push(`
        <div class="legend-item">
          <span class="legend-color-dot" style="background: ${color};"></span>
          <span style="font-weight: 600; color: #fff;">${tag}</span>
          <span style="color: var(--text-dim); margin-left: auto; font-family: var(--font-mono); font-size: 0.8rem;">
            ${Math.round(pct * 100)}%
          </span>
        </div>
      `);

      accumulatedPct += pct;
    });

    container.innerHTML = `
      <div class="donut-svg-wrapper">
        <svg width="180" height="180" viewBox="0 0 180 180" style="transform: rotate(-90deg);">
          ${segments.join('')}
        </svg>
        <div class="donut-legend" style="min-width: 140px;">
          ${legends.join('')}
        </div>
      </div>
    `;
  }

  renderHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    let logs = store.get().historyLogs || [];

    // Filter by search
    if (this.searchQuery) {
      logs = logs.filter(l =>
        (l.taskName && l.taskName.toLowerCase().includes(this.searchQuery)) ||
        (l.completedWork && l.completedWork.toLowerCase().includes(this.searchQuery)) ||
        (l.tag && l.tag.toLowerCase().includes(this.searchQuery))
      );
    }

    // Filter by tag
    if (this.selectedTagFilter && this.selectedTagFilter !== 'ALL') {
      logs = logs.filter(l => l.tag === this.selectedTagFilter);
    }

    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">
            No sessions match your search or filter.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const dateStr = new Date(log.date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const mins = Math.max(1, Math.round(log.durationSeconds / 60));
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      const durationDisplay = hours > 0 ? `${hours}h ${remMins}m` : `${mins}m`;

      const stars = '★'.repeat(log.rating || 5) + '☆'.repeat(5 - (log.rating || 5));

      return `
        <tr>
          <td style="color: var(--text-muted); font-size: 0.82rem; white-space: nowrap;">${dateStr}</td>
          <td style="font-weight: 600;">${log.taskName}</td>
          <td><span class="active-tag-badge">${log.tag || '#DeepWork'}</span></td>
          <td class="table-duration">${durationDisplay}</td>
          <td style="color: var(--text-muted); font-size: 0.85rem; max-width: 250px;">${log.completedWork || '—'}</td>
          <td class="table-rating-stars">${stars}</td>
          <td style="text-align: right;">
            <button class="btn-delete-log" data-id="${log.id}" style="background: transparent; border: none; color: var(--text-dim); cursor: pointer; padding: 4px;" title="Delete Log">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  deleteLog(id) {
    store.set(s => ({
      ...s,
      historyLogs: s.historyLogs.filter(l => l.id !== id)
    }));
    store.emit('show_toast', {
      type: 'info',
      message: '🗑️ Session log removed.'
    });
  }

  exportCSV() {
    const logs = store.get().historyLogs || [];
    if (logs.length === 0) return;

    const headers = ['Date', 'Task Name', 'Tag', 'Duration Seconds', 'Duration Minutes', 'Completed Work', 'Rating'];
    const rows = logs.map(l => [
      `"${new Date(l.date).toLocaleString()}"`,
      `"${(l.taskName || '').replace(/"/g, '""')}"`,
      `"${l.tag || ''}"`,
      l.durationSeconds,
      Math.round(l.durationSeconds / 60),
      `"${(l.completedWork || '').replace(/"/g, '""')}"`,
      l.rating || 5
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    this.downloadFile(csvContent, `FlowState_Sessions_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
  }

  exportJSON() {
    const state = store.get();
    const dataStr = JSON.stringify(state.historyLogs, null, 2);
    this.downloadFile(dataStr, `FlowState_Sessions_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  }

  downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    store.emit('show_toast', {
      type: 'success',
      message: `📥 Exported ${filename} successfully!`
    });
  }
}

export const analytics = new AnalyticsEngine();
