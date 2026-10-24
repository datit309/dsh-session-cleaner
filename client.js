/**
 * DSH Session Cleaner & Doctor - Web Client UI
 * Injects into DSH Right Sidebar and Header Actions
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-cleaner',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TAB_ID = 'dsh-session-cleaner';
    const TAB_KIND = 'session-doctor';

    let globalCtx = null;
    let sharedScanData = { sessions: [], stuckCount: 0, totalCount: 0, loading: false };
    const scanListeners = new Set();

    function notifyScan() {
      for (const fn of scanListeners) {
        try { fn(); } catch (e) { console.warn('[session-cleaner] listener error:', e); }
      }
    }

    async function triggerScan() {
      sharedScanData.loading = true;
      notifyScan();
      try {
        const res = await fetch('/api/session-cleaner/scan');
        if (res.ok) {
          const json = await res.json();
          if (json.ok) {
            sharedScanData = {
              sessions: json.sessions || [],
              stuckCount: json.stuckCount || 0,
              totalCount: json.totalCount || 0,
              loading: false,
              lastScanTime: Date.now()
            };
            notifyScan();
            return;
          }
        }
      } catch (err) {
        console.warn('[session-cleaner] scan error:', err);
      }
      sharedScanData.loading = false;
      notifyScan();
    }

    // Auto scan on initial boot
    setTimeout(() => { triggerScan(); }, 1500);

    // CSS Stylesheet
    const STYLE_ID = 'dsh-session-cleaner-styles';
    if (!document.getElementById(STYLE_ID)) {
      const styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = `
        .dsc-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          font-family: var(--ds-font-family-base, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
          color: var(--ds-color-text, #1e293b);
          background: var(--ds-color-bg, #ffffff);
          overflow: hidden;
          font-size: 12px;
        }

        .dsc-header {
          padding: 12px 14px;
          border-bottom: 1px solid var(--ds-color-border, #e2e8f0);
          background: var(--ds-color-surface, #f8fafc);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .dsc-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .dsc-title {
          font-weight: 700;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .dsc-stats-badge {
          font-size: 11px;
          padding: 2px 7px;
          border-radius: 999px;
          font-weight: 600;
        }
        .dsc-stats-badge.has-stuck {
          background: #fee2e2;
          color: #dc2626;
          border: 1px solid #fca5a5;
          animation: dsc-pulse 2s infinite;
        }
        .dsc-stats-badge.healthy {
          background: #dcfce7;
          color: #16a34a;
          border: 1px solid #86efac;
        }

        @keyframes dsc-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
        }

        .dsc-btn-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .dsc-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 5px 10px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s ease;
        }
        .dsc-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .dsc-btn-primary {
          background: #ef4444;
          color: #ffffff;
        }
        .dsc-btn-primary:hover:not(:disabled) {
          background: #dc2626;
        }

        .dsc-btn-secondary {
          background: var(--ds-color-bg, #ffffff);
          color: var(--ds-color-text, #334155);
          border-color: var(--ds-color-border, #cbd5e1);
        }
        .dsc-btn-secondary:hover:not(:disabled) {
          background: var(--ds-color-surface, #f1f5f9);
        }

        .dsc-btn-unstick {
          background: #0284c7;
          color: #ffffff;
        }
        .dsc-btn-unstick:hover:not(:disabled) {
          background: #0369a1;
        }

        .dsc-btn-delete {
          background: #fee2e2;
          color: #b91c1c;
          border-color: #fca5a5;
        }
        .dsc-btn-delete:hover:not(:disabled) {
          background: #fecaca;
        }

        .dsc-filter-bar {
          display: flex;
          align-items: center;
          padding: 6px 14px;
          gap: 6px;
          border-bottom: 1px solid var(--ds-color-border, #e2e8f0);
          background: var(--ds-color-bg, #ffffff);
        }

        .dsc-tab-btn {
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          border: none;
          background: transparent;
          color: var(--ds-color-text-subtle, #64748b);
        }
        .dsc-tab-btn.active {
          background: var(--ds-color-surface, #e2e8f0);
          color: var(--ds-color-text, #0f172a);
        }

        .dsc-list {
          flex: 1;
          overflow-y: auto;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .dsc-card {
          border-radius: 6px;
          border: 1px solid var(--ds-color-border, #cbd5e1);
          background: var(--ds-color-bg, #ffffff);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          transition: border-color 0.15s ease;
        }
        .dsc-card.stuck {
          border-color: #f87171;
          background: rgba(254, 242, 242, 0.4);
        }

        .dsc-card-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }

        .dsc-card-title {
          font-weight: 600;
          font-size: 12px;
          color: var(--ds-color-text, #0f172a);
          line-height: 1.35;
          word-break: break-word;
        }

        .dsc-badge-stuck {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          background: #ef4444;
          color: #ffffff;
          white-space: nowrap;
        }

        .dsc-badge-ok {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          background: #10b981;
          color: #ffffff;
          white-space: nowrap;
        }

        .dsc-card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 10.5px;
          color: var(--ds-color-text-subtle, #64748b);
        }

        .dsc-error-box {
          margin-top: 2px;
          padding: 6px 8px;
          border-radius: 4px;
          background: #fee2e2;
          color: #991b1b;
          font-family: var(--ds-font-family-code, monospace);
          font-size: 10px;
          line-height: 1.4;
          word-break: break-word;
          max-height: 80px;
          overflow-y: auto;
          border: 1px solid #fca5a5;
        }

        .dsc-card-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          margin-top: 4px;
        }
      `;
      document.head.appendChild(styleEl);
    }

    function formatBytes(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    }

    function formatTimeAgo(ts) {
      if (!ts) return '';
      const diff = Math.floor((Date.now() - ts) / 1000);
      if (diff < 60) return `${diff}s trước`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m trước`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
      return `${Math.floor(diff / 86400)}d trước`;
    }

    function SessionCleanerTitle() {
      const [scanData, setScanData] = React.useState(sharedScanData);

      React.useEffect(() => {
        const fn = () => setScanData({ ...sharedScanData });
        scanListeners.add(fn);
        return () => scanListeners.delete(fn);
      }, []);

      const hasStuck = scanData.stuckCount > 0;
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
        h('span', { style: { fontSize: '13px' } }, hasStuck ? '🚨' : '🩺'),
        h('span', { style: { fontWeight: 600, fontSize: '12px' } }, 'Session Doctor'),
        hasStuck && h('span', {
          style: {
            background: '#ef4444',
            color: '#fff',
            borderRadius: '999px',
            padding: '1px 5px',
            fontSize: '10px',
            fontWeight: 700
          }
        }, scanData.stuckCount)
      );
    }

    function SessionCleanerPane() {
      const [scanData, setScanData] = React.useState(sharedScanData);
      const [filter, setFilter] = React.useState('stuck'); // 'stuck' | 'all'
      const [actionLoading, setActionLoading] = React.useState(null);

      React.useEffect(() => {
        const fn = () => setScanData({ ...sharedScanData });
        scanListeners.add(fn);
        return () => scanListeners.delete(fn);
      }, []);

      const handleUnstick = async (sessionId) => {
        if (!confirm(`Cứu session này bằng cách rollback lại lượt lỗi cuối?\nBạn sẽ có thể chat tiếp bình thường.`)) return;
        setActionLoading(sessionId);
        try {
          const res = await fetch('/api/session-cleaner/unstick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          });
          const json = await res.json();
          if (json.ok) {
            alert(`✅ ${json.message || 'Cứu session thành công!'}`);
            await triggerScan();
          } else {
            alert(`❌ Lỗi: ${json.error}`);
          }
        } catch (e) {
          alert(`❌ Lỗi kết nối: ${e.message}`);
        }
        setActionLoading(null);
      };

      const handleDelete = async (sessionId) => {
        if (!confirm(`Xác nhận xóa vĩnh viễn session:\n${sessionId}?\nThao tác này không thể hoàn tác.`)) return;
        setActionLoading(sessionId);
        try {
          const res = await fetch('/api/session-cleaner/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          });
          const json = await res.json();
          if (json.ok) {
            await triggerScan();
          } else {
            alert(`❌ Lỗi xóa: ${json.error}`);
          }
        } catch (e) {
          alert(`❌ Lỗi kết nối: ${e.message}`);
        }
        setActionLoading(null);
      };

      const handleDeleteAllStuck = async () => {
        if (!confirm(`Xác nhận xóa TẤT CẢ ${scanData.stuckCount} sessions đang bị kẹt lỗi 400?`)) return;
        setActionLoading('all');
        try {
          const res = await fetch('/api/session-cleaner/delete-stuck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          const json = await res.json();
          if (json.ok) {
            alert(`🎉 Đã xóa thành công ${json.deletedCount} sessions bị kẹt!`);
            await triggerScan();
          } else {
            alert(`❌ Lỗi: ${json.error}`);
          }
        } catch (e) {
          alert(`❌ Lỗi kết nối: ${e.message}`);
        }
        setActionLoading(null);
      };

      const sessions = scanData.sessions || [];
      const displayed = filter === 'stuck' ? sessions.filter(s => s.isStuck) : sessions;

      return h('div', { className: 'dsc-container' },
        // Header
        h('div', { className: 'dsc-header' },
          h('div', { className: 'dsc-title-row' },
            h('div', { className: 'dsc-title' },
              h('span', null, '🩺'),
              h('span', null, 'Session Doctor & Cleaner')
            ),
            h('span', {
              className: `dsc-stats-badge ${scanData.stuckCount > 0 ? 'has-stuck' : 'healthy'}`
            }, scanData.stuckCount > 0 ? `🚨 ${scanData.stuckCount} Bị Kẹt` : '✨ 0 Lỗi')
          ),
          h('div', { className: 'dsc-btn-row' },
            h('button', {
              className: 'dsc-btn dsc-btn-secondary',
              onClick: () => triggerScan(),
              disabled: scanData.loading || actionLoading !== null
            }, scanData.loading ? '⏳ Đang quét...' : '🔄 Quét lại'),
            scanData.stuckCount > 0 && h('button', {
              className: 'dsc-btn dsc-btn-primary',
              onClick: handleDeleteAllStuck,
              disabled: scanData.loading || actionLoading !== null
            }, `🧹 Xóa hết ${scanData.stuckCount} session kẹt`)
          )
        ),

        // Filter Bar
        h('div', { className: 'dsc-filter-bar' },
          h('button', {
            className: `dsc-tab-btn ${filter === 'stuck' ? 'active' : ''}`,
            onClick: () => setFilter('stuck')
          }, `🚨 Bị kẹt (${scanData.stuckCount})`),
          h('button', {
            className: `dsc-tab-btn ${filter === 'all' ? 'active' : ''}`,
            onClick: () => setFilter('all')
          }, `Tất cả (${scanData.totalCount})`)
        ),

        // Session List
        h('div', { className: 'dsc-list' },
          displayed.length === 0 ? h('div', {
            style: { textAlign: 'center', padding: '40px 10px', color: '#64748b' }
          }, filter === 'stuck' ? '🎉 Tuyệt vời! Không có session nào bị kẹt lỗi.' : 'Không có session nào.') :
          displayed.map(s => {
            const isLoading = actionLoading === s.id || actionLoading === 'all';
            return h('div', {
              key: s.id,
              className: `dsc-card ${s.isStuck ? 'stuck' : ''}`
            },
              h('div', { className: 'dsc-card-top' },
                h('div', { className: 'dsc-card-title' }, s.title || 'Untitled Session'),
                h('span', {
                  className: s.isStuck ? 'dsc-badge-stuck' : 'dsc-badge-ok'
                }, s.isStuck ? 'STUCK' : 'OK')
              ),
              h('div', { className: 'dsc-card-meta' },
                h('span', null, `📁 ${s.workspaceTitle || s.workspaceKey}`),
                h('span', null, `💬 ${s.turnCount} turns`),
                h('span', null, `📦 ${formatBytes(s.fileSize)}`),
                h('span', null, `🕒 ${formatTimeAgo(s.updatedAt)}`)
              ),
              s.isStuck && s.stuckReason && h('div', {
                className: 'dsc-error-box',
                title: s.stuckReason
              }, `⚠️ ${s.stuckReason}`),
              h('div', { className: 'dsc-card-actions' },
                s.isStuck && h('button', {
                  className: 'dsc-btn dsc-btn-unstick',
                  onClick: () => handleUnstick(s.id),
                  disabled: isLoading
                }, isLoading ? '...' : '🩹 Cứu session'),
                h('button', {
                  className: 'dsc-btn dsc-btn-delete',
                  onClick: () => handleDelete(s.id),
                  disabled: isLoading
                }, isLoading ? '...' : '🗑️ Xóa')
              )
            );
          })
        )
      );
    }

    function HeaderDoctorButton(props) {
      const sessionId = props && props.sessionId;
      const [scanData, setScanData] = React.useState(sharedScanData);

      React.useEffect(() => {
        const fn = () => setScanData({ ...sharedScanData });
        scanListeners.add(fn);
        return () => scanListeners.delete(fn);
      }, []);

      const hasStuck = scanData.stuckCount > 0;

      const openTab = () => {
        if (!globalCtx || !globalCtx.sidebarRight) return;
        const targetSid = sessionId || (typeof globalCtx.sidebarRight.mounted?.getSnapshot === 'function' ? globalCtx.sidebarRight.mounted.getSnapshot() : null);
        try {
          if (targetSid && typeof globalCtx.sidebarRight.openTabIn === 'function') {
            globalCtx.sidebarRight.openTabIn(targetSid, TAB_KIND);
          } else if (typeof globalCtx.sidebarRight.openTab === 'function') {
            globalCtx.sidebarRight.openTab(TAB_KIND);
          }
          if (targetSid && typeof globalCtx.sidebarRight.actionsFor === 'function') {
            const acts = globalCtx.sidebarRight.actionsFor(targetSid);
            if (acts && typeof acts.setExpanded === 'function') {
              acts.setExpanded(targetSid, true);
            }
          }
        } catch (e) {
          console.warn('[session-cleaner] open sidebar tab error:', e);
        }
      };

      return h('button', {
        type: 'button',
        title: hasStuck ? `Có ${scanData.stuckCount} session bị kẹt! Bấm để mở Session Doctor` : 'Mở Session Doctor & Cleaner',
        onClick: openTab,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '2px 8px',
          borderRadius: '5px',
          border: hasStuck ? '1px solid #ef4444' : '1px solid rgba(16, 185, 129, 0.4)',
          background: hasStuck ? '#fee2e2' : 'rgba(16, 185, 129, 0.15)',
          color: hasStuck ? '#dc2626' : '#059669',
          fontSize: '11px',
          fontWeight: 600,
          cursor: 'pointer'
        }
      },
        h('span', null, hasStuck ? '🚨' : '🩺'),
        h('span', null, hasStuck ? `${scanData.stuckCount} Session Kẹt` : 'Session Doctor')
      );
    }

    return {
      inject: ['sidebarRight', 'sidebarRightTabs', 'slots'],
      apply(ctx) {
        globalCtx = ctx;

        // 1. Register Tab into Sidebar Right
        if (ctx.sidebarRightTabs && typeof ctx.sidebarRightTabs.register === 'function') {
          ctx.effect(() => {
            return ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'builtin',
              title: () => 'Session Doctor',
              guide: [{
                id: 'session-doctor',
                order: 3,
                title: () => 'Session Doctor',
                description: () => 'Unstick & Clean Corrupted Sessions'
              }]
            });
          }, 'dsh-session-cleaner: tab registration');
        }

        // 2. Register Tab Body
        ctx.effect(() => {
          return ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID
          }, SessionCleanerPane));
        }, 'dsh-session-cleaner: pane slot');

        // 3. Register Tab Title
        ctx.effect(() => {
          return ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID
          }, SessionCleanerTitle));
        }, 'dsh-session-cleaner: title slot');

        // 4. Register Header Action Button
        ctx.effect(() => {
          return ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'session-doctor-button',
            order: 26
          }, HeaderDoctorButton));
        }, 'dsh-session-cleaner: header action slot');
      }
    };
  }
});
