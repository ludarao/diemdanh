# Kế hoạch nâng cấp phần mềm điểm danh chung

Ngày lập: 13/10/2026. Cập nhật kế hoạch: 15/10/2026. Repo: https://github.com/ludarao/diemdanh; phần khảo sát ban đầu dùng commit 44b1ade. Bản điểm danh PostgreSQL/Supabase, admin và phân quyền chỉ xem theo nhóm đã được triển khai trên Vercel. Mục 12 và 13 được thực hiện trong bản nâng cấp quyền theo nhóm và cách gọi sản phẩm. Hướng dẫn cấu hình tại `docs/HUONG_DAN_TRIEN_KHAI.md`.

## 1. Kết quả xem mã nguồn

- Ứng dụng HTML/CSS/JavaScript thuần, triển khai Vercel; Google Apps Script nhận dữ liệu và ghi Google Sheets.
- `google_apps_script.js`: khóa toàn bộ lượt ghi bằng ScriptLock; mỗi lượt đọc lịch sử để kiểm tra thiết bị và người đổi máy, sau đó ghi và định dạng từng dòng. Đây là điểm nghẽn có thể thấy từ thiết kế; chưa đo độ trễ ứng dụng thực tế.
- `app.js`: gửi bằng `no-cors`, không đọc phản hồi để xác nhận dữ liệu đã lưu nhưng vẫn hiển thị thành công khi fetch hoàn tất.
- Định danh đang dựa vào họ tên nhập tay; chưa có danh sách lớp chuẩn, mã học viên ổn định, bảng phiên hoặc thời gian đi muộn.
- Cảnh báo thiết bị so theo ngày; chống gửi lặp chỉ kiểm tra dòng cuối cùng trong cùng giây. Chức năng khóa thiết bị phía trình duyệt đang bị comment.
- Mã thiết bị lưu localStorage, có thành phần ngẫu nhiên; nhận diện một hồ sơ trình duyệt, không bảo đảm nhận diện phần cứng. Xóa dữ liệu hoặc đổi trình duyệt có thể đổi mã.
- GPS và trạng thái do phía trình duyệt gửi, Apps Script chưa kiểm tra lại khoảng cách hay thời hạn phiên.
- Repo còn bản sao nguồn trong `downloads/`; cần xác định thư mục nguồn triển khai trước khi sửa để tránh hai phiên bản lệch nhau.

## 2. Kiến trúc đề xuất

Giữ Vercel; dùng PostgreSQL do Supabase quản lý, Supabase Auth cho quản trị/giảng viên (trang admin đăng nhập bằng tài khoản và mật khẩu) và Supabase Realtime cho dashboard. Ràng buộc đã chốt: giữ nguyên giao diện điểm danh gốc (bố cục, CSS, trường nhập, nút, thao tác và trang biên nhận). Chỉ thay tích hợp gửi/lưu dữ liệu sang API và database mới. Dashboard là trang quản trị riêng, không thay thế trang học viên. Không viết lại giao diện bằng framework. Thông báo lưu/lỗi chỉ điều chỉnh khi cần phản ánh đúng kết quả server; mọi thay đổi trường ngày hiện có phải giữ giao diện gốc, server vẫn dùng giờ nhận để tính phiên.

Luồng đã chốt: học viên mở trang/QR chung, nhập tên và gửi điểm danh → server lưu nguyên bản tên, thời gian nhận và dữ liệu GPS/thiết bị → tự phân phiên theo lịch trong dashboard → dò tên với danh sách gốc → trả biên nhận đã lưu → dashboard cập nhật. Học viên không chọn sáng/chiều, không phải nhập mã học viên hoặc đăng nhập; dashboard quản trị vẫn cần đăng nhập.

Server giữ khóa đặc quyền trong biến môi trường. Không cho trang học viên tự ghi trạng thái, thời gian hoặc đọc danh sách cả lớp. Giảng viên chỉ xem/sửa lớp được phân công; quản trị quản lý danh sách và phân quyền. Dùng RLS và kiểm tra quyền trên API.

Bản triển khai dùng Supabase Postgres Changes với RLS cho admin, lọc theo lớp và kiểm tra ngày/phiên; khi kết nối lại tải snapshot mới. Đối chiếu mỗi 60 giây khi Realtime kết nối, dự phòng mỗi 15 giây khi mất kết nối; tải một lần ở mốc giờ của phiên, gộp các sự kiện gần nhau. Tab ẩn/mục khác dừng tự gọi API dashboard. Mục tiêu cập nhật Realtime trong vài giây khi kết nối tốt, phải kiểm chứng bằng đo tải.

Tài liệu tham khảo: https://supabase.com/docs/guides/realtime/subscribing-to-database-changes ; https://supabase.com/docs/guides/database/postgres/row-level-security

## 3. Phiên và thời gian — cập nhật theo xác nhận người dùng

