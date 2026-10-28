#!/usr/bin/env node

/**
 * CLI Tool for dsh-session-cleaner
 * Usage:
 *   dsh-session-cleaner scan
 *   dsh-session-cleaner unstick <sessionId> [targetTurn]
 *   dsh-session-cleaner backup <sessionId>
 *   dsh-session-cleaner backups [sessionId]
 *   dsh-session-cleaner restore-backup <sessionId> [timestamp]
 *   dsh-session-cleaner trash <sessionId>
 *   dsh-session-cleaner trash-stuck
 *   dsh-session-cleaner list-trash
 *   dsh-session-cleaner restore-trash <sessionId>
 *   dsh-session-cleaner empty-trash
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
} from '../lib/session-engine.js';

const [,, cmd, arg1, arg2] = process.argv;

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
          if (s.targetHealthyTurn !== undefined) {
            console.log(`         💡 Gợi ý : Rollback về Turn ${s.targetHealthyTurn} (dsh-session-cleaner unstick ${s.id})`);
          }
        }
        console.log(''.padEnd(100, '-'));
      }
      break;
    }

    case 'unstick':
    case 'repair': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner unstick <sessionId> [targetTurn]');
        process.exit(1);
      }
      const targetTurn = arg2 ? parseInt(arg2, 10) : null;
      console.log(`🩹 Đang phân tích và cứu session ${arg1}...`);
      try {
        const res = unstickSession(arg1, targetTurn);
        console.log(`\n✅ ${res.message}`);
        console.log(`   - Đã rollback về    : Turn ${res.rolledBackToTurn}`);
        console.log(`   - Số sự kiện còn lại: ${res.remainingEvents}`);
        console.log(`   - Bản backup an toàn: ${res.backupDir}`);
        console.log(`\n👉 Bạn có thể tải lại trang DSH Web và tiếp tục chat bình thường!`);
      } catch (err) {
        console.error(`❌ Lỗi: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'backup': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner backup <sessionId>');
        process.exit(1);
      }
      console.log(`💾 Đang sao lưu session ${arg1} vào ~/.dsh/session-backups/...`);
      try {
        const res = backupSession(arg1, 'manual_cli');
        console.log(`✅ Đã tạo bản sao lưu an toàn tại:`);
        console.log(`   ${res.backupDir}`);
      } catch (err) {
        console.error(`❌ Lỗi: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'backups': {
      const list = listBackups(arg1 || null);
      console.log(`\n💾 Danh sách bản sao lưu an toàn (~/.dsh/session-backups/): ${list.length} bản`);
      console.log(''.padEnd(90, '-'));
      for (const b of list) {
        console.log(`• ${b.sessionId} | ${formatDate(b.timestamp)} | Lý do: ${b.reason}`);
        console.log(`  Đường dẫn: ${b.path}`);
      }
      console.log(''.padEnd(90, '-'));
      break;
    }

    case 'restore-backup': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner restore-backup <sessionId> [timestamp]');
        process.exit(1);
      }
      console.log(`♻️ Đang phục hồi session ${arg1} từ bản sao lưu...`);
      try {
        const res = restoreBackup(arg1, arg2 || null);
        console.log(`✅ ${res.message}`);
        console.log(`   - Phục hồi từ: ${res.restoredFrom}`);
      } catch (err) {
        console.error(`❌ Lỗi: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'delete':
    case 'trash':
    case 'rm': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner trash <sessionId>');
        process.exit(1);
      }
      console.log(`📦 Đang chuyển session ${arg1} vào Thùng rác (~/.dsh/trash/sessions/)...`);
      try {
        const res = deleteSession(arg1);
        console.log(`✅ ${res.message}`);
        if (res.trashPath) console.log(`   - Vị trí trong Thùng rác: ${res.trashPath}`);
        console.log(`   (Để phục hồi lại bất cứ lúc nào: dsh-session-cleaner restore-trash ${arg1})`);
      } catch (err) {
        console.error(`❌ Lỗi: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'clean':
    case 'clean-stuck':
    case 'trash-stuck': {
      console.log('\n📦 Đang chuyển tất cả sessions bị kẹt vào Thùng rác (~/.dsh/trash/)...');
      const res = trashAllStuck();
      if (res.deletedCount === 0) {
        console.log('✨ Không có session nào bị kẹt. Hệ thống sạch sẽ!');
      } else {
        console.log(`\n🎉 Đã chuyển ${res.deletedCount} sessions vào Thùng rác an toàn:`);
        res.trashed.forEach(id => console.log(`  - 📦 ${id}`));
        console.log(`\n💡 Lưu ý: Các session này KHÔNG bị xóa mất mà nằm trong ~/.dsh/trash/.`);
        console.log(`   Bạn có thể phục hồi lại bằng lệnh: dsh-session-cleaner restore-trash <id>`);
      }
      if (res.errors.length > 0) {
        console.error('\n⚠️ Lỗi khi xử lý một số sessions:');
        res.errors.forEach(e => console.error(`  - ${e.id}: ${e.error}`));
      }
      break;
    }

    case 'trash-list':
    case 'list-trash': {
      const list = listTrash();
      console.log(`\n🗑️ Thùng rác Session (~/.dsh/trash/sessions/): ${list.length} mục`);
      console.log(''.padEnd(90, '-'));
      for (const t of list) {
        console.log(`• ${t.sessionId} | Xóa lúc: ${formatDate(t.timestamp)} | Workspace: ${t.workspaceKey}`);
        console.log(`  Đường dẫn: ${t.path}`);
      }
      console.log(''.padEnd(90, '-'));
      if (list.length > 0) {
        console.log(`\n👉 Cú pháp phục hồi: dsh-session-cleaner restore-trash <sessionId>`);
        console.log(`👉 Cú pháp dọn sạch vĩnh viễn: dsh-session-cleaner empty-trash`);
      }
      break;
    }

    case 'restore-trash': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner restore-trash <sessionId>');
        process.exit(1);
      }
      console.log(`♻️ Đang phục hồi session ${arg1} từ Thùng rác...`);
      try {
        const res = restoreFromTrash(arg1);
        console.log(`✅ ${res.message}`);
        console.log(`   - Đã khôi phục vào workspace: ${res.restoredToWorkspace}`);
      } catch (err) {
        console.error(`❌ Lỗi: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'empty-trash': {
      console.log('🔥 Đang làm sạch vĩnh viễn Thùng rác...');
      emptyTrash();
      console.log('✅ Đã dọn sạch toàn bộ Thùng rác.');
      break;
    }

    case 'inspect': {
      if (!arg1) {
        console.error('❌ Thiếu sessionId! Cú pháp: dsh-session-cleaner inspect <sessionId>');
        process.exit(1);
      }
      const info = inspectSession(arg1);
      console.log('\n📋 Chi tiết chẩn đoán session:');
      console.log(JSON.stringify(info, null, 2));
      break;
    }

    default: {
      console.log(`
🩺 dsh-session-cleaner - Quản lý, Cứu và Phục hồi Session trong DeepSeek Harness

CÁC LỆNH CỨU SESSION (AN TOÀN TUYỆT ĐỐI):
  dsh-session-cleaner scan                       Quét toàn bộ sessions và kiểm tra sức khỏe
  dsh-session-cleaner unstick <id> [targetTurn]  Cứu session: rollback lượt lỗi cuối để chat tiếp (tự động backup trước)
  dsh-session-cleaner backup <id>                Tạo bản sao lưu an toàn vào ~/.dsh/session-backups/
  dsh-session-cleaner backups [id]               Xem danh sách các bản sao lưu
  dsh-session-cleaner restore-backup <id> [ts]   Phục hồi session từ bản sao lưu

QUẢN LÝ THÙNG RÁC (SAFE TRASH - KHÔNG MẤT DỮ LIỆU):
  dsh-session-cleaner trash <id>                 Chuyển session vào Thùng rác an toàn (thay cho xóa mất)
  dsh-session-cleaner clean-stuck                Chuyển tất cả session bị lỗi vào Thùng rác
  dsh-session-cleaner list-trash                 Xem danh sách các session đang trong Thùng rác
  dsh-session-cleaner restore-trash <id>         Phục hồi session từ Thùng rác trở lại DSH Web
  dsh-session-cleaner empty-trash                Dọn sạch vĩnh viễn Thùng rác
`);
      break;
    }
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
