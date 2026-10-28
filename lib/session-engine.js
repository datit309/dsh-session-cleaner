/**
 * Session Engine for dsh-session-cleaner
 * Zero-dependency Zstandard decoding, DSH-compliant multi-frame encoding,
 * accurate tail-error detection, deep unstick rollback, external safe backup, and safe trash recovery.
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
 * Compress an array of event objects into a DSH-compliant multi-frame Zstandard buffer.
 * CRITICAL DSH CONTRACT:
 * Frame 0 MUST contain strictly and only the single header line ending in \n!
 * Subsequent events are placed in Frame 1+.
 */
export function encodeSessionLog(events) {
  if (!events || events.length === 0) return Buffer.alloc(0);

  // Frame 0: Single header event line
  const headerEvent = events[0];
  const headerLine = JSON.stringify(headerEvent) + '\n';
  const headerFrame = zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8'), {
    params: {
      [zlib.constants.ZSTD_c_checksumFlag]: 1
    }
  });

  if (events.length === 1) {
    return headerFrame;
  }

  // Frame 1: Remaining event batch lines
  const eventLines = events.slice(1).map(e => JSON.stringify(e)).join('\n') + '\n';
  const eventsFrame = zlib.zstdCompressSync(Buffer.from(eventLines, 'utf8'), {
    params: {
      [zlib.constants.ZSTD_c_checksumFlag]: 1
    }
  });

  return Buffer.concat([headerFrame, eventsFrame]);
}

/**
 * Get paths for DSH session storage, safe backup, and safe trash.
 */
