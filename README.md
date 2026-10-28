# 🩺 DSH Session Cleaner & Doctor

Auto-detect, unstick, backup, and safely recover or clean sessions in **DeepSeek Harness (DSH)**.

## ✨ Tính năng chính

- 🔍 **Tự động quét và phát hiện session bị kẹt**: Quét toàn bộ `~/.dsh/sessions/` và `workspace.json`, giải mã Zstandard native (`node:zlib`) và phát hiện chính xác các session bị văng lỗi Protobuf 400 (`INVALID_ARGUMENT`), timeout hoặc crash tool-loop.
- 🩹 **Cứu session (Deep Unstick & Rollback)**:
  - Tự động **sao lưu an toàn** sang `~/.dsh/session-backups/` trước khi sửa.
  - Phân tích chuỗi lỗi ở đuôi session và rollback chính xác về lượt thành công cuối.
  - Mã hóa theo đúng **chuẩn Multi-frame Zstandard của DSH** (Frame 0: header duy nhất; Frame 1: events), loại bỏ 100% nguy cơ session bị hỏng hay biến mất khỏi UI.
- 📦 **Thùng rác an toàn (Safe Trash - Không lo mất dữ liệu)**:
  - Khi xóa hoặc dọn dẹp, session được chuyển vào `~/.dsh/trash/sessions/` thay vì xóa vĩnh viễn (`rm -rf`).
  - Dễ dàng **phục hồi nguyên trạng 1-click** bất cứ lúc nào!
- 💾 **Sao lưu & Phục hồi độc lập (Backup & Restore)**: Tạo snapshot session dự phòng bất cứ lúc nào và khôi phục khi cần.
- 🖥️ **Tích hợp giao diện Web DSH**: Tab **Session Doctor** trên Right Sidebar với 4 chế độ: Bị kẹt, Tất cả, Thùng rác, Bản sao lưu.
- 🤖 **Agent Tool (`session_cleaner`)**: Cho phép AI Agent tự chẩn đoán, cứu session hoặc dọn dẹp theo yêu cầu.
- ⚡ **Terminal CLI đầy đủ**: `scan`, `unstick`, `backup`, `restore-backup`, `trash`, `list-trash`, `restore-trash`.

## 🚀 Cài đặt & Kích hoạt

1. Cài đặt vào profile `~/.dsh/profiles/web/`:
```bash
cd ~/.dsh/profiles/web
npm install github:datit309/dsh-session-cleaner
```

2. Thêm vào `cordis.patch.yml` nếu cần:
```yaml
- insert:
    - id: dsh-session-cleaner
      name: dsh-session-cleaner
```

## 💻 Sử dụng qua Terminal CLI

```bash
# Quét toàn bộ sessions và xem trạng thái
dsh-session-cleaner scan

# Cứu session (tự động sao lưu trước khi rollback)
dsh-session-cleaner unstick <sessionId>

# Tạo bản sao lưu an toàn
dsh-session-cleaner backup <sessionId>

# Phục hồi session từ bản sao lưu
dsh-session-cleaner restore-backup <sessionId>

# Chuyển session vào Thùng rác an toàn
dsh-session-cleaner trash <sessionId>

# Chuyển tất cả session bị lỗi vào Thùng rác
dsh-session-cleaner clean-stuck

# Xem danh sách các session trong Thùng rác
dsh-session-cleaner list-trash

# Khôi phục session từ Thùng rác về DSH Web
dsh-session-cleaner restore-trash <sessionId>

# Dọn sạch vĩnh viễn Thùng rác
dsh-session-cleaner empty-trash
```

## 🛠️ REST API Endpoints

- `GET /api/session-cleaner/scan`: Danh sách session, số lượng kẹt, thùng rác, bản sao lưu.
- `POST /api/session-cleaner/unstick`: Cứu session lỗi (`{ "sessionId": "...", "targetTurn": 5 }`).
- `POST /api/session-cleaner/delete`: Chuyển session vào thùng rác (`{ "sessionId": "..." }`).
- `POST /api/session-cleaner/delete-stuck`: Chuyển tất cả session kẹt vào thùng rác.
- `GET /api/session-cleaner/trash`: Danh sách session trong thùng rác.
- `POST /api/session-cleaner/restore-trash`: Phục hồi session từ thùng rác (`{ "sessionId": "..." }`).
- `GET /api/session-cleaner/backups`: Danh sách bản sao lưu.
- `POST /api/session-cleaner/backup`: Tạo bản sao lưu (`{ "sessionId": "..." }`).
- `POST /api/session-cleaner/restore-backup`: Phục hồi từ bản sao lưu (`{ "sessionId": "..." }`).
