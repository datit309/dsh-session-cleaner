#!/usr/bin/env node

/**
 * CLI Tool for dsh-session-cleaner
 * Usage:
 *   dsh-session-cleaner scan
 *   dsh-session-cleaner clean-stuck
 *   dsh-session-cleaner delete <sessionId>
 *   dsh-session-cleaner unstick <sessionId>
 */

import { scanAllSessions, deleteSession, deleteAllStuck, unstickSession, inspectSession } from '../lib/session-engine.js';

const [,, cmd, arg1] = process.argv;

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(ts) {
  if (!ts) return 'N/A';
  const d = new Date(ts);
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' });
}

async function main() {
  switch (cmd) {
    case 'scan':
    case 'list': {
      console.log('\n🔍 Đang quét toàn bộ sessions trong DeepSeek Harness (~/.dsh/sessions/)...');
      const res = scanAllSessions();
      console.log(`\n📊 Tổng cộng: ${res.totalCount} sessions | 🚨 Bị kẹt: ${res.stuckCount} sessions\n`);
      
      console.log(''.padEnd(100, '-'));
      for (const s of res.sessions) {
        const status = s.isStuck ? '🚨 STUCK' : '✅ OK   ';
        console.log(`${status} | ${s.id.padEnd(46)} | ${String(s.turnCount).padStart(2)} turns | ${formatSize(s.fileSize).padStart(8)} | ${s.workspaceTitle || s.workspaceKey}`);
        console.log(`         Tiêu đề : ${s.title}`);
        console.log(`         Cập nhật: ${formatDate(s.updatedAt)}`);
        if (s.isStuck) {
          console.log(`         ⚠️ Lý do : \x1b[31m${s.stuckReason}\x1b[0m`);
        }
        console.log(''.padEnd(100, '-'));
      }
      break;
    }

    case 'clean':
    case 'clean-stuck': {
      console.log('\n🧹 Đang xóa tất cả sessions bị kẹt...');
      const res = deleteAllStuck();
      if (res.deletedCount === 0) {
        console.log('✨ Không có session nào bị kẹt. Hệ thống sạch sẽ!');
      } else {
        console.log(`\n🎉 Đã xóa thành công ${res.deletedCount} sessions:`);
        res.deleted.forEach(id => console.log(`  - 🗑️  ${id}`));
      }
      if (res.errors.length > 0) {
        console.error('\n⚠️ Lỗi khi xóa một số sessions:');
        res.errors.forEach(e => console.error(`  - ${e.id}: ${e.error}`));
      }
      break;
    }

    case 'delete':
    case 'rm': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner delete <sessionId>');
        process.exit(1);
      }
      console.log(`🗑️ Đang xóa session ${arg1}...`);
      try {
        const res = deleteSession(arg1);
        console.log(`✅ Đã xóa hoàn toàn session: ${res.sessionId}`);
      } catch (err) {
        console.error(`❌ Lỗi: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'unstick':
    case 'repair': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner unstick <sessionId>');
        process.exit(1);
      }
      console.log(`🩹 Đang phân tích và cứu session ${arg1}...`);
      try {
        const res = unstickSession(arg1);
        console.log(`✅ ${res.message}`);
        console.log(`   - Lượt đã rollback : Turn ${res.rolledBackTurn}`);
        console.log(`   - Số sự kiện còn lại: ${res.remainingEvents}`);
        if (res.backupFile) console.log(`   - File backup       : ${res.backupFile}`);
      } catch (err) {
        console.error(`❌ Lỗi: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'inspect': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner inspect <sessionId>');
        process.exit(1);
      }
      const info = inspectSession(arg1);
      console.log('\n📋 Chi tiết session:', JSON.stringify(info, null, 2));
      break;
    }

    default: {
      console.log(`
🩺 dsh-session-cleaner - Quản lý, cứu và xóa session bị kẹt trong DeepSeek Harness

Cú pháp:
  dsh-session-cleaner scan              Quét và hiển thị tình trạng tất cả sessions
  dsh-session-cleaner clean-stuck       Xóa sạch toàn bộ các session bị lỗi/kẹt
  dsh-session-cleaner unstick <id>      Cứu session: rollback lượt lỗi cuối để chat tiếp
  dsh-session-cleaner delete <id>       Xóa vĩnh viễn 1 session cụ thể
  dsh-session-cleaner inspect <id>      Xem thông tin chi tiết kỹ thuật của session
`);
      break;
    }
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