- Phiên chỉ quản lý và hiển thị trong dashboard. Học viên dùng trang/QR chung; server phân phiên bằng giờ nhận, không yêu cầu học viên chọn phiên.
- Mẫu sáng 07:00–08:00, chiều 13:30–14:00; múi giờ Asia/Ho_Chi_Minh. Toàn bộ khoảng này tính đúng giờ; sau hạn này tính muộn và vẫn nhận bản ghi.
- Dashboard cho tạo lịch theo ngày hoặc áp dụng mẫu rồi chỉnh từng ngày; hỗ trợ phiên khác và ngày nghỉ.
- Tách giờ mở, hạn đúng giờ và hạn nhận muộn. Hạn đúng giờ mặc định 08:00/14:00. Hạn nhận muộn đã được đồng ý: sáng đến trước 13:30, chiều đến hết ngày; lúc 13:30 trở đi thuộc phiên chiều. Với lịch tùy chỉnh, hạn nhận muộn sáng là giờ mở phiên tiếp theo, phiên cuối ngày đến hết ngày.
- Chính xác tại hạn đúng giờ được tính đúng giờ; sau hạn đó mới muộn. Ví dụ 08:00:00 đúng giờ, 08:00:01 muộn. Số phút muộn tính từ hạn đúng giờ, không tính từ giờ mở.
- Trước giờ mở hoặc ngoài mọi khoảng nhận: vẫn lưu bản ghi, hiện “Chưa xác định phiên” để quản trị kiểm tra; không âm thầm bỏ hoặc gán sai phiên. Lịch trùng khoảng nhận phải được ngăn hoặc đưa vào kiểm tra thủ công.
- Khi chưa hết hạn đúng giờ: chưa điểm danh. Sau hạn đúng giờ: không có bản ghi có mặt khớp danh sách hoặc phép được duyệt thì hiển thị vắng tại thời điểm đó. Nếu điểm danh muộn được nhận tiếp trong khoảng nhận muộn, kết quả tự chuyển từ vắng sang đi muộn.
- Phân biệt “Đã hết giờ đúng giờ — vẫn nhận muộn” với “Đã kết thúc nhận”. Phiên hủy/ngày nghỉ không tính vắng.
- Thời gian server là nguồn chuẩn. Giờ lưu UTC, hiển thị giờ Việt Nam. Giữ trường ngày đang có trong giao diện gốc; ngày do học viên gửi chỉ lưu như dữ liệu khai báo, không dùng để thay đổi giờ nhận, phiên hoặc kết quả đúng giờ/muộn.
- Đổi lịch sau khi có dữ liệu phải ghi nhật ký; xem trước ảnh hưởng khi phân lại phiên/tính lại muộn, giữ giờ nhận gốc.

## 4. Trạng thái và lý do

Mỗi học viên trong danh sách phiên có đúng một kết quả chính: chưa điểm danh, đúng giờ, đi muộn, vắng có phép hoặc vắng không phép. Lý do và cảnh báo là dữ liệu riêng.

| Tình huống | Hiển thị |
| --- | --- |
| Phiên mở, chưa có bản ghi có mặt | Chưa điểm danh |
| Có mặt trong hạn đúng giờ | Có mặt — đúng giờ |
| Có mặt sau hạn đúng giờ, trong khoảng nhận muộn | Đi muộn — kèm số phút muộn |
| Gửi báo vắng hoặc lý do muộn | Hiện lý do và nhãn chờ duyệt |
| Lý do vắng được duyệt | Vắng có phép |
| Đã hết hạn đúng giờ, không có mặt và không có phép được duyệt | Vắng không phép; giữ lý do chờ duyệt nếu có |
| Nhiều học viên dùng cùng mã thiết bị trong một phiên | Cảnh báo trùng thiết bị trên tất cả học viên liên quan |

Tab “Có lý do” chứa cả yêu cầu chờ duyệt, được duyệt, bị từ chối; không coi việc nhập lý do là tự được phép. Người báo vắng sau đó đến lớp có thể điểm danh hợp lệ trong khoảng nhận của phiên; kết quả thành có mặt/đi muộn, vẫn giữ lịch sử báo vắng.

Trùng thiết bị là cờ kiểm tra, không tự kết luận gian lận hoặc đổi kết quả thành vắng. So các lượt có mặt có tên khác nhau hoặc đã liên kết học viên khác nhau trong cùng phiên; bản ghi tên chưa khớp vẫn tham gia cảnh báo, cùng tên gửi lại không tự coi là nhiều người; gửi lý do không chiếm thiết bị. Có xử lý ngoại lệ dùng chung máy do giảng viên xác nhận.

## 5. Dashboard

Đầu trang: ngày, lớp, phiên, khung giờ, trạng thái chưa mở/đúng giờ/đang nhận muộn/đã kết thúc, thời điểm cập nhật và trạng thái kết nối.

Thẻ số liệu: tổng học viên phải tham gia, có mặt đúng giờ, đi muộn, chưa điểm danh, vắng có phép, vắng không phép. Các nhóm chính cộng bằng tổng danh sách phiên. Cảnh báo trùng thiết bị và số yêu cầu có lý do là số bổ sung có thể chồng lên các nhóm, không cộng vào tổng. Số bản ghi không khớp danh sách gốc cũng là số riêng, không làm tăng sĩ số hoặc số có mặt của lớp.

Danh sách ưu tiên: vắng; vắng/đi muộn có lý do; chưa điểm danh; trùng thiết bị; đã gửi nhưng không có trong danh sách gốc; tên trùng cần kiểm tra; chưa xác định phiên; tất cả. Bộ lọc tìm tên, đơn vị, tình trạng duyệt. Danh sách vắng gồm cả vắng có phép và không phép, phân biệt rõ từng loại.