export function getDshPaths() {
  const dshDir = path.join(os.homedir(), '.dsh');
  const sessionsDir = path.join(dshDir, 'sessions');
  const storagesDir = path.join(dshDir, 'storages');
  const workspaceFile = path.join(storagesDir, 'workspace.json');
  const projCacheDir = path.join(storagesDir, 'session_projcache', 'sessions');
  const backupDir = path.join(dshDir, 'session-backups');
  const trashDir = path.join(dshDir, 'trash', 'sessions');

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });

  return { dshDir, sessionsDir, storagesDir, workspaceFile, projCacheDir, backupDir, trashDir };
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
 * Accurately analyzes the tail end of the conversation.
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

  // Collect all turns and their completion statuses
  let turnCount = 0;
  const turns = []; // { turnNum, endEvent, hasError, errorMsg }
  let currentTurn = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const t = e.data?.turn || e.turn;
    if (typeof t === 'number' && t > turnCount) {
      turnCount = t;
    }
    if (e.type === 'turn/start') {
      currentTurn = e.data?.turn || currentTurn + 1;
    }
    if (e.type === 'turn/end') {
      const isErr = e.data?.reason?.kind === 'error';
      const msg = isErr ? (e.data.reason.error?.message || 'Turn error') : null;
      turns.push({
        turnNum: e.data?.turn || currentTurn,
        endEvent: e,
        hasError: isErr,
        errorMsg: msg
      });
    }
  }

  // Check if tail is stuck:
  // A session is stuck if the LAST completed turn had an error,
  // OR if an in-flight attempt after the last turn/end has an unrecovered error.
  let isStuck = false;
  let stuckReason = null;
  let firstBrokenTurn = null;
  let targetHealthyTurn = 0;

  // 1. Check last turn/end
  if (turns.length > 0) {
    const lastTurn = turns[turns.length - 1];
    if (lastTurn.hasError) {
      isStuck = true;
      stuckReason = lastTurn.errorMsg;
      // Scan backwards to find the earliest consecutive broken turn at the tail
      let earliestBroken = lastTurn.turnNum;
      for (let j = turns.length - 1; j >= 0; j--) {
        if (turns[j].hasError) {
          earliestBroken = turns[j].turnNum;
        } else {
          targetHealthyTurn = turns[j].turnNum;
          break;
        }
      }
      firstBrokenTurn = earliestBroken;
    } else {
      targetHealthyTurn = lastTurn.turnNum;
    }
  }

  // 2. Check trailing events after last turn/end (e.g. in-flight crash)
  if (!isStuck) {
    const lastTurnEndIndex = events.map(e => e.type).lastIndexOf('turn/end');
    const trailingEvents = lastTurnEndIndex >= 0 ? events.slice(lastTurnEndIndex + 1) : events;
    for (const e of trailingEvents) {
      if (e.type === 'assistant/attempt') {
        const stream = e.data?.stream;
        if (Array.isArray(stream)) {
          const finish = stream.find(s => s.chunk?.type === 'finish');
          if (finish?.chunk?.reason?.kind === 'error') {
            isStuck = true;
            firstBrokenTurn = (e.data?.turn || turnCount) || 1;
            stuckReason = finish.chunk.reason.failure?.message || 'Assistant execution failed';
            targetHealthyTurn = Math.max(0, firstBrokenTurn - 1);
            break;
          }
        }
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
    stuckType: isStuck ? 'tail_turn_error' : null,
    stuckReason: stuckReason ? stuckReason.replace(/\n+/g, ' ').slice(0, 150) : null,
    firstBrokenTurn,
    targetHealthyTurn
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

  results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const stuckCount = results.filter(s => s.isStuck).length;
  return {
    sessions: results,
    stuckCount,
    totalCount: results.length
  };
}

/**
 * Create a safe external backup of a session in ~/.dsh/session-backups/<sessionId>/<timestamp>/
 */
export function backupSession(sessionId, reason = 'manual') {
  const loc = locateSession(sessionId);
  if (!loc || !loc.sessionDir) {
    throw new Error(`Session ${sessionId} not found.`);
  }

  const { backupDir } = getDshPaths();
  const ts = Date.now();
  const sessionBackupRoot = path.join(backupDir, sessionId);
  const targetDir = path.join(sessionBackupRoot, String(ts));
  fs.mkdirSync(targetDir, { recursive: true });

  const files = fs.readdirSync(loc.sessionDir);
  for (const file of files) {
    const src = path.join(loc.sessionDir, file);
    const dest = path.join(targetDir, file);
    fs.copyFileSync(src, dest);
  }

  const meta = {
    sessionId,
    timestamp: ts,
    date: new Date(ts).toISOString(),
    reason,
    workspaceKey: loc.workspaceKey,
    fileCount: files.length
  };
  fs.writeFileSync(path.join(targetDir, 'backup-info.json'), JSON.stringify(meta, null, 2), 'utf8');

  return {
    success: true,
    sessionId,
    timestamp: ts,
    backupDir: targetDir
  };
}

/**
 * List all available backups for a session (or all sessions).
 */
export function listBackups(filterSessionId = null) {
  const { backupDir } = getDshPaths();
  if (!fs.existsSync(backupDir)) return [];

  const results = [];
  const sessionDirs = fs.readdirSync(backupDir);
  for (const sId of sessionDirs) {
    if (filterSessionId && sId !== filterSessionId) continue;
    const sRoot = path.join(backupDir, sId);
    if (!fs.statSync(sRoot).isDirectory()) continue;

    const tsDirs = fs.readdirSync(sRoot);
    for (const ts of tsDirs) {
      const bDir = path.join(sRoot, ts);
      if (!fs.statSync(bDir).isDirectory()) continue;
      const metaFile = path.join(bDir, 'backup-info.json');
      let meta = null;
      if (fs.existsSync(metaFile)) {
        try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
      }
      results.push({
        sessionId: sId,
        timestamp: Number(ts) || 0,
        path: bDir,
        reason: meta?.reason || 'unknown',
        workspaceKey: meta?.workspaceKey || null,
        date: meta?.date || new Date(Number(ts) || 0).toISOString()
      });
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results;
}

/**
 * Restore a session from an external backup.
 */
export function restoreBackup(sessionId, targetTimestamp = null, ctx = null) {
  const backups = listBackups(sessionId);
  if (backups.length === 0) {
    throw new Error(`No backups found for session ${sessionId}.`);
  }

  const selected = targetTimestamp
    ? backups.find(b => String(b.timestamp) === String(targetTimestamp))
    : backups[0]; // Newest

  if (!selected) {
    throw new Error(`Backup with timestamp ${targetTimestamp} not found for session ${sessionId}.`);
  }

  const { sessionsDir } = getDshPaths();
  let loc = locateSession(sessionId);
  if (!loc) {
    const targetWsKey = selected.workspaceKey || fs.readdirSync(sessionsDir)[0];
    const restoredDir = path.join(sessionsDir, targetWsKey, sessionId);
    fs.mkdirSync(restoredDir, { recursive: true });
    loc = {
      sessionId,
      workspaceKey: targetWsKey,
      sessionDir: restoredDir,
      logFile: path.join(restoredDir, 'session.v4.jsonl.zstd'),
      lockFile: path.join(restoredDir, 'session.lock')
    };
  }

  const backupFiles = fs.readdirSync(selected.path).filter(f => f !== 'backup-info.json');
  for (const file of backupFiles) {
    fs.copyFileSync(path.join(selected.path, file), path.join(loc.sessionDir, file));
  }

  if (fs.existsSync(loc.lockFile)) {
    try { fs.unlinkSync(loc.lockFile); } catch {}
  }

  ensureWorkspaceSession(sessionId, loc.workspaceKey);
  cleanSessionCache(sessionId);

  if (ctx?.emit) {
    try { ctx.emit('api-session/added', { id: sessionId }); } catch {}
    try { ctx.emit('api-session/activity', sessionId, Date.now()); } catch {}
  }

  return {
    success: true,
    sessionId,
    restoredFrom: selected.path,
    restoredTimestamp: selected.timestamp,
    message: `Session ${sessionId} restored successfully from backup!`
  };
}

/**
 * Ensure session ID is registered in workspace.json.
 */
function ensureWorkspaceSession(sessionId, workspaceKey) {
  const wsData = readWorkspaceJson();
  if (!wsData || !wsData.tables?.workspaces) return;

  const workspaces = wsData.tables.workspaces;
  let targetWs = null;

  for (const wsId in workspaces) {
    const ws = workspaces[wsId];
    if (ws.path && workspaceKey && (workspaceKey.includes(ws.title) || workspaceKey.includes(path.basename(ws.path)))) {
      targetWs = ws;
      break;
    }
  }

  if (!targetWs) {
    const firstId = Object.keys(workspaces)[0];
    targetWs = workspaces[firstId];
  }

  if (targetWs && Array.isArray(targetWs.sessionIds)) {
    if (!targetWs.sessionIds.includes(sessionId)) {
      targetWs.sessionIds.unshift(sessionId);
      writeWorkspaceJson(wsData);
    }
  }
}

/**
 * Deep Unstick / Rollback a session safely.
 * 1. Automatically creates an external backup first in ~/.dsh/session-backups/!
 * 2. Finds the exact turn that triggered the error at the tail.
 * 3. Cuts out the broken turn and restores to the last known good turn.
 * 4. Encodes using DSH-compliant multi-frame Zstandard (Header in Frame 0, Events in Frame 1).
 * 5. Re-attaches to workspace.json and flushes cache so DSH instantly reloads it!
 */
export function unstickSession(sessionId, targetTurn = null, ctx = null) {
  const loc = locateSession(sessionId);
  if (!loc || !loc.logFile) {
    throw new Error(`Session ${sessionId} not found.`);
  }

  // 1. Mandatory safe external backup BEFORE modifying anything
  const backup = backupSession(sessionId, 'pre_unstick');

  // 2. Decode session log
  const events = decodeSessionLog(loc.logFile);
  if (events.length === 0) {
    throw new Error(`Session ${sessionId} has empty events.`);
  }

  // 3. Inspect health & determine target rollback turn
  const info = inspectSession(sessionId, loc);
  let rollToTurn = targetTurn;

  if (rollToTurn === null) {
    rollToTurn = info.targetHealthyTurn;
  }

  let cutIndex = -1;

  if (rollToTurn === 0) {
    // If even Turn 1 was broken, keep only up to the first user message
    const firstUserMsgIndex = events.findIndex(e => e.type === 'user/message');
    if (firstUserMsgIndex !== -1) {
      cutIndex = firstUserMsgIndex + 1;
    } else {
      cutIndex = 1; // Header line only
    }
  } else {
    // Roll back to the completion of rollToTurn
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'turn/end' && (e.data?.turn === rollToTurn || e.turn === rollToTurn)) {
        let endIdx = i + 1;
        while (endIdx < events.length) {
          const nextType = events[endIdx].type;
          // Keep trailing turn housekeeping events
          if (nextType === 'workspace/changes' || nextType === 'session/title') {
            endIdx++;
          } else {
            break;
          }
        }
        cutIndex = endIdx;
        break;
      }
    }

    if (cutIndex === -1) {
      // Fallback: search by start boundary of (rollToTurn + 1)
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        const t = e.data?.turn || e.turn;
        if (t === rollToTurn + 1) {
          cutIndex = i;
          break;
        }
      }
    }
  }

  if (cutIndex <= 0 || cutIndex >= events.length) {
    cutIndex = Math.max(2, events.length - 10);
  }

  const trimmedEvents = events.slice(0, cutIndex);

  // 4. Encode strictly using DSH-compliant multi-frame Zstandard
  const newBuf = encodeSessionLog(trimmedEvents);
  fs.writeFileSync(loc.logFile, newBuf);

  // 5. Clean lock file
  if (fs.existsSync(loc.lockFile)) {
    try { fs.unlinkSync(loc.lockFile); } catch {}
  }

  // 6. Guarantee presence in workspace.json so it never vanishes from DSH
  ensureWorkspaceSession(sessionId, loc.workspaceKey);

  // 7. Clean projection cache
  cleanSessionCache(sessionId);

  // 8. Notify DSH clients
  if (ctx?.emit) {
    try { ctx.emit('api-session/added', { id: sessionId }); } catch {}
    try { ctx.emit('api-session/activity', sessionId, Date.now()); } catch {}
  }

  return {
    success: true,
    sessionId,
    rolledBackToTurn: rollToTurn,
    remainingEvents: trimmedEvents.length,
    backupDir: backup.backupDir,
    message: `Session ${sessionId} was unstuck! Rolled back to Turn ${rollToTurn}. An external backup was saved at: ${backup.backupDir}`
  };
}

/**
 * Safe Delete: Moves session to ~/.dsh/trash/sessions/ instead of rmSync!
 * It can be restored at any time with restoreFromTrash!
 */
export function deleteSession(sessionId, ctx = null) {
  const loc = locateSession(sessionId);
  if (!loc || !loc.sessionDir) {
    removeFromWorkspace(sessionId);
    cleanSessionCache(sessionId);
    return { success: true, sessionId, inTrash: false, message: 'Session metadata cleaned.' };
  }

  if (ctx?.get) {
    try {
      const sessions = ctx.get('sessions');
      const live = sessions?.get(sessionId);
      if (live) {
        sessions.detachEntered?.(sessions.liveEntryFor?.(live));
      }
    } catch {}
  }

  // Move to ~/.dsh/trash/sessions/<sessionId>/<timestamp>/
  const { trashDir } = getDshPaths();
  const ts = Date.now();
  const targetTrashDir = path.join(trashDir, sessionId, String(ts));
  fs.mkdirSync(targetTrashDir, { recursive: true });

  const files = fs.readdirSync(loc.sessionDir);
  for (const file of files) {
    const src = path.join(loc.sessionDir, file);
    const dest = path.join(targetTrashDir, file);
    fs.copyFileSync(src, dest);
  }

  const trashMeta = {
    sessionId,
    deletedAt: ts,
    date: new Date(ts).toISOString(),
    workspaceKey: loc.workspaceKey,
    fileCount: files.length
  };
  fs.writeFileSync(path.join(targetTrashDir, 'trash-info.json'), JSON.stringify(trashMeta, null, 2), 'utf8');

  // Safely remove active session files
  fs.rmSync(loc.sessionDir, { recursive: true, force: true });

  // Remove from workspace.json
  removeFromWorkspace(sessionId);

  // Clean projection cache
  cleanSessionCache(sessionId);

  // Emit removal event
  if (ctx?.emit) {
    try {
      ctx.emit('api-session/removed', sessionId);
    } catch {}
  }

  return {
    success: true,
    sessionId,
    inTrash: true,
    trashPath: targetTrashDir,
    message: `Session moved to safe trash. You can restore it anytime.`
  };
}

function removeFromWorkspace(sessionId) {
  const wsData = readWorkspaceJson();
  if (wsData) {
    let modified = false;
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
}

/**
 * List all sessions in Trash.
 */
export function listTrash() {
  const { trashDir } = getDshPaths();
  if (!fs.existsSync(trashDir)) return [];

  const results = [];
  const sessionDirs = fs.readdirSync(trashDir);
  for (const sId of sessionDirs) {
    const sRoot = path.join(trashDir, sId);
    if (!fs.statSync(sRoot).isDirectory()) continue;
    const tsDirs = fs.readdirSync(sRoot);
    for (const ts of tsDirs) {
      const tDir = path.join(sRoot, ts);
      if (!fs.statSync(tDir).isDirectory()) continue;
      const metaFile = path.join(tDir, 'trash-info.json');
      let meta = null;
      if (fs.existsSync(metaFile)) {
        try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
      }
      results.push({
        sessionId: sId,
        timestamp: Number(ts) || 0,
        path: tDir,
        workspaceKey: meta?.workspaceKey || null,
        date: meta?.date || new Date(Number(ts) || 0).toISOString()
      });
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results;
}

/**
 * Restore a session from Trash back to active sessions.
 */
export function restoreFromTrash(sessionId, ctx = null) {
  const trashItems = listTrash().filter(t => t.sessionId === sessionId);
  if (trashItems.length === 0) {
    throw new Error(`Session ${sessionId} not found in Trash.`);
  }

  const selected = trashItems[0]; // Newest
  const { sessionsDir } = getDshPaths();

  let targetWsKey = selected.workspaceKey;
  if (!targetWsKey) {
    targetWsKey = fs.readdirSync(sessionsDir)[0] || '--Users-trantandat-GIC-Freelancer--';
  }

  const targetSessionDir = path.join(sessionsDir, targetWsKey, sessionId);
  fs.mkdirSync(targetSessionDir, { recursive: true });

  const files = fs.readdirSync(selected.path).filter(f => f !== 'trash-info.json');
  for (const file of files) {
    fs.copyFileSync(path.join(selected.path, file), path.join(targetSessionDir, file));
  }

  fs.rmSync(selected.path, { recursive: true, force: true });
  ensureWorkspaceSession(sessionId, targetWsKey);
  cleanSessionCache(sessionId);

  if (ctx?.emit) {
    try { ctx.emit('api-session/added', { id: sessionId }); } catch {}
    try { ctx.emit('api-session/activity', sessionId, Date.now()); } catch {}
  }

  return {
    success: true,
    sessionId,
    restoredToWorkspace: targetWsKey,
    message: `Session ${sessionId} has been restored from Trash!`
  };
}

/**
 * Empty all items from Trash.
 */
export function emptyTrash() {
  const { trashDir } = getDshPaths();
  if (fs.existsSync(trashDir)) {
    fs.rmSync(trashDir, { recursive: true, force: true });
    fs.mkdirSync(trashDir, { recursive: true });
  }
  return { success: true, message: 'Trash emptied.' };
}

/**
 * Safe clean: moves all stuck sessions to Trash.
 */
export function trashAllStuck(ctx = null) {
  const { sessions } = scanAllSessions();
  const stuck = sessions.filter(s => s.isStuck);
  const trashed = [];
  const errors = [];

  for (const s of stuck) {
    try {
      deleteSession(s.id, ctx);
      trashed.push(s.id);
    } catch (err) {
      errors.push({ id: s.id, error: err.message });
    }
  }

  return {
    trashedCount: trashed.length,
    trashed,
    errors
  };
}

export const deleteAllStuck = trashAllStuck;

function cleanSessionCache(sessionId) {
  const { projCacheDir, storagesDir } = getDshPaths();
  const cacheFile = path.join(projCacheDir, `${sessionId}.json`);
  if (fs.existsSync(cacheFile)) {
    try { fs.unlinkSync(cacheFile); } catch {}
  }
  const amCache = path.join(storagesDir, 'session_projcache_archive_manager_v2', 'sessions', `${sessionId}.json`);
  if (fs.existsSync(amCache)) {
    try { fs.unlinkSync(amCache); } catch {}
  }
}
