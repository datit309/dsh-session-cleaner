/**
 * DSH Session Cleaner & Doctor Plugin
 * Auto-detect, unstick, and safely manage sessions in DeepSeek Harness.
 *
 * @module dsh-session-cleaner
 */

import {
  scanAllSessions,
  deleteSession,
  trashAllStuck,
  unstickSession,
  inspectSession,
  backupSession,
  listBackups,
  restoreBackup,
  listTrash,
  restoreFromTrash,
  emptyTrash
} from './lib/session-engine.js';

export const name = 'dsh-session-cleaner';
export const inject = [];

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

export function apply(ctx) {
  // 1. Register Web API Endpoints
  if (ctx.inject) {
    ctx.inject(['webServer'], (scope) => {
      scope.effect(() => {
        // GET /api/session-cleaner/scan
        const d1 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/scan',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'GET') {
              try {
                const data = scanAllSessions();
                const trash = listTrash();
                const backups = listBackups();
                sendJson(res, 200, {
                  ok: true,
                  ...data,
                  trashCount: trash.length,
                  backupCount: backups.length
                });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/delete (Safe move to trash)
        const d2 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/delete',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const { sessionId } = await readJsonBody(req);
                if (!sessionId) {
                  return sendJson(res, 400, { ok: false, error: 'Missing sessionId' });
                }
                const result = deleteSession(sessionId, ctx);
                sendJson(res, 200, { ok: true, ...result });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/delete-stuck (Safe move all stuck to trash)
        const d3 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/delete-stuck',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const result = trashAllStuck(ctx);
                sendJson(res, 200, { ok: true, ...result });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/unstick
        const d4 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/unstick',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const { sessionId, targetTurn } = await readJsonBody(req);
                if (!sessionId) {
                  return sendJson(res, 400, { ok: false, error: 'Missing sessionId' });
                }
                const result = unstickSession(sessionId, targetTurn || null, ctx);
                sendJson(res, 200, { ok: true, ...result });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // GET /api/session-cleaner/trash
        const d5 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/trash',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'GET') {
              try {
                const items = listTrash();
                sendJson(res, 200, { ok: true, items });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/restore-trash
        const d6 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/restore-trash',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const { sessionId } = await readJsonBody(req);
                if (!sessionId) {
                  return sendJson(res, 400, { ok: false, error: 'Missing sessionId' });
                }
                const result = restoreFromTrash(sessionId, ctx);
                sendJson(res, 200, { ok: true, ...result });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/empty-trash
        const d7 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/empty-trash',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const result = emptyTrash();
                sendJson(res, 200, { ok: true, ...result });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // GET /api/session-cleaner/backups
        const d8 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/backups',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'GET') {
              try {
                const url = new URL(req.url, 'http://127.0.0.1:3080');
                const sessionId = url.searchParams.get('sessionId') || null;
                const items = listBackups(sessionId);
                sendJson(res, 200, { ok: true, items });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/backup (Create manual backup)
        const d9 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/backup',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const { sessionId, reason } = await readJsonBody(req);
                if (!sessionId) {
                  return sendJson(res, 400, { ok: false, error: 'Missing sessionId' });
                }
                const result = backupSession(sessionId, reason || 'manual_ui');
                sendJson(res, 200, { ok: true, ...result });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/restore-backup
        const d10 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/restore-backup',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const { sessionId, timestamp } = await readJsonBody(req);
                if (!sessionId) {
                  return sendJson(res, 400, { ok: false, error: 'Missing sessionId' });
                }
                const result = restoreBackup(sessionId, timestamp || null, ctx);
                sendJson(res, 200, { ok: true, ...result });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        return () => {
          if (typeof d1 === 'function') d1();
          if (typeof d2 === 'function') d2();
          if (typeof d3 === 'function') d3();
          if (typeof d4 === 'function') d4();
          if (typeof d5 === 'function') d5();
          if (typeof d6 === 'function') d6();
          if (typeof d7 === 'function') d7();
          if (typeof d8 === 'function') d8();
          if (typeof d9 === 'function') d9();
          if (typeof d10 === 'function') d10();
        };
      }, 'dsh-session-cleaner: web routes');
    });

    // 2. Register Tool for AI Agents
    ctx.inject(['tools'], (scope) => {
      scope.effect(() => {
        return scope.tools.register({
          name: 'session_cleaner',
          description: 'Quản lý, chẩn đoán, cứu (unstick rollback an toàn), sao lưu (backup) và phục hồi session trong DeepSeek Harness.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['scan', 'unstick', 'trash', 'trash_all_stuck', 'restore_trash', 'list_trash', 'backup', 'restore_backup', 'list_backups', 'inspect'],
                description: 'Thao tác: scan, unstick (cứu session), trash (chuyển vào thùng rác), trash_all_stuck (bỏ tất cả kẹt vào thùng rác), restore_trash (phục hồi từ thùng rác), list_trash, backup, restore_backup, list_backups, inspect.'
              },
              session_id: {
                type: 'string',
                description: 'ID của session cần xử lý.'
              },
              target_turn: {
                type: 'number',
                description: 'Lượt turn muốn rollback về (tùy chọn, mặc định rollback về turn thành công cuối).'
              },
              backup_timestamp: {
                type: 'number',
                description: 'Timestamp của bản backup cần phục hồi.'
              }
            },
            required: ['action']
          },
          output: {
            schema: { type: 'json' },
            render: (val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 2) }]
          },
          execute: async (args) => {
            switch (args.action) {
              case 'scan': {
                const data = scanAllSessions();
                const trash = listTrash();
                const backups = listBackups();
                return {
                  totalCount: data.totalCount,
                  stuckCount: data.stuckCount,
                  trashCount: trash.length,
                  backupCount: backups.length,
                  stuckSessions: data.sessions.filter(s => s.isStuck).map(s => ({
                    id: s.id,
                    title: s.title,
                    turnCount: s.turnCount,
                    workspace: s.workspaceTitle || s.workspaceKey,
                    error: s.stuckReason,
                    suggestedTurn: s.targetHealthyTurn
                  })),
                  healthyCount: data.totalCount - data.stuckCount
                };
              }
              case 'unstick': {
                if (!args.session_id) throw new Error('Missing session_id for action unstick');
                return unstickSession(args.session_id, args.target_turn || null, ctx);
              }
              case 'trash':
              case 'delete': {
                if (!args.session_id) throw new Error('Missing session_id for action trash');
                return deleteSession(args.session_id, ctx);
              }
              case 'trash_all_stuck':
              case 'clean_all_stuck': {
                return trashAllStuck(ctx);
              }
              case 'restore_trash': {
                if (!args.session_id) throw new Error('Missing session_id for action restore_trash');
                return restoreFromTrash(args.session_id, ctx);
              }
              case 'list_trash': {
                return { trash: listTrash() };
              }
              case 'backup': {
                if (!args.session_id) throw new Error('Missing session_id for action backup');
                return backupSession(args.session_id, 'agent_tool');
              }
              case 'restore_backup': {
                if (!args.session_id) throw new Error('Missing session_id for action restore_backup');
                return restoreBackup(args.session_id, args.backup_timestamp || null, ctx);
              }
              case 'list_backups': {
                return { backups: listBackups(args.session_id || null) };
              }
              case 'inspect': {
                if (!args.session_id) throw new Error('Missing session_id for action inspect');
                return inspectSession(args.session_id);
              }
              default:
                throw new Error(`Unknown action: ${args.action}`);
            }
          }
        });
      }, 'dsh-session-cleaner: tool registration');
    });
  }
}