Cột: họ tên gốc, tên đã nhập, đơn vị/lớp, kết quả, thời gian điểm danh, phút muộn, nội dung lý do, tình trạng duyệt, cảnh báo và thao tác. Trùng thiết bị hiển thị theo nhóm mã thiết bị, tất cả học viên và giờ gửi liên quan.

Thao tác: xem chi tiết, duyệt/từ chối lý do, ghi nhận thủ công, giải quyết cảnh báo, chỉnh lịch phiên, đóng/mở lại phiên và xuất CSV. Sửa thủ công cần lý do và lưu người sửa/thời gian; tránh xóa lịch sử gốc. Mục “Không có trong danh sách gốc” hiển thị nguyên tên đã nhập, giờ nhận, phiên, đơn vị, lý do và mã thiết bị; cho quản trị liên kết thủ công với đúng học viên hoặc xác nhận là người ngoài danh sách. Sau liên kết, kết quả và danh sách vắng cập nhật; giữ nguyên bản ghi gốc và lịch sử xử lý.

## 6. Trang admin, danh sách lớp và cài đặt vị trí

Yêu cầu đã chốt: thêm trang `/admin` riêng, quản lý bằng mật khẩu; giữ nguyên giao diện điểm danh của học viên.

### Đăng nhập và bảo vệ trang admin

- Đăng nhập bằng tài khoản quản trị và mật khẩu qua Supabase Auth; có đăng xuất và đổi/khôi phục mật khẩu.
- Không lưu mật khẩu trong mã nguồn, `config.js` hoặc localStorage; không kiểm tra mật khẩu chỉ bằng JavaScript trên trình duyệt.
- Mọi API quản trị phải xác thực phiên đăng nhập và quyền, kể cả khi gọi trực tiếp không qua giao diện admin. Chặn người chưa đăng nhập đọc danh sách lớp, sửa lịch, tọa độ hoặc bán kính.
- Quản trị được quản lý lớp và tài khoản; nếu phân công giảng viên thì chỉ cấp quyền cho lớp được giao. Giới hạn thử đăng nhập theo cơ chế dịch vụ xác thực.

### Mẫu nhập danh sách lớp

- Có nút tải mẫu CSV UTF-8 và bảng nhập trực tiếp trong admin, phục vụ sao chép/dán danh sách từ Excel. Không bắt buộc mã học viên.
- Mẫu người dùng cung cấp gồm bốn cột: `TT`, `Họ và tên` (bắt buộc), `Ngày sinh`, `Đơn vị`. Bộ nhập nhận `.xlsx`, CSV và nội dung dán từ Excel, tự bỏ qua sheet trống. Chọn lớp ở admin trước khi nhập; mỗi file chứa danh sách một lớp.
- Ví dụ: `Nguyễn Văn An` / `Đơn vị A`; `Trần Thị Bình` / `Đơn vị B`.
- Cho thêm/sửa/ngừng sử dụng học viên trong danh sách gốc. Mỗi dòng có ID nội bộ, không lấy tên làm khóa duy nhất.
- Nhập file phải xem trước: tổng dòng, tên trống, dòng trùng và người trùng tên. Chỉ ghi khi người quản lý xác nhận kết quả xem trước; không âm thầm gộp người trùng tên.
- Chọn rõ thêm vào danh sách hoặc thay thế danh sách hiện hành, xem trước ảnh hưởng. Ngừng sử dụng/thay danh sách không xóa lịch sử điểm danh và danh sách phiên đã chụp.
- Sửa tên gốc hoặc đối chiếu bản ghi tên sai phải có nhật ký; không tự thay đổi kết quả các phiên cũ khi chưa xem trước và thực hiện tính lại.

### Vị trí lớp và khoảng cách cho phép

- Chọn lớp/phòng; nhập vĩ độ, kinh độ và bán kính cho phép điểm danh tính bằng mét. Có nút lấy vị trí hiện tại bằng GPS trình duyệt để điền tọa độ, sau đó cho kiểm tra/chỉnh trước khi lưu.
- Hiển thị tọa độ, bán kính hiện tại và thời điểm/người cập nhật. Kiểm tra vĩ độ từ -90 đến 90, kinh độ từ -180 đến 180, bán kính là số dương hữu hạn.
- Giữ cấu hình mặc định ban đầu theo repo: bán kính 100 m, ngưỡng sai số GPS 150 m; admin có thể chỉnh ngưỡng sai số GPS riêng nếu cần. Bán kính khoảng cách và sai số GPS là hai thông số khác nhau.
- Lưu cấu hình trong database, không cần sửa `config.js` hay triển khai lại để đổi địa điểm. Trang học viên lấy cấu hình qua API; server tự tính lại khoảng cách từ tọa độ gửi lên và kiểm tra theo cấu hình hiện hành.
- Cấu hình lớp/phòng là mặc định cho phiên mới. Mỗi phiên lưu bản chụp cấu hình vị trí/bán kính để lịch sử có thể kiểm tra lại.
- Nếu đổi cấu hình cho phiên đang nhận điểm danh, admin phải chọn áp dụng cho phiên hiện tại hoặc chỉ các phiên tiếp theo. Ghi nhật ký và phiên bản cấu hình áp dụng cho từng lượt; bản ghi đã nhận không tự bị đánh lại hợp lệ/không hợp lệ.
- Tọa độ GPS phía học viên vẫn do trình duyệt cung cấp; kiểm tra lại ở server không biến GPS thành bằng chứng tuyệt đối.

