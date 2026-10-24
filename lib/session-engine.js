/**
 * Session Engine for dsh-session-cleaner
 * Zero-dependency Zstandard decoding, health diagnostics, unstick rollback, and clean deletion.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';

const ZSTD_MAGIC = 4247762216; // 0xFD2FB528

/**
 * Scan concatenated Zstandard frames in buffer.
 */
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`Corrupt Zstandard frame magic at offset ${offset}`);
    }
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    offset += remainingHeaderBytes;
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return { frames };
}

/**
 * Decompress session file into an array of parsed JSON objects.
 */
export function decodeSessionLog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const buf = fs.readFileSync(filePath);
  if (!filePath.endsWith('.zstd')) {
    const text = buf.toString('utf8');
    return text.split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  const { frames } = scanZstdFrames(buf);
  const events = [];
  for (const f of frames) {
    const chunk = zlib.zstdDecompressSync(buf.subarray(f.start, f.end));
    const lines = chunk.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch (err) {
        // Skip unparseable line
      }
    }
  }
  return events;
}

/**
 * Compress an array of event objects into a valid Zstandard buffer.
 */
export function encodeSessionLog(events) {
  const text = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'), {
    params: {
      [zlib.constants.ZSTD_c_checksumFlag]: 1
    }
  });
}

/**
 * Get paths for DSH session storage.
 */
export function getDshPaths() {
  const dshDir = path.join(os.homedir(), '.dsh');
  const sessionsDir = path.join(dshDir, 'sessions');
  const storagesDir = path.join(dshDir, 'storages');
  const workspaceFile = path.join(storagesDir, 'workspace.json');
  const projCacheDir = path.join(storagesDir, 'session_projcache', 'sessions');
  return { dshDir, sessionsDir, storagesDir, workspaceFile, projCacheDir };
}

/**
 * Read workspace.json safely.
 */
