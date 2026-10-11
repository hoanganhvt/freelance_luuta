# LUUTA trên Cloudflare Free

Website: https://luuta-production.luuta-uranus.workers.dev

Account: `anhnb.uranus@gmail.com`. Cấu hình khóa account ID trong `cloudflare.config.ts` để tránh deploy nhầm account.

- React/Vite và ảnh mẫu: Workers Static Assets.
- API Express: Workers qua adapter HTTP.
- Dữ liệu chung: D1 `luuta-production`, vùng APAC. Không cần bật máy local hoặc tunnel.
- Mật khẩu trên D1: PBKDF2 dùng Web Crypto; tài khoản demo vẫn dùng `Luuta@2026`.
- Báo cáo Excel: API lọc và kiểm tra quyền; trình duyệt tạo `.xlsx` để giảm CPU Workers.
- Mỗi request ghi được commit bằng D1 batch nguyên tử. Nếu dữ liệu thay đổi từ lúc đọc, toàn bộ batch bị rollback và trả 409; tải lại trang rồi lưu lại.

## Cập nhật web

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:worker
npm.cmd run deploy
```

`test:worker` build web rồi kiểm tra trên workerd/Miniflare: đăng nhập HTTPS, quy trình sản xuất, phân quyền báo cáo, ghi đồng thời và rollback. `deploy` dùng cf CLI.

Nếu đổi account: `npx.cmd cf auth login --force`, rồi cập nhật `accountId` và binding D1 trong `cloudflare.config.ts`.

## Migration

Migration đầu tiên đã áp dụng trên D1. Những lần cập nhật dữ liệu sau dùng file SQL mới trong `migrations/`, rồi chạy:

```powershell
npm.cmd run migrate:d1
```

Không sửa hoặc chạy lại migration đã áp dụng. Lệnh migration có ghi lịch sử để tránh áp dụng lại.

SQLite local trong `data/` vẫn tồn tại, độc lập với D1. `npm.cmd run dev` hoặc `npm.cmd start` dùng dữ liệu local; thao tác trên website public dùng D1. Deploy lại code không reset dữ liệu D1.

`node scripts/check-deployment.mjs` kiểm tra web public bằng tài khoản demo: assets, đăng nhập, dữ liệu, xuất Excel và logout. Lệnh tạo nhật ký đăng nhập.

## Giới hạn

Workers Free: 100.000 request/ngày và 10 ms CPU/request. D1 Free: 5 triệu dòng đọc/ngày, 100.000 dòng ghi/ngày, tổng 5 GB. API dashboard hiện đọc nhiều bảng; khi dữ liệu lớn cần phân trang. Giới hạn đăng nhập sai hiện lưu theo từng Worker instance.

Ảnh tải lên tối đa 1 MB để phù hợp giới hạn hàng dữ liệu D1; có thể dùng URL HTTPS cho ảnh lớn hơn. Excel được tải riêng khi xuất báo cáo.