Các mục admin: tổng quan theo phiên; danh sách lớp; lịch phiên; vị trí và bán kính; tên không khớp; lý do/cảnh báo; tài khoản và nhật ký.

## 7. Dữ liệu tối thiểu

| Bảng | Nội dung |
| --- | --- |
| students | ID nội bộ, họ tên gốc, tên chuẩn hóa, đơn vị; không yêu cầu mã học viên |
| classes / enrollments | Lớp, học viên thuộc lớp, thời gian hiệu lực |
| classroom_settings | Tọa độ lớp/phòng, bán kính cho phép, ngưỡng sai số GPS, phiên bản cấu hình, người và giờ cập nhật |
| sessions | Lớp, ngày, tên phiên, giờ mở/hạn đúng giờ/hạn nhận muộn, phòng và bán kính GPS, trạng thái |
| session_roster | Chụp danh sách phải tham gia khi tạo phiên; sửa có nhật ký |
| attendance_records | Một kết quả chính cho mỗi học viên mỗi phiên; giờ server, thiết bị, GPS |
| attendance_attempts | Lưu mọi lượt gửi với tên nguyên bản, tên chuẩn hóa, giờ server, phiên có thể để trống, học viên có thể để trống, trạng thái khớp/không khớp/mơ hồ, thiết bị, GPS, lý do và khóa retry |
| reason_requests | Loại vắng/muộn, nội dung, trạng thái duyệt, người duyệt |
| device_flags | Nhóm cảnh báo theo phiên/thiết bị, học viên liên quan, cách xử lý |
| staff_roles / audit_logs | Phân quyền theo lớp và lịch sử thay đổi |

Unique `(session_id, student_id)` cho kết quả; index `(session_id, device_id)` cho tra trùng. Retry cùng request ID trả lại cùng biên nhận. Ghi có mặt, kiểm tra thiết bị và cập nhật cảnh báo trong transaction, khóa theo phiên/thiết bị để hai người gửi đồng thời vẫn bị phát hiện. Không áp unique một thiết bị/một phiên vì cần ghi và hiển thị tất cả trường hợp trùng.

### Dò tên theo danh sách gốc

Đã chốt dùng tên, không bắt buộc mã học viên hoặc tài khoản học viên. ID nội bộ chỉ phục vụ database và xử lý các dòng danh sách.

- Giữ nguyên tên người dùng nhập. Chuẩn hóa Unicode, bỏ khoảng trắng đầu/cuối, gộp khoảng trắng liên tiếp và không phân biệt chữ hoa/thường để so sánh; vẫn giữ dấu tiếng Việt và thứ tự các từ.
- Khớp đúng một tên trong danh sách lớp: liên kết học viên và tính kết quả phiên.
- Không khớp: vẫn lưu đầy đủ, trả thông báo đã ghi nhận lượt gửi, đưa vào danh sách “Đã gửi nhưng không có trong danh sách gốc”. Không tự sửa lỗi chính tả, bỏ dấu, đảo tên hoặc ghép tên gần giống.
- Tên sai chưa được liên kết không làm học viên trong danh sách thành có mặt. Học viên đó vẫn ở chưa điểm danh/vắng cho đến khi quản trị đối chiếu hoặc nhận được lần gửi đúng.
- Nếu nhiều học viên có cùng tên chuẩn hóa: đưa vào “Tên trùng cần kiểm tra”, không đánh dấu tất cả cùng có mặt. Đơn vị có thể hiển thị để người quản lý đối chiếu, không tự thay thế quy tắc dò tên đã chốt.
- Một tên gửi lại với request ID khác được giữ trong lịch sử nhưng chỉ có một kết quả chính khi đã khớp học viên; đổi thiết bị cần giữ dấu vết. Retry cùng request ID không tạo bản ghi lặp, kể cả tên không khớp.
- Chỉnh danh sách gốc hoặc liên kết thủ công phải có nhật ký và tính lại số liệu liên quan. Không tự thêm người không khớp vào danh sách lớp.

## 8. Chuyển dữ liệu và triển khai

1. Nhập danh sách học viên theo tên và lớp; kiểm tra tên trùng; chốt hạn nhận muộn và quy tắc gán phiên tự động.
2. Tạo database, migration, phân quyền và API; thêm đăng nhập admin bằng mật khẩu, mẫu nhập danh sách và cài đặt tọa độ/bán kính; thử dữ liệu giả, chưa cắt Sheet đang dùng.
3. Chuyển giao diện học viên sang API mới, giữ trang/QR chung và nhập tên; chỉ báo thành công sau xác nhận lưu.
4. Tạo dashboard theo phiên, cập nhật trực tiếp, duyệt lý do và nhật ký chỉnh sửa.
5. Xuất Sheet cũ sang CSV, lưu bản gốc, đối chiếu tên với danh sách gốc; tên trùng phải đối chiếu thủ công. Dữ liệu cũ không có phiên: chỉ gán khi timestamp và lịch xác định được, còn lại ghi “lịch sử chưa xác định phiên”. Không suy diễn kết quả vắng lịch sử khi thiếu danh sách hoặc phiên.
6. Chạy thử một lớp trên database mới, so số liệu và kiểm tra đồng thời; chọn thời điểm chuyển chính thức. Sheet cũ chỉ lưu bản sao lịch sử, luồng chạy mới không phụ thuộc Sheet. Giữ phương án quay lại trước khi bỏ webhook.

