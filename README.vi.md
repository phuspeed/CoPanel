# CoPanel - Bảng Điều Khiển Quản Lý VPS Linux Gọn Nhẹ

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Status](https://img.shields.io/badge/status-beta-yellow)
![License](https://img.shields.io/badge/license-MIT-green)

Một bảng điều khiển quản lý VPS Linux gọn nhẹ, hiệu suất cao với **kiến trúc pluggable**. Thêm các tính năng mới chỉ bằng cách thả một thư mục module vào—không cần chỉnh sửa mã nguồn cốt lõi!

## 🎯 Triết Lý Cốt Lõi

**Kiến trúc Pluggable**: Tự động phát hiện và đăng ký các tính năng mới (API Backend + UI Frontend) chỉ bằng cách thêm một thư mục vào một thư mục cụ thể.

## 🛠️ Stack Công Nghệ

| Thành phần | Công nghệ | Mục đích |
|-----------|-----------|---------|
| **Backend** | FastAPI + Python 3.10+ | API không đồng bộ, an toàn kiểu dữ liệu |
| **Frontend** | React (Vite) + TailwindCSS | Giao diện hiện đại, phản hồi nhanh (Responsive) |
| **Real-time** | WebSockets + Xterm.js | Mô phỏng terminal |
| **Dữ liệu** | SQLite + Hệ thống tập tin Linux | Siêu dữ liệu & kiểm soát trực tiếp |
| **Xác thực** | JWT + Linux PAM | Xác thực an toàn |
| **Triển khai** | Nginx + Systemd | Sẵn sàng cho môi trường production |

## 📂 Cấu Trúc Dự Án

```
/copanel
├── backend/
│   ├── main.py                      # FastAPI entry point
│   ├── core/
│   │   ├── __init__.py
│   │   ├── loader.py               # Trình tải module động
│   │   └── security.py             # Tiện ích JWT & xác thực
│   ├── modules/                     # 🔌 THƯ MỤC PLUGIN
│   │   ├── system_monitor/         # Module tham chiếu 1
│   │   │   ├── __init__.py
│   │   │   ├── router.py           # Phải xuất 'router'
│   │   │   └── logic.py
│   │   └── file_manager/           # Module tham chiếu 2 (tự tạo module của bạn!)
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── registry.ts         # Sổ đăng ký module động
│   │   │   ├── Layout.tsx          # Bố cục chính với thanh bên (sidebar)
│   │   │   └── routes.tsx          # Định tuyến động
│   │   ├── modules/                # 🔌 THƯ MỤC PLUGIN UI
│   │   │   ├── system_monitor/
│   │   │   │   ├── index.tsx
│   │   │   │   └── config.ts
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── scripts/
│   └── install.sh                  # Cài đặt bằng một cú nhấp chuột (One-click)
│
├── config/
│   └── nginx.conf                  # Mẫu cấu hình Nginx
│
└── README.vi.md
```

## 🚀 Khởi Động Nhanh

### Yêu Cầu Hệ Thống
- **Linux** (Ubuntu 20.04+, CentOS 8+, Debian 11+)
- Quyền truy cập **Root** hoặc sudo
- **Python** 3.10+
- **Node.js** 18+

### Cài Đặt (Chỉ Với Một Lệnh)

```bash
curl -sSL https://raw.githubusercontent.com/phuspeed/CoPanel/main/scripts/install.sh | sudo bash
```

Trình cài đặt sẽ:
- ✅ Cài đặt các thư viện hệ thống cần thiết
- ✅ Tạo môi trường ảo Python (virtual environment)
- ✅ Cài đặt các thư viện phụ thuộc của backend & frontend
- ✅ Xây dựng các tệp tĩnh frontend (build assets)
- ✅ Cấu hình máy chủ proxy ngược Nginx (cổng 8686)
- ✅ Thiết lập dịch vụ Systemd
- ✅ Khởi chạy tất cả các dịch vụ

### Truy Cập

- **Giao diện Web**: http://localhost:8686
- **Backend API**: http://localhost:8000
- **Tài liệu API**: http://localhost:8000/docs

## 🔌 Tạo Một Module Mới

### Module Backend (Python/FastAPI)

1. Tạo thư mục: `backend/modules/{module_cua_ban}/`
2. Tạo tệp `router.py` và xuất một APIRouter của FastAPI:

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/info")
async def get_info():
    return {"message": "Module của bạn hoạt động rồi!"}
```

3. Tạo tệp `__init__.py` (tệp trống là được)
4. Khởi động lại dịch vụ: `systemctl restart copanel`

Module sẽ tự động tải tại đường dẫn `/api/{module_cua_ban}`!

### Module Frontend (React/TypeScript)

1. Tạo thư mục: `frontend/src/modules/{module_cua_ban}/`
2. Tạo tệp `config.ts`:

```typescript
import YourComponent from './index';

export default {
  name: 'Module Của Bạn',
  icon: 'Grid',  // Tên biểu tượng từ Lucide
  path: '/your-module',
  component: YourComponent,
  description: 'Mô tả module của bạn',
};
```

3. Tạo tệp `index.tsx` với component React của bạn
4. Biên dịch lại: `npm run build` (trong thư mục frontend)

Module sẽ tự động xuất hiện trên thanh bên!

## 📊 Module Theo Dõi Hệ Thống (Tham Chiếu)

Module System Monitor đi kèm minh họa kiến trúc pluggable:

### Backend API
- `GET /api/system_monitor/stats` - Toàn bộ thông số hệ thống
- `GET /api/system_monitor/cpu` - Thông số CPU
- `GET /api/system_monitor/memory` - Thông số Bộ nhớ RAM
- `GET /api/system_monitor/disk` - Thông số Đĩa
- `GET /api/system_monitor/network` - Thông số Mạng

### Bảng Điều Khiển Frontend
- Biểu đồ CPU/RAM thời gian thực (Recharts)
- Trực quan hóa dung lượng đĩa sử dụng
- Hiển thị thông tin hệ thống
- Tự động cập nhật mỗi 3 giây

## 🔒 Các Biện Pháp Bảo Mật Tốt Nhất

- ✅ Không dùng `shell=True` trong các cuộc gọi subprocess (ngăn chặn chèn lệnh trái phép)
- ✅ Làm sạch dữ liệu đầu vào (Input sanitization) cho tất cả các dữ liệu từ người dùng
- ✅ Xác thực dựa trên mã thông báo JWT
- ✅ Sẵn sàng hỗ trợ HTTPS (sử dụng với chứng chỉ của bạn)
- ✅ Cấu hình CORS cho môi trường phát triển
- ✅ Dịch vụ Systemd chạy với quyền người dùng không có đặc quyền cao (unprivileged user)

## 📝 Quản Lý Dịch Vụ

```bash
# Khởi chạy
systemctl start copanel

# Dừng
systemctl stop copanel

# Khởi động lại
systemctl restart copanel

# Xem nhật ký (logs)
journalctl -u copanel -f

# Kiểm tra trạng thái
systemctl status copanel
```

## 🛠️ Chế Độ Phát Triển

### Phát triển Backend

```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

API sẽ có sẵn tại `http://localhost:8000`
Tài liệu tương tác API tại `http://localhost:8000/docs`

### Phát triển Frontend

```bash
cd frontend
npm install
npm run dev
```

Máy chủ phát triển frontend tại `http://localhost:5173`
(Tự động chuyển tiếp (proxies) cuộc gọi API tới `http://localhost:8000`)

## 📦 Quét Thư Mục Module

### Trình Tải Backend (`core/loader.py`)
- Quét thư mục `backend/modules/`
- Tìm tệp `router.py` trong mỗi thư mục module
- Nhập động và đăng ký các router
- Gán tiền tố URL `/api/{module_name}`

### Trình Đăng Ký Frontend (`core/registry.ts`)
- Sử dụng `import.meta.glob` của Vite để nhập tĩnh
- Quét `frontend/src/modules/*/config.ts`
- Đăng ký các tuyến đường và các mục trên thanh bên
- Tự động cập nhật khi biên dịch lại

## 🎨 Tính Năng Giao Diện

- 🌙 Chế độ tối mặc định (Slate 950)
- 📱 Thiết kế phản hồi nhanh (Mobile-first)
- ⚡ Các biểu tượng từ Lucide React
- 🎨 Tạo kiểu với Tailwind CSS
- 🧩 Trực quan hóa dữ liệu bằng Recharts

## 📈 Hiệu Suất

- **Bộ nhớ khi không hoạt động**: < 100MB RAM
- **Thời gian khởi động**: < 5 giây
- **Phản hồi API**: < 100ms (hầu hết các endpoint)
- **Gói Frontend (Bundle)**: Được tối ưu hóa với Vite

## 🐛 Khắc Phục Sự Cố

### Backend không khởi động
```bash
journalctl -u copanel -f
```

### Nginx từ chối kết nối
```bash
nginx -t
systemctl restart nginx
```

### Module không tải
```bash
# Kiểm tra cấu trúc module
ls -la backend/modules/your_module/
# Đảm bảo router.py tồn tại
# Khởi động lại dịch vụ
systemctl restart copanel
```

### Frontend không cập nhật
```bash
cd frontend
npm run build
# Xóa bộ nhớ đệm trình duyệt (Ctrl+Shift+Delete)
```

## 📚 Tham Chiếu Thư Mục

| Đường dẫn | Mục đích |
|------|---------|
| `/opt/copanel` | Thư mục cài đặt (môi trường production) |
| `backend/modules/` | Thư mục plugin Backend |
| `frontend/src/modules/` | Thư mục plugin Frontend |
| `/opt/copanel/venv/` | Môi trường ảo Python |
| `/opt/copanel/frontend/dist/` | Các tệp tĩnh Frontend đã biên dịch |
| `/etc/systemd/system/copanel.service` | Tệp dịch vụ Systemd |
| `/etc/nginx/sites-available/copanel` | Cấu hình Nginx |

## 🤝 Đóng Góp

Để đóng góp cho dự án:
1. Fork repository
2. Tạo một module trong thư mục `modules/` thích hợp
3. Tuân thủ các hướng dẫn về cấu trúc module
4. Kiểm tra kỹ lưỡng
5. Gửi Pull Request

## 📄 Bản Quyền

Giấy phép MIT - Xem tệp LICENSE để biết thêm chi tiết

## 🎓 Tài Nguyên Học Tập

- **Tài liệu FastAPI**: https://fastapi.tiangolo.com
- **Tài liệu React**: https://react.dev
- **Hướng dẫn Vite**: https://vitejs.dev
- **TailwindCSS**: https://tailwindcss.com
- **Recharts**: https://recharts.org

## 📞 Hỗ Trợ

Nếu gặp sự cố, câu hỏi, hoặc đề xuất:
- GitHub Issues: Tạo một issue trong repository của dự án
- Tài liệu: Kiểm tra tệp README trong mỗi thư mục module

---

**Được xây dựng với ❤️ dành cho các Quản trị viên Hệ thống Linux**
