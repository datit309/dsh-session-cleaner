/**
 * DSH Session Cleaner & Doctor Plugin
 * Auto-detect, unstick, and safely delete corrupted or error-stuck sessions in DeepSeek Harness.
 *
 * @module dsh-session-cleaner
 */

import {
  scanAllSessions,
  deleteSession,
  deleteAllStuck,
  unstickSession,
  inspectSession
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
                sendJson(res, 200, { ok: true, ...data });
              } catch (err) {
                sendJson(res, 500, { ok: false, error: err.message });
              }
              return;
            }
            sendJson(res, 405, { error: 'Method Not Allowed' });
          }
        });

        // POST /api/session-cleaner/delete
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

        // POST /api/session-cleaner/delete-stuck
        const d3 = scope.webServer.register({
          kind: 'exact',
          path: '/api/session-cleaner/delete-stuck',
          handler: async (req, res) => {
            if (req.method === 'OPTIONS') return sendJson(res, 204, {});
            if (req.method === 'POST') {
              try {
                const result = deleteAllStuck(ctx);
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
                const { sessionId } = await readJsonBody(req);
                if (!sessionId) {
                  return sendJson(res, 400, { ok: false, error: 'Missing sessionId' });
                }
                const result = unstickSession(sessionId, ctx);
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
        };
      }, 'dsh-session-cleaner: web routes');
    });

    // 2. Register Tool for AI Agents
    ctx.inject(['tools'], (scope) => {
      scope.effect(() => {
        return scope.tools.register({
          name: 'session_cleaner',
          description: 'Quản lý, chẩn đoán, cứu (unstick rollback) hoặc xóa sạch các session bị kẹt/lỗi 400 trong DeepSeek Harness.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['scan', 'delete', 'unstick', 'clean_all_stuck', 'inspect'],
                description: 'Thao tác cần thực hiện: scan (quét), delete (xóa 1 session), unstick (cứu session lỗi), clean_all_stuck (xóa tất cả session kẹt), inspect (xem chi tiết).'
              },
              session_id: {
                type: 'string',
                description: 'ID của session cần xử lý (ví dụ: session-c8b05878-086e-4bca-98f0-c496ab3d6c1e).'
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
                return {
                  totalCount: data.totalCount,
                  stuckCount: data.stuckCount,
                  stuckSessions: data.sessions.filter(s => s.isStuck).map(s => ({
                    id: s.id,
                    title: s.title,
                    turnCount: s.turnCount,
                    workspace: s.workspaceTitle || s.workspaceKey,
                    error: s.stuckReason
                  })),
                  healthyCount: data.totalCount - data.stuckCount
                };
              }
              case 'delete': {
                if (!args.session_id) throw new Error('Missing session_id for action delete');
                return deleteSession(args.session_id, ctx);
              }
              case 'clean_all_stuck': {
                return deleteAllStuck(ctx);
              }
              case 'unstick': {
                if (!args.session_id) throw new Error('Missing session_id for action unstick');
                return unstickSession(args.session_id, ctx);
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