Thứ tự MVP: danh sách lớp → phiên và lịch → điểm danh API → dashboard và danh sách tên không khớp → lý do/duyệt → trùng thiết bị → nhập lịch sử/xuất báo cáo.

## 9. Tiêu chí nghiệm thu

- Cùng học viên điểm danh sáng và chiều tạo hai kết quả độc lập.
- Retry/gửi đồng thời cùng học viên không tạo hai kết quả chính.
- Hai học viên dùng cùng thiết bị gửi đồng thời được cảnh báo cho cả hai; không cảnh báo chéo phiên.
- Khi hết hạn đúng giờ, học viên chưa điểm danh xuất hiện trong vắng; lượt muộn tiếp theo chuyển đúng người sang đi muộn; dashboard thay đổi theo thời gian dù không có lượt gửi mới.
- Kiểm tra đúng tại hạn và sau hạn đúng giờ, ranh giới nhận muộn/phân phiên, ngày Việt Nam và đồng hồ điện thoại lệch; phiên hủy không tính vắng.
- Duyệt/từ chối lý do, báo vắng rồi đến lớp, mở lại/chỉnh lịch, học viên trùng tên đều cho kết quả nhất quán.
- Tên sai/không dấu/đảo tên vẫn được lưu vào mục không khớp, không tăng có mặt; tên trùng không tự gán nhiều học viên. Liên kết thủ công cập nhật đúng số liệu và giữ tên nhập gốc.
- Học viên không thấy/chọn phiên; giờ server tự phân sáng/chiều. Lượt ngoài lịch được lưu để kiểm tra.
- Mất mạng/retry không báo thành công giả; kết nối lại dashboard khớp database.
- Giảng viên không đọc/sửa lớp ngoài quyền, học viên không đọc danh sách lớp hoặc tự sửa kết quả.
- Chưa đăng nhập admin không gọi được API quản trị; đăng xuất hết quyền thao tác. Mật khẩu và khóa đặc quyền không xuất hiện trong mã trình duyệt.
- Nhập mẫu danh sách giữ đúng dấu tiếng Việt, báo tên trống/trùng trước khi lưu; thay danh sách không xóa lịch sử.
- Đổi tọa độ/bán kính qua admin có hiệu lực theo phạm vi đã chọn, không cần triển khai lại; server và trang học viên dùng cấu hình nhất quán. Kiểm tra ngay trong/ngoài bán kính và GPS vượt ngưỡng sai số.
- Đối chiếu giao diện điểm danh với bản gốc: bố cục, CSS, trường nhập và thao tác không bị thay đổi bởi trang admin mới.
- Thử số người gửi đồng thời bằng hoặc cao hơn quy mô lớp thực tế; đo thời gian lưu và độ trễ dashboard, kiểm tra số bản ghi và cảnh báo thay vì chỉ nhìn tốc độ.

## 10. Xác nhận và điểm còn cần chốt

Đã xác nhận: toàn bộ 07:00–08:00 và 13:30–14:00 là đúng giờ, sau đó là muộn; học viên nhập tên, không yêu cầu mã; phiên sáng/chiều chỉ ở dashboard; tên không khớp vẫn lưu và có danh sách riêng để người quản lý tự đối chiếu.

Đã đồng ý thêm: sáng muộn đến trước 13:30, chiều muộn đến hết ngày; giữ nguyên giao diện gốc, chỉ cập nhật tích hợp database; dashboard quản trị là trang riêng.

Đã yêu cầu bổ sung: trang admin quản lý bằng mật khẩu, mẫu nhập danh sách lớp, chỉnh vị trí lớp và khoảng cách điểm danh; lưu các cấu hình này vào database.

Còn cần chốt trước triển khai: quy mô lớp và số người gửi đồng thời; lý do có cần duyệt hay chỉ ghi nhận (kế hoạch hiện đề xuất có duyệt).

Chưa ước tính chi phí hosting hoặc cam kết tốc độ trước khi biết quy mô và đo tải.

## 11. Bản mã nguồn đã thực hiện

