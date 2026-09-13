# TeachMate 原始文件服务

纯 Node.js 静态文件服务，为试卷和学生答卷原图提供受控的本地 HTTP 访问地址。业务服务会把原图以 base64 image part 传入 Pi Agent；本服务不负责识别、解析或评分。

默认端口：8002。
