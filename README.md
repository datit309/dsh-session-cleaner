# 🩺 DSH Session Cleaner & Doctor

Auto-detect, unstick, and safely clean/delete corrupted or error-stuck sessions in **DeepSeek Harness (DSH)**.

## ✨ Tính năng chính

- 🔍 **Tự động quét và phát hiện session bị kẹt**: Quét toàn bộ `~/.dsh/sessions/` và `workspace.json`, giải mã Zstandard native (`node:zlib`) và phát hiện chính xác các session bị văng lỗi Protobuf 400 (`INVALID_ARGUMENT`), timeout hoặc crash tool-loop.
- 🩹 **Cứu session (Unstick Rollback)**: Thay vì phải xóa bỏ toàn bộ session và mất hết lịch sử chat/code, tính năng này tự động rollback lượt lỗi cuối, dọn sạch bộ nhớ cache để bạn có thể tiếp tục chat bình thường!
- 🗑️ **Xóa sạch vĩnh viễn (Deep Clean)**: Xóa triệt để thư mục session, đồng bộ lại danh sách trong `workspace.json`, dọn dẹp `session_projcache` và bắn event WebSocket `api-session/removed` để giao diện DSH Web cập nhật tức thì không cần F5.
- 🧹 **Xóa 1-click toàn bộ session kẹt (Bulk Clean)**: Dọn sạch tất cả session rác bị lỗi chỉ với 1 thao tác.
- 🖥️ **Tích hợp giao diện Web DSH**: Tab **Session Doctor** ngay trên Right Sidebar và nút cảnh báo 🚨 trên thanh tiêu đề khi phát hiện có session bị kẹt.
- 🤖 **Agent Tool (`session_cleaner`)**: Cho phép AI Agent tự chẩn đoán và dọn dẹp session theo yêu cầu.
- ⚡ **CLI tiện lợi**: Dễ dàng chạy trực tiếp từ Terminal.

## 🚀 Cài đặt & Kích hoạt

1. Link hoặc thêm vào profile `~/.dsh/profiles/web/`:
```bash
cd ~/.dsh/profiles/web
npm install /Users/trantandat/GIC/Freelancer/dsh-session-cleaner
```

2. Thêm vào `cordis.patch.yml`:
```yaml
- insert:
    - id: dsh-session-cleaner
      name: dsh-session-cleaner
```

## 💻 Sử dụng qua Terminal CLI

```bash
# Quét toàn bộ sessions và xem trạng thái
dsh-session-cleaner scan

# Xóa tất cả các session đang bị kẹt lỗi 400
dsh-session-cleaner clean-stuck

# Cứu 1 session (rollback lượt lỗi cuối để chat tiếp)
dsh-session-cleaner unstick <sessionId>

# Xóa 1 session cụ thể
dsh-session-cleaner delete <sessionId>
```

## 🛠️ REST API Endpoints

- `GET /api/session-cleaner/scan`: Danh sách session và số lượng bị kẹt.
- `POST /api/session-cleaner/delete`: Xóa session (`{ "sessionId": "..." }`).
- `POST /api/session-cleaner/delete-stuck`: Xóa toàn bộ session kẹt.
- `POST /api/session-cleaner/unstick`: Cứu session lỗi (`{ "sessionId": "..." }`).
