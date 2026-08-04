# 放射医学技术副高题库 · 正式运营部署指南

> **版本**: v2.0 Production | **最后更新**: 2026-08-03

---

## 📋 部署架构总览

```
                    ┌─────────────┐
                    │   用户浏览器  │
                    └──────┬──────┘
                           │ HTTPS :443
                    ┌──────▼──────┐
                    │    Nginx     │ ← 反向代理 + SSL终结 + 静态文件缓存
                    │  (80/443)    │
                    └──────┬──────┘
                           │ HTTP :5000 (仅内网)
                    ┌──────▼──────┐
                    │ Flask 后端   │ ← Gunicorn + Gevent
                    │ (:5000)      │   SQLite 数据库
                    └─────────────┘
```

---

## 一、服务器环境要求

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| 操作系统 | Ubuntu 20.04+ / CentOS 8+ / Windows Server 2019+ | Ubuntu 22.04 LTS |
| CPU | 1 核 | 2 核+ |
| 内存 | 512 MB | 2 GB+ |
| 硬盘 | 1 GB 可用空间 | SSD 10 GB+ |
| Python | 3.10+ | 3.12+ |
| 域名 | 有（HTTPS 必需） | 已备案域名 |
| 公网 IP | 有 | 有 |

---

## 二、快速部署（Linux）

### Step 1: 安装依赖

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Python & pip
sudo apt install -y python3 python3-pip python3-venv nginx

# 安装 Python 依赖
pip3 install flask flask-cors gunicorn gevent

# （可选）安装 certbot 用于 Let's Encrypt
sudo apt install -y certbot python3-certbot-nginx
```

### Step 2: 部署题库文件

```bash
# 创建部署目录
sudo mkdir -p /opt/fsgf-quiz
sudo mkdir -p /opt/fsgf-quiz/{server,data,assets,logs,deploy}

# 上传项目文件到 /opt/fsgf-quiz/
# 需要上传的文件/目录:
#   ├── server/app.py          # 后端主程序
#   ├── data/questions_all.json # 题库数据（含答案，不放公网）
#   ├── assets/                # 前端资源
#   │   ├── js/
#   │   ├── css/
#   │   └── data/questions_public.js
#   ├── index.html             # 前端入口
#   └── deploy/                # 部署辅助文件

# 设置权限
sudo chown -R www-data:www-data /opt/fsgf-quiz
sudo chmod -R 755 /opt/fsgf-quiz
sudo chmod 600 /opt/fsgf-quiz/server/quiz_bank.db  # 数据库文件限制权限
```

### Step 3: 配置环境变量

```bash
# 创建环境变量文件
sudo tee /etc/default/fsgf-quiz > /dev/null << 'EOF'
# ══════════════════════════════════
#  FSGF Quiz 生产环境配置
#  ⚠️  请修改以下所有默认值！
# ══════════════════════════════════

# 用户访问密码（登录时需要输入的密码）
export FSGF_PASSWORD="你的用户访问密码"

# Token 加密密钥（必须为随机字符串，至少32位！）
# 生成命令: python3 -c "import secrets;print(secrets.token_hex(32))"
export FSGF_SECRET="在这里填入64位随机字符串"

# 监听地址（保持 127.0.0.1，通过 Nginx 对外暴露）
export FSGF_HOST="127.0.0.1"
export FSGF_PORT="5000"

# 调试模式（生产环境必须为 0！）
export FSGF_DEBUG="0"

# Session 有效期（小时），默认 720（30天）
export FSGF_SESSION_HOURS="720"
EOF

# 加载环境变量
source /etc/default/fsgf-quiz
```

### Step 4: 配置 Nginx

```bash
# 复制 Nginx 配置
sudo cp deploy/nginx.conf /etc/nginx/conf.d/fsgf_quiz.conf

# ⚠️  编辑配置，修改以下关键项:
sudo nano /etc/nginx/conf.d/fsgf_quiz.conf
```

**必须修改的配置项：**

```nginx
# 第 28 行: 改成你的实际域名或 IP
server_name quiz.yourdomain.com;