export function readWorkspaceJson() {
  const { workspaceFile } = getDshPaths();
  if (!fs.existsSync(workspaceFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(workspaceFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write workspace.json safely.
 */
export function writeWorkspaceJson(data) {
  const { workspaceFile } = getDshPaths();
  fs.writeFileSync(workspaceFile, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Locate session directory and log file across workspaces.
 */
export function locateSession(sessionId) {
  const { sessionsDir } = getDshPaths();
  if (!fs.existsSync(sessionsDir)) return null;

  const workspaceDirs = fs.readdirSync(sessionsDir);
  for (const wDir of workspaceDirs) {
    const fullWDir = path.join(sessionsDir, wDir);
    if (!fs.statSync(fullWDir).isDirectory()) continue;
    const sessionDir = path.join(fullWDir, sessionId);
    if (fs.existsSync(sessionDir)) {
      // Find log file
      let logFile = null;
      for (const ver of [4, 3, 2, 1, 0]) {
        const name = ver === 0 ? 'session.jsonl.zstd' : `session.v${ver}.jsonl.zstd`;
        const candidate = path.join(sessionDir, name);
        if (fs.existsSync(candidate)) {
          logFile = candidate;
          break;
        }
      }
      return {
        sessionId,
        workspaceKey: wDir,
        sessionDir,
        logFile,
        lockFile: path.join(sessionDir, 'session.lock')
      };
    }
  }
  return null;
}

/**
 * Inspect a session to diagnose if it is stuck or healthy.
 */
export function inspectSession(sessionId, location) {
  const loc = location || locateSession(sessionId);
  if (!loc || !loc.logFile) {
    return {
      id: sessionId,
      exists: false,
      isStuck: false,
      reason: 'Session files not found'
    };
  }

  const stat = fs.statSync(loc.logFile);
  const isLocked = fs.existsSync(loc.lockFile);

  let events = [];
  try {
    events = decodeSessionLog(loc.logFile);
  } catch (err) {
    return {
      id: sessionId,
      exists: true,
      workspaceKey: loc.workspaceKey,
      fileSize: stat.size,
      updatedAt: stat.mtimeMs,
      isStuck: true,
      stuckType: 'corrupted_file',
      stuckReason: `Corrupted file: ${err.message}`,
      turnCount: 0,
      totalEvents: 0
    };
  }

  if (events.length === 0) {
    return {
      id: sessionId,
      exists: true,
      workspaceKey: loc.workspaceKey,
      fileSize: stat.size,
      updatedAt: stat.mtimeMs,
      isStuck: false,
      isEmpty: true,
      turnCount: 0,
      totalEvents: 0
    };
  }

  // Extract session title
  let title = 'Untitled Session';
  for (const e of events) {
    if (e.type === 'session/title' && e.data?.title) {
      title = e.data.title;
      break;
    }
    if (e.type === 'user/message' && e.data?.content) {
      const text = e.data.content.find(c => c.type === 'text')?.text;
      if (text) {
        title = text.replace(/<[^>]+>/g, '').trim().slice(0, 60);
      }
    }
  }

  // Analyze turns and errors
  let lastTurnEnd = null;
  let lastTurnId = null;
  let turnCount = 0;
  let hasTurnError = false;
  let errorSummary = null;

  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'turn/end') {
      if (!lastTurnEnd) lastTurnEnd = e;
      if (e.data?.turn && !lastTurnId) lastTurnId = e.data.turn;
      turnCount = Math.max(turnCount, e.data?.turn || 0);
    }
    if (e.type === 'step/start' && e.data?.turn) {
      turnCount = Math.max(turnCount, e.data.turn);
    }
  }

  // Check if last turn had error
  if (lastTurnEnd?.data?.reason?.kind === 'error') {
    hasTurnError = true;
    const msg = lastTurnEnd.data.reason.error?.message || 'Unknown turn error';
    errorSummary = msg.replace(/\n+/g, ' ').slice(0, 150);
  }

  // Check last event
  const lastEvent = events[events.length - 1];
  let isStuck = hasTurnError;
  let stuckType = hasTurnError ? 'turn_error' : null;

  // Also check if assistant step attempt errored
  if (!isStuck) {
    for (let i = events.length - 1; i >= Math.max(0, events.length - 10); i--) {
      const e = events[i];
      if (e.type === 'assistant/attempt' && e.data?.error) {
        isStuck = true;
        stuckType = 'assistant_error';
        errorSummary = String(e.data.error).slice(0, 150);
        break;
      }
    }
  }

  return {
    id: sessionId,
    title,
    exists: true,
    workspaceKey: loc.workspaceKey,
    fileSize: stat.size,
    updatedAt: stat.mtimeMs,
    createdAt: events[0]?.time || stat.birthtimeMs,
    isLocked,
    turnCount,
    totalEvents: events.length,
    isStuck,
    stuckType,
    stuckReason: errorSummary,
    lastTurnId
  };
}

/**
 * Scan all sessions across all workspaces in ~/.dsh/sessions/
 */
export function scanAllSessions() {
  const { sessionsDir } = getDshPaths();
  const wsData = readWorkspaceJson();
  const knownWorkspaces = wsData?.tables?.workspaces || {};

  const results = [];
  if (!fs.existsSync(sessionsDir)) return { sessions: [], stuckCount: 0, totalCount: 0 };

  const workspaceDirs = fs.readdirSync(sessionsDir);
  for (const wDir of workspaceDirs) {
    const fullWDir = path.join(sessionsDir, wDir);
    if (!fs.statSync(fullWDir).isDirectory()) continue;

    // Find human-readable workspace title if matched in workspace.json
    let wsTitle = wDir.replace(/^--|--$/g, '').replace(/-/g, '/');
    for (const wsId in knownWorkspaces) {
      const ws = knownWorkspaces[wsId];
      if (ws.path && (wDir.includes(ws.title) || wDir.includes(path.basename(ws.path)))) {
        wsTitle = ws.title;
        break;
      }
    }

    const sessionDirs = fs.readdirSync(fullWDir);
    for (const sDir of sessionDirs) {
      if (!sDir.startsWith('session-')) continue;
      const sPath = path.join(fullWDir, sDir);
      if (!fs.statSync(sPath).isDirectory()) continue;

      const loc = locateSession(sDir);
      const info = inspectSession(sDir, loc);
      if (info && info.exists) {
        info.workspaceTitle = wsTitle;
        results.push(info);
      }
    }
  }

  // Sort by updatedAt descending
  results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const stuckCount = results.filter(s => s.isStuck).length;
  return {
    sessions: results,
    stuckCount,
    totalCount: results.length
  };
}

/**
 * Unstick / Rollback a session by truncating the last bad turn/step.
 * Preserves all earlier valid turns so the user can continue!
 */
export function unstickSession(sessionId, ctx = null) {
  const loc = locateSession(sessionId);
  if (!loc || !loc.logFile) {
    throw new Error(`Session ${sessionId} not found.`);
  }

  const events = decodeSessionLog(loc.logFile);
  if (events.length === 0) {
    throw new Error(`Session ${sessionId} has empty events.`);
  }

  // Find the highest turn
  let highestTurn = 0;
  for (const e of events) {
    const t = e.data?.turn || e.turn || 0;
    if (t > highestTurn) highestTurn = t;
  }

  if (highestTurn <= 1) {
    // If only 1 turn and it errored, find the first user message and strip the rest
    const firstUserMsgIndex = events.findIndex(e => e.type === 'user/message');
    if (firstUserMsgIndex === -1) {
      throw new Error(`Cannot unstick turn 1: no user message found.`);
    }
    // Keep up to first user message
    const trimmed = events.slice(0, firstUserMsgIndex + 1);
    const newBuf = encodeSessionLog(trimmed);
    fs.writeFileSync(loc.logFile, newBuf);
    cleanSessionCache(sessionId);
    return {
      success: true,
      sessionId,
      rolledBackTurn: 1,
      remainingEvents: trimmed.length,
      message: `Rolled back Turn 1 to initial prompt.`
    };
  }

  // Find the boundary where highestTurn starts (step/start of highestTurn or user/message of highestTurn)
  let cutIndex = -1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const t = e.data?.turn || e.turn;
    if (t === highestTurn) {
      cutIndex = i;
      break;
    }
  }

  if (cutIndex <= 0) {
    throw new Error(`Cannot locate start boundary of turn ${highestTurn}.`);
  }

  // Make backup before rewriting
  const backupFile = `${loc.logFile}.bak.${Date.now()}`;
  fs.copyFileSync(loc.logFile, backupFile);

  const trimmedEvents = events.slice(0, cutIndex);
  const newBuf = encodeSessionLog(trimmedEvents);
  fs.writeFileSync(loc.logFile, newBuf);

  // Clean lock file if leftover
  if (fs.existsSync(loc.lockFile)) {
    try { fs.unlinkSync(loc.lockFile); } catch {}
  }

  // Clean projection cache so DSH re-reads fresh log
  cleanSessionCache(sessionId);

  // Notify DSH if context available
  if (ctx?.emit) {
    try { ctx.emit('api-session/activity', sessionId, Date.now()); } catch {}
  }

  return {
    success: true,
    sessionId,
    rolledBackTurn: highestTurn,
    remainingEvents: trimmedEvents.length,
    backupFile,
    message: `Successfully rolled back Turn ${highestTurn}. Session unstuck!`
  };
}

/**
 * Delete a session permanently and clean all traces in DSH.
 */
export function deleteSession(sessionId, ctx = null) {
  const loc = locateSession(sessionId);

  // 1. If currently loaded in live sessions, dispose
  if (ctx?.get) {
    try {
      const sessions = ctx.get('sessions');
      const live = sessions?.get(sessionId);
      if (live) {
        sessions.detachEntered?.(sessions.liveEntryFor?.(live));
      }
    } catch (e) {
      // Ignore
    }
  }

  // 2. Remove session directory from ~/.dsh/sessions/
  if (loc && fs.existsSync(loc.sessionDir)) {
    fs.rmSync(loc.sessionDir, { recursive: true, force: true });
  }

  // 3. Remove from workspace.json
  const wsData = readWorkspaceJson();
  if (wsData) {
    let modified = false;
    // Remove from global archived & pinned
    if (Array.isArray(wsData.global?.archivedSessionIds)) {
      const before = wsData.global.archivedSessionIds.length;
      wsData.global.archivedSessionIds = wsData.global.archivedSessionIds.filter(id => id !== sessionId);
      if (wsData.global.archivedSessionIds.length !== before) modified = true;
    }
    if (Array.isArray(wsData.global?.pinnedSessionIds)) {
      const before = wsData.global.pinnedSessionIds.length;
      wsData.global.pinnedSessionIds = wsData.global.pinnedSessionIds.filter(id => id !== sessionId);
      if (wsData.global.pinnedSessionIds.length !== before) modified = true;
    }
    // Remove from each workspace's sessionIds
    const workspaces = wsData.tables?.workspaces || {};
    for (const wsId in workspaces) {
      const ws = workspaces[wsId];
      if (Array.isArray(ws.sessionIds)) {
        const before = ws.sessionIds.length;
        ws.sessionIds = ws.sessionIds.filter(id => id !== sessionId);
        if (ws.sessionIds.length !== before) modified = true;
      }
    }
    if (modified) {
      writeWorkspaceJson(wsData);
    }
  }

  // 4. Remove projection cache
  cleanSessionCache(sessionId);

  // 5. Emit removal event to all DSH Web clients
  if (ctx?.emit) {
    try {
      ctx.emit('api-session/removed', sessionId);
    } catch (err) {
      // Ignore
    }
  }

  return { success: true, sessionId };
}

/**
 * Clean projection cache files for a session.
 */
function cleanSessionCache(sessionId) {
  const { projCacheDir, storagesDir } = getDshPaths();
  // Standard cache
  const cacheFile = path.join(projCacheDir, `${sessionId}.json`);
  if (fs.existsSync(cacheFile)) {
    try { fs.unlinkSync(cacheFile); } catch {}
  }
  // Archive manager v2 cache
  const amCache = path.join(storagesDir, 'session_projcache_archive_manager_v2', 'sessions', `${sessionId}.json`);
  if (fs.existsSync(amCache)) {
    try { fs.unlinkSync(amCache); } catch {}
  }
}

/**
 * Bulk delete all stuck sessions.
 */
export function deleteAllStuck(ctx = null) {
  const { sessions } = scanAllSessions();
  const stuck = sessions.filter(s => s.isStuck);
  const deleted = [];
  const errors = [];

  for (const s of stuck) {
    try {
      deleteSession(s.id, ctx);
      deleted.push(s.id);
    } catch (err) {
      errors.push({ id: s.id, error: err.message });
    }
  }

  return {
    deletedCount: deleted.length,
    deleted,
    errors
  };
}
