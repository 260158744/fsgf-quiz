#!/bin/bash
# ============================================================
#  SSL 证书生成脚本
#  用途: 为放射医学技术副高题库生成 HTTPS 证书
#
#  使用方法:
#    bash generate_ssl.sh [dev|prod]
#
#    dev   - 生成本地自签名证书（测试用，浏览器会警告）
#    prod  - 使用 Let's Encrypt 申请正式免费证书（需要域名）
#
#  注意: 生产环境请务必使用 prod 模式！
# ============================================================

set -e

MODE="${1:-dev}"
SSL_DIR="/etc/nginx/ssl"
DOMAIN="your-domain.com"        # ← 改成你的实际域名

echo "============================================"
echo "  SSL 证书生成工具"
echo "  模式: $MODE"
echo "============================================"

# ── 创建 SSL 目录 ──
sudo mkdir -p "$SSL_DIR"
cd "$SSL_DIR"

if [ "$MODE" = "dev" ]; then
    # ══════════════════════════════════
    #  开发模式: 自签名证书（测试用）
    # ══════════════════════════════════
    echo ""
    echo "[1/3] 生成本地自签名证书..."
    echo "  ⚠️  此证书仅用于本地测试，浏览器会显示安全警告"
    echo ""

    # 生成私钥 (RSA 2048)
    openssl genrsa -out fsgf_quiz.key 2048

    # 生成自签名证书 (有效期 365 天)
    openssl req -new -x509 \
        -key fsgf_quiz.key \
        -out fsgf_quiz.crt \
        -days 365 \
        -subj "/C=CN/ST=Beijing/L=Beijing/O=FSGF Quiz/CN=${DOMAIN}" \
        -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1"

    # 设置权限
    chmod 600 fsgf_quiz.key
    chmod 644 fsgf_quiz.crt

    echo "[2/3] 证书信息:"
    openssl x509 -in fsgf_quiz.crt -noout -subject -dates -issuer

    echo ""
    echo "[3/3] ✅ 自签名证书已生成:"
    echo "  证书: ${SSL_DIR}/fsgf_quiz.crt"
    echo "  私钥: ${SSL_DIR}/fsgf_quiz.key"
    echo ""
    echo "  下一步:"
    echo "  1. 将 nginx.conf 中 ssl_certificate 路径指向上述文件"
    echo "  2. sudo nginx -t && sudo systemctl reload nginx"
    echo "  3. 浏览器访问 https://${DOMAIN} （接受安全警告）"
    echo ""

elif [ "$MODE" = "prod" ]; then
    # ══════════════════════════════════
    #  生产模式: Let's Encrypt 正式证书
    # ══════════════════════════════════

    # 检查 certbot 是否安装
    if ! command -v certbot &> /dev/null; then
        echo "[1/4] 安装 Certbot..."
        if command -v apt-get &> /dev/null; then
            sudo apt-get update
            sudo apt-get install -y certbot
        elif command -v yum &> /dev/null; then
            sudo yum install -y certbot
        else
            echo "❌ 请手动安装 certbot: https://certbot.eff.org/"
            exit 1
        fi
    fi

    echo ""
    echo "[2/4] 使用 Let's Encrypt 申请证书..."
    echo "  域名: ${DOMAIN}"
    echo ""

    # 确保 HTTP 服务可用（Let's Encrypt 需要通过 HTTP 验证）
    sudo mkdir -p /var/www/certbot/.well-known/acme-challenge

    # 申请证书
    sudo certbot certonly --webroot \
        -w /var/www/certbot \
        -d "$DOMAIN" \
        --email admin@"${DOMAIN}" \
        --agree-tos \
        --no-eff-email \
        --force-renewal

    # Certbot 默认路径
    LETSENCRYPT_DIR="/etc/letsencrypt/live/${DOMAIN}"

    echo ""
    echo "[3/4] 复制证书到 Nginx 目录..."
    sudo cp "${LETSENCRYPT_DIR}/fullchain.pem" "${SSL_DIR}/fsgf_quiz.crt"
    sudo cp "${LETSENCRYPT_DIR}/privkey.pem"   "${SSL_DIR}/fsgf_quiz.key"
    # CA 证书链（用于 OCSP Stapling）
    sudo cp "${LETSENCRYPT_DIR}/chain.pem"      "${SSL_DIR}/fsgf_ca.crt"

    sudo chmod 600 "${SSL_DIR}/fsgf_quiz.key"
    sudo chmod 644 "${SSL_DIR}/fsgf_quiz.crt"

    echo ""
    echo "[4/4] 设置自动续期..."
    # 添加定时任务：每天凌晨 3 点检查并自动续期
    CRON_JOB="0 3 * * * certbot renew --quiet --deploy-hook 'systemctl reload nginx'"
    (sudo crontab -l 2>/dev/null | grep -v 'certbot'; echo "$CRON_JOB") | sudo crontab -

    echo ""
    echo "✅ Let's Encrypt 证书已申请成功!"
    echo "  证书: ${SSL_DIR}/fsgf_quiz.crt"
    echo "  私钥: ${SSL_DIR}/fsgf_quiz.key"
    echo "  自动续期: 已配置 (每天 3:00 检查)"
    echo ""
    echo "  证书信息:"
    sudo openssl x509 -in "${SSL_DIR}/fsgf_quiz.crt" -noout -subject -dates -issuer
    echo ""
    echo "  下一步:"
    echo "  1. 确保 nginx.conf 中 ssl_certificate 路径正确"
    echo "  2. sudo nginx -t && sudo systemctl reload nginx"
    echo "  3. 访问 https://${DOMAIN} 验证"
    echo ""

else
    echo "用法: $0 [dev|prod]"
    echo "  dev   - 自签名证书(测试用)"
    echo "  prod  - Let's Encrypt 正式证书(生产用)"
    exit 1
fi