- Giữ nguyên từng byte của `index.html` và `style.css` gốc; `app.js` gọi API và lấy cấu hình mới, thông báo lưu không còn phụ thuộc Sheets.
- Trang `/admin`: đăng nhập mật khẩu, dashboard, Excel/CSV xem trước, thêm/sửa học viên, đối chiếu tên, đồng bộ danh sách phiên, ghi nhận thủ công, duyệt lý do, trùng thiết bị, lịch ngày, tọa độ/bán kính, đổi mật khẩu và nhật ký.
- Kết quả chính mỗi học viên/phiên được tính từ lịch sử gửi, không cần bảng kết quả bị trùng. Giữ mọi lượt gửi cùng khóa idempotency.
- Mẫu Excel đã được đọc thành công: 80 dòng dữ liệu, bốn cột, không có lỗi nhập hoặc tên trùng theo quy tắc chuẩn hóa. File thật chỉ giữ trong thư mục `.local/` bị loại khỏi Git và bản build.
- Có hai vai trò: admin toàn ứng dụng và lớp trưởng chỉ xem Tổng quan của lớp được giao. Admin cấp/giao/khóa tài khoản và cấp lại mật khẩu. Phân quyền giảng viên sửa từng lớp vẫn chưa triển khai.
- Lịch mặc định tự tạo khi có truy cập trong ngày. Có thể tạo trước theo ngày trong admin; chưa có thao tác tạo hàng loạt theo khoảng ngày hoặc thêm phiên thứ ba.
- Chưa nhập lịch sử Google Sheets vì chưa có file lịch sử và quy tắc đối chiếu; dữ liệu lịch sử cũ không tự chuyển.
- Supabase Auth/Realtime và cấu hình Vercel cần kiểm chứng trên tài khoản/project thật sau bước cấu hình của người dùng.
- Sửa lỗi phiên tạo trước danh sách: tự phục hồi snapshot rỗng và khớp lại tên chính xác/duy nhất trong các lượt đã gửi. Giữ nguyên tên nhập, giờ nhận, lý do và trạng thái duyệt; snapshot đã có học viên không bị thay thế tự động. Không cần migration mới.

- Bổ sung Dữ liệu & xóa lớp: xóa kết quả của từng lớp giữ danh sách/lịch/cài đặt; xóa lớp cùng toàn bộ dữ liệu lớp; hoặc xóa tất cả dữ liệu lớp học. Giữ tài khoản admin và cấu trúc hệ thống. Có xem trước số lượng, nhập câu xác nhận, kiểm tra dữ liệu thay đổi và transaction hoàn tác khi lỗi; cho tạo lớp mới sau khi xóa lớp cuối cùng.

- Triển khai lớp trưởng chỉ đọc: bảng class_viewers, vai trò trên admin_users, migration 003/004, kiểm tra API/RLS theo lớp; khóa/gỡ quyền kiểm tra mỗi request. Lớp trưởng không sửa, duyệt, xuất CSV hoặc xóa; chỉ xem chi tiết và lọc dashboard. Giữ giao diện học viên gốc.


## 12. Kế hoạch mở thêm quyền cho người quản lý nhóm (đã thực hiện)

Người dùng yêu cầu người quản lý nhóm được nhập danh sách nhóm được giao, chỉnh lịch từng ngày và khung giờ mặc định. Giữ bố cục giao diện người tham gia hiện tại, cập nhật câu chữ theo thuật ngữ chung và quyền quản trị toàn ứng dụng của admin.

### Quyền theo từng nhóm được giao

- Xem Tổng quan: giữ quyền hiện tại.
- Nhập danh sách: admin có thể bật/tắt. Cho xem danh sách, tải mẫu, xem trước Excel/CSV/dán bảng, nhập thêm/thay thế, và đồng bộ vào phiên của đúng nhóm sau xác nhận. Thêm/sửa/ngừng sử dụng từng người tham gia bằng tay vẫn dành cho admin trong phạm vi bản này.
- Chỉnh lịch: admin có thể bật/tắt. Cho chỉnh giờ sáng/chiều riêng từng ngày và bốn mốc giờ mặc định của đúng nhóm. Hủy/mở lại ngày nghỉ giữ cho admin trong phạm vi bản này.
- Duyệt lý do, sửa/gán lại kết quả, ghi nhận thủ công, xử lý thiết bị, xuất CSV, GPS/bán kính, đổi tên/mã/default nhóm, tạo/xóa nhóm, xóa dữ liệu và quản lý tài khoản vẫn dành cho admin.
- Tài khoản/nhóm khác giữ nguyên giới hạn. Tài khoản chưa được bật hai quyền vẫn chỉ xem.

### Database và API

1. Thêm migration với `can_import_roster` và `can_edit_schedule` trên `class_viewers`, mặc định false cho các liên kết hiện có. Admin quản lý quyền khi cấp/giao nhóm và có thể điều chỉnh riêng sau đó. Không đổi tài khoản Supabase, không cần thêm dịch vụ hoặc khóa.
2. Thay kiểm tra một vai trò chung bằng kiểm tra quyền theo thao tác và nhóm. Các thao tác đọc/nhập danh sách, sửa lịch phải kiểm tra nhóm được giao và quyền tương ứng. Gửi kèm class_id khi xem trước nhập; kiểm tra lại trước lưu. Đồng bộ dùng session_id phải tìm nhóm của phiên ở server để kiểm tra, không tin class_id do trình duyệt gửi. Thu hồi quyền phải có hiệu lực ở yêu cầu mới và được kiểm tra trước khi ghi dữ liệu.
3. Thêm API chỉ lưu bốn mốc giờ mặc định. Không mở `save-class` cho người quản lý nhóm vì API đó hiện sửa cả GPS/bán kính, tên/mã và nhóm mặc định. Lịch mặc định mới phục vụ ngày/phiên tự tạo sau đó; lịch riêng hoặc phiên đã tạo được giữ nguyên, cần chỉnh riêng ngày khi muốn thay.
4. Tiếp tục ghi nhật ký người/nhóm/thời điểm và thay đổi. Giữ ghi qua API server; không mở quyền ghi trực tiếp cho authenticated trong RLS. Chính sách đọc theo nhóm hiện có tiếp tục sử dụng.