# 第 42-43 行: SSL 证书路径（先用自签名，后换正式证书）
ssl_certificate     /etc/nginx/ssl/fsgf_quiz.crt;
ssl_certificate_key /etc/nginx/ssl/fsgf_quiz.key;

# 第 139 行: 前端文件目录
root /opt/fsgf-quiz;
```

### Step 5: 申请 SSL 证书

**方式 A: Let's Encrypt（推荐，免费）**

```bash
# 确保域名已解析到服务器 IP，且 Nginx 已启动
sudo systemctl start nginx

# 申请证书（自动配置 Nginx）
sudo certbot --nginx -d quiz.yourdomain.com --email admin@yourdomain.com --agree-tos --no-eff-email

# 测试自动续期
sudo certbot renew --dry-run
```

**方式 B: 自签名证书（测试用）**

```bash
# 使用项目自带脚本
sudo bash deploy/generate_ssl.sh dev

# 或手动生成
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/fsgf_quiz.key \
  -out /etc/nginx/ssl/fsgf_quiz.crt \
  -subj "/CN=quiz.yourdomain.com"
```

### Step 6: 配置 Systemd 服务（开机自启）

```bash
# 复制服务文件
sudo cp deploy/fsgf-quiz.service /etc/systemd/system/

# 编辑服务文件中的环境变量路径
sudo nano /etc/systemd/system/fsgf-quiz.service
# 确保 EnvironmentFile=/etc/default/fsgf-quiz

# 重载并启动
sudo systemctl daemon-reload
sudo systemctl enable fsgf-quiz
sudo systemctl start fsgf-quiz

# 检查状态
sudo systemctl status fsgf-quiz
journalctl -u fsgf-quiz -f  # 实时查看日志
```

### Step 7: 启动 Nginx 并测试

```bash
# 测试 Nginx 配置
sudo nginx -t

# 启动 Nginx
sudo systemctl enable nginx
sudo systemctl restart nginx

# 测试健康检查
curl https://quiz.yourdomain.com/health

# 测试完整流程
# 1. 浏览器打开 https://quiz.yourdomain.com
# 2. 输入用户密码登录
# 3. 答题 → 提交 → 查看结果
# 4. 点击 Logo 5 次 → 进入管理后台
# 5. 用 admin / Fsgf@Admin2026! 登录
# 6. ⚠️ 立即修改管理员密码！
```

---

## 三、Windows Server 部署

### 方式一：直接运行（适合小规模使用）

```batch
:: 1. 设置环境变量
set FSGF_PASSWORD=你的用户密码
set FSGF_SECRET=64位随机字符串
set FSGF_DEBUG=0

:: 2. 运行生产启动脚本
start_prod.bat
```

### 方式二：NSSM 注册为 Windows 服务

```powershell
# 1. 下载 NSSM: https://nssm.cc/download
# 2. 安装服务
nssm install FSGFQuiz

# 3. 在弹出的 GUI 中设置:
#    Path: C:\Python311\python.exe
#    Arguments: D:\fsgf-quiz\server\app.py
#    Directory: D:\fsgf-quiz\server
#    Environment: FSGF_PASSWORD=xxx&FSGF_SECRET=xxx&FSGF_DEBUG=0

# 4. 启动服务
nssm start FSGFQuiz
```

### Windows Nginx 配置

1. 下载 Nginx for Windows: https://nginx.org/en/download.html
2. 解压到 `C:\nginx\`
3. 将 `deploy/nginx.conf` 内容复制到 `C:\nginx\conf\nginx.conf`
4. 修改 `server_name` 和路径
5. 启动: `C:\nginx\nginx.exe`

---

## 四、防火墙配置

```bash
# Ubuntu (ufw)
sudo ufw allow 80/tcp    # HTTP (用于证书申请)
sudo ufw allow 443/tcp   # HTTPS
# 注意: 5000 端口不要对外开放！仅 Nginx 内部转发

