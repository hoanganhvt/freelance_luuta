# Kiểm tra LUUTA Demo

- `npm test`: 9 kiểm tra đạt, gồm đăng nhập, bảo mật tiền công, ma trận đơn, khóa công đoạn, scope chuyền, QC/sửa/QC lại lặp, giao từng đợt, giao đủ toàn bộ size/màu, khóa tháng, điều chỉnh đơn giá và nhật ký bất biến, xuất XLSX và cảnh báo dựa trên năng suất.
- `npm run build`: thành công. Font và ảnh phác thảo được đóng gói tại dự án.
- Trình duyệt: đăng nhập Giám đốc, lưu 1 sản phẩm May của Nguyễn An trong LU-012/Đen/S, thấy thông báo thành công; số may tăng từ 54 lên 55 và tổng tháng tăng lên 818.
- Desktop 1440×1000: kiểm tra tổng quan, chỉ tiêu, 5 chuyền, biểu đồ, bảng đơn và điều hướng.
- iPad 768×1024: danh sách đơn và chi tiết/ma trận Màu × Size. Sidebar thu gọn có nhãn truy cập cho mọi nút. Bảng cuộn bên trong vùng, trang không tràn ngang.
- Điện thoại 375×812: báo cáo, nhập sản lượng và phản hồi thành công. Form 2 cột theo nhóm, trường đơn hàng và ghi chú full width; điều hướng nhanh 4 mục.
- Form tạo đơn trên điện thoại: Đen/M = 5 và Trắng/M = 10, tổng tự tính đúng 15. Thử xong hủy form, không tạo đơn giả trong dữ liệu.
- Điện thoại xoay ngang 812×375: kiểm tra vùng bảng và nhãn chỉ dành cho screen reader; giới hạn cuộn ngang trong bảng.
- Console của trình duyệt không có lỗi hoặc cảnh báo được ghi nhận trong lượt kiểm tra.
- WebMCP được thêm dưới dạng khả năng tùy chọn có feature detection; trình duyệt kiểm tra không cung cấp document.modelContext nên không đăng ký công cụ. Không khẳng định đã kiểm tra chạy WebMCP.

Đây là kiểm tra bằng kích thước trình duyệt, chưa kiểm tra trên iPad/iPhone vật lý hoặc nhiều người dùng trên mạng xưởng. Năng suất/cảnh báo dùng công thức demo được giải thích trong README.