### Giao diện

- Tài khoản người quản lý nhóm ở admin: thêm hai tùy chọn “Cho nhập danh sách” và “Cho chỉnh lịch”. Hiển thị quyền đang được cấp trong danh sách tài khoản.
- Người quản lý nhóm được cấp quyền sẽ thấy thêm Danh sách nhóm và/hoặc Lịch điểm danh. Lịch có phần khung mặc định và lịch riêng ngày; không hiển thị các mục cài đặt vị trí.
- Chuyển nhóm phải cập nhật nút và quyền theo đúng nhóm, xóa bản xem trước nhập cũ. Hộp xác nhận nhập cần hiển thị tên nhóm và số người tham gia bị ảnh hưởng.
- Tiếp tục bảo toàn danh sách phiên đã có lượt gửi; đồng bộ được xác nhận riêng. Khi đổi lịch có lượt gửi, xem số lượt chịu ảnh hưởng và xác nhận việc phân lại phiên/tính lại đúng giờ, muộn. Giờ gửi gốc được giữ.

### Kiểm thử và triển khai

- Kiểm thử từng tổ hợp chỉ xem/nhập danh sách/chỉnh lịch/cả hai; quyền admin giữ nguyên.
- Người quản lý nhóm A không thể đọc/ghi B bằng đổi class_id, session_id hoặc gửi payload có cài đặt GPS, tên nhóm hay vai trò admin. Bật quyền chỉnh mặc định không cho gọi save-class.
- Nhập thêm/thay thế và đồng bộ chỉ tác động đúng nhóm; chuyển nhóm giữa xem trước và lưu hoặc bị thu hồi quyền không làm nhập nhầm.
- Chỉnh mặc định giữ lịch riêng/phiên đã tạo, chỉnh riêng một ngày không làm đổi mặc định; lịch có dữ liệu vẫn có xác nhận và nhật ký.
- Chạy kiểm thử, build và QA bằng dữ liệu giả trước; chạy migration rồi deploy. Admin bật quyền cho các người quản lý nhóm hiện có sau khi triển khai.

Đánh giá: mức thay đổi vừa. Tái sử dụng được parser Excel/CSV, nhập danh sách, lịch ngày và hệ thống nhật ký; phần cần làm thêm tập trung ở quyền theo nhóm, API giờ mặc định, giao diện cấp quyền và kiểm thử chống vượt quyền. Đã thực hiện migration 005, kiểm tra quyền API/transaction, API giờ mặc định và giao diện cấp quyền. Quyền mới vẫn tắt cho các tài khoản cũ đến khi admin bật.


## 13. Chuyển cách gọi sản phẩm thành phần mềm điểm danh chung (đã thực hiện)

Người dùng sẽ sử dụng ứng dụng cho nhiều mục đích ngoài lớp học. Tên sản phẩm thống nhất là **Điểm danh**; mô tả là **Hệ thống điểm danh và quản lý người tham gia**. Đơn vị tổ chức dùng tên chung **Nhóm điểm danh**, có thể là lớp học, bộ phận, nhóm làm việc, đoàn tham gia hoặc nhóm của một hoạt động. Một phiên là một lần/khung thời gian điểm danh của nhóm. Việc đổi thuật ngữ không tự bổ sung chức năng quản lý sự kiện, phân ca hay quy trình mới.

Các yêu cầu trong mục 12 áp dụng cho người quản lý nhóm và nhóm được giao. Những mô tả lớp học/lớp trưởng ở phần lịch sử của kế hoạch phản ánh bản cũ; thuật ngữ mới của mục này là chuẩn cho lần cập nhật sắp tới.

### Thuật ngữ và nhãn thống nhất

| Nhãn/cách gọi hiện tại | Nhãn/cách gọi mới |
| --- | --- |
| Quản trị lớp học | Quản lý điểm danh |
| Lớp / Chọn lớp | Nhóm điểm danh / Chọn nhóm |
| Tên lớp / Mã liên kết lớp | Tên nhóm / Mã liên kết nhóm |
| Lớp mặc định của trang điểm danh chung | Nhóm mặc định của trang điểm danh chung |
| Học viên | Người tham gia |
| Sĩ số | Tổng số người trong danh sách phiên |
| Danh sách lớp | Danh sách người tham gia |
| Danh sách gốc | Danh sách của nhóm |
| Lớp trưởng | Người quản lý nhóm |
| Tài khoản lớp trưởng | Tài khoản quản lý nhóm |
| Giao / đổi lớp | Giao / đổi nhóm |
| Lịch điểm danh | Lịch & phiên điểm danh |
| Vị trí & cài đặt | Vị trí & cấu hình |
| Cài đặt lớp & vị trí | Cấu hình nhóm & vị trí điểm danh |
| Dữ liệu & xóa lớp | Quản lý dữ liệu |
| Xóa lớp học | Xóa nhóm điểm danh |
| Trang điểm danh học viên | Trang điểm danh |
| Ngày nghỉ / hủy cả hai phiên | Không tổ chức điểm danh ngày này |