# CentOS (firewalld)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## 五、安全检查清单

部署完成后，请逐项确认：

- [ ] **已修改用户访问密码** (`FSGF_PASSWORD` ≠ 默认值)
- [ ] **已修改管理员密码** (首次登录后立即修改)
- [ ] **已设置 `FSGF_SECRET`** 为 64 位随机字符串
- [ ] **`FSGF_DEBUG=0`** (生产环境关闭调试模式)
- [ ] **5000 端口未对外暴露** (仅 127.0.0.0 监听)
- [ ] **SSL 证书有效** (非自签名，或已信任自签名)
- [ ] **HTTP 自动跳转 HTTPS**
- [ ] **数据库文件权限正确** (`chmod 600 quiz_bank.db`)
- [ ] **Nginx 版本号已隐藏** (`server_tokens off`)
- [ ] **已配置自动备份** (数据库定期备份)

---

## 六、默认凭证（首次启动）

| 角色 | 用户名 | 默认密码 | 首次操作 |
|------|--------|---------|---------|
| 管理员 | `admin` | `Fsgf@Admin2026!` | **立即修改！** |
| 用户 | — | `Quiz@Rad2026!` | 通过环境变量自定义 |

> ⚠️ 以上默认密码仅供首次启动。**正式上线前必须全部修改！**

---

## 七、常用运维命令

```bash
# 查看日志
tail -f /opt/fsgf-quiz/logs/app.log          # 应用日志
tail -f /var/log/nginx/fsgf_quiz_access.log   # 访问日志
tail -f /var/log/nginx/fsgf_quiz_error.log    # 错误日志
journalctl -u fsgf-quiz -f                     # 服务日志

# 重启服务
sudo systemctl restart fsgf-quiz              # 重启后端
sudo systemctl restart nginx                  # 重启 Nginx

# 数据库备份
cp /opt/fsgf-quiz/server/quiz_bank.db /backup/fsgf_$(date +%Y%m%d_%H%M%S).db

# 清理过期会话（可加入 crontab）
sqlite3 /opt/fsgf-quiz/server/quiz_bank.db "DELETE FROM sessions WHERE expires_at < datetime('now');"
```

---

## 八、故障排查

| 问题 | 可能原因 | 解决方法 |
|------|---------|---------|
| 502 Bad Gateway | Flask 未启动 | `systemctl status fsgf-quiz` |
| 504 Gateway Timeout | 请求超时 | 增加 `proxy_read_timeout` |
| SSL 证书错误 | 证书路径不对或过期 | 检查 nginx.conf 中 ssl_certificate 路径 |
| 登录提示"密码错误" | 密码未同步 | 检查环境变量是否生效 |
| 静态文件 404 | root 路径错误 | 检查 nginx.conf 中 root 路径 |
| CORS 错误 | ALLOWED_ORIGINS 未配置 | 设置 `FSGF_ALLOWED_ORIGINS` |

---

## 九、目录结构（部署后）

```
/opt/fsgf-quiz/
├── index.html                 # 前端入口
├── start_prod.bat             # Windows 生产启动脚本
├── assets/
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js
│   │   ├── api.js
│   │   ├── quiz.js
│   │   ├── store.js
│   │   ├── gamify.js
│   │   ├── report.js
│   │   └── data/
│   │       └── questions_public.js  # 无答案的前端数据
├── server/
│   ├── app.py                 # ✅ 已安全加固的后端
│   └── quiz_bank.db           # SQLite 数据库
├── data/
│   └── questions_all.json     # 完整题库（含答案，仅服务器可读）
├── logs/
│   ├── app.log                # 应用日志
│   ├── access.log             # Gunicorn 访问日志
│   └── error.log              # Gunicorn 错误日志
└── deploy/
    ├── nginx.conf             # Nginx 反向代理配置
    ├── generate_ssl.sh        # SSL 证书生成脚本
    ├── fsgf-quiz.service      # Systemd 服务文件
    └── DEPLOYMENT.md          # 本文档
```