Giữ các từ chung đã phù hợp như Họ và tên, Đơn vị, Có mặt, Vắng, Đi muộn, Lý do và Trùng thiết bị. Sáng/Chiều vẫn là hai phiên hiện tại; việc thêm số phiên hoặc tên phiên tùy ý là yêu cầu riêng nếu cần sau này. Giờ mặc định hiện có được giữ khi cập nhật cách gọi.

### Câu chữ và hướng dẫn

- Rà soát tiêu đề trình duyệt, thương hiệu, menu, bộ lọc, nhãn biểu mẫu, nút, placeholder, tooltip, aria-label, thông báo lỗi/thành công, nội dung rỗng, hộp xác nhận và nhật ký hiển thị.
- Viết hướng dẫn theo hành động: “Chọn nhóm cần nhập danh sách”; “Danh sách này chỉ được lưu vào nhóm đang chọn”; “Người quản lý chỉ thao tác trong nhóm được giao và theo quyền admin cấp”.
- Giải thích phiên là khoảng thời gian điểm danh. Phân biệt khung mặc định với lịch riêng ngày; đổi khung mặc định không thay lịch riêng/phiên đã tạo. Thay hướng dẫn “chỉ xem” cố định bằng hướng dẫn phù hợp các quyền thực tế được cấp ở mục 12.
- Hướng dẫn nhập danh sách nêu rõ Excel/CSV hoặc dán bảng, xem trước, thêm/thay thế và đồng bộ vào phiên. Họ và tên là trường bắt buộc; Ngày sinh và Đơn vị tiếp tục cho phép để trống theo khả năng hiện có. Không ép người dùng ngoài giáo dục phải nhập ngày sinh, không bỏ dữ liệu ngày sinh cũ.
- Mẫu tải xuống và tên file xuất dùng từ “điểm danh/người tham gia”; giữ khả năng đọc mẫu Excel/CSV bốn cột cũ. Tên mẫu mới dự kiến MAU_DS_DIEM_DANH.csv.
- Hộp xác nhận xóa nêu chính xác nhóm, số người/lượt/phiên bị ảnh hưởng, dữ liệu giữ lại và tính không hoàn tác; câu xác nhận dùng “XÓA NHÓM …” hoặc “XÓA ĐIỂM DANH …”.
- Cập nhật README, hướng dẫn triển khai/sử dụng và ví dụ sang nhóm điểm danh chung, với ví dụ lớp học, họp, tập huấn hoặc nhóm làm việc. Không hiển thị thuật ngữ database hoặc mã phân quyền cho người dùng nếu không cần thiết để thao tác.

### Giữ tương thích và giao diện

- Giữ bố cục, màu sắc, cách nhập và luồng gửi điểm danh đã quen. Người dùng đã yêu cầu đổi nhãn/câu chữ, nên HTML có thể đổi phần văn bản; kiểm thử giữ nguyên từng byte HTML gốc cần thay bằng kiểm tra thay đổi có kiểm soát về nội dung và QA bố cục. CSS gốc được giữ nếu không có nhu cầu xử lý nhãn mới dài hơn.
- Không đổi hàng loạt tên bảng classes/students/class_viewers hoặc ID trong database chỉ để đổi tên gọi. Không sửa tên nhóm do người dùng đã đặt (ví dụ “Lớp học”, “Lớp 2”) một cách tự động.
- Tiếp tục hỗ trợ đường dẫn ?class=... và mã liên kết đang dùng; chữ “class” trong URL là chi tiết tương thích kỹ thuật. Trong bản đổi câu chữ không bắt buộc chuyển sang ?group=...; nếu bổ sung sau thì vẫn giữ đường dẫn cũ hoạt động.
- Giữ tài khoản, liên kết phân quyền, dữ liệu và lịch sử hiện có. RLS/API vẫn giới hạn người quản lý trong nhóm được giao.

### Thứ tự và kiểm tra

Thực hiện cùng đợt bổ sung quyền ở mục 12: chốt bảng thuật ngữ → cập nhật API/thông báo và giao diện → cập nhật mẫu/tài liệu → kiểm thử quyền và đối chiếu bố cục. Kiểm tra nhãn dài ở màn hình nhỏ, đồng nhất cách gọi giữa admin/trang điểm danh/CSV, tương thích mẫu và URL cũ, và không còn hướng dẫn “chỉ xem” khi tài khoản đã được cấp quyền nhập/chỉnh lịch.

Đánh giá: phần bổ sung chủ yếu là rà soát nội dung và QA giao diện. Việc đổi thuật ngữ không cần migration đổi tên dữ liệu; migration mới của mục 12 vẫn chỉ phục vụ cấp quyền. Đã chuẩn hóa câu chữ trong trang điểm danh, admin, API/thông báo, mẫu và tài liệu; giữ cấu trúc trang/CSS và URL cũ.
