#!/bin/bash
set -e

echo ""
echo "============================================"
echo "   SSL Certificate Setup (Let's Encrypt)"
echo "============================================"
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
    error "Please run as root: sudo bash setup-ssl.sh"
fi

DOMAIN=""
API_DOMAIN=""

read -p "Enter your main domain (e.g. myapi.com): " DOMAIN
read -p "Enter your API subdomain (e.g. api.myapi.com, or press Enter to use same): " API_DOMAIN

if [ -z "$API_DOMAIN" ]; then
    API_DOMAIN=$DOMAIN
fi

if [ -z "$DOMAIN" ]; then
    error "Domain is required."
fi

info "Installing certbot..."
apt-get update -qq && apt-get install -y -qq certbot

info "Stopping nginx to free port 80..."
docker compose stop nginx

info "Requesting certificate for ${DOMAIN} and ${API_DOMAIN}..."
certbot certonly --standalone \
    -d "${DOMAIN}" \
    -d "${API_DOMAIN}" \
    --non-interactive \
    --agree-tos \
    --register-unsafely-without-email \
    --keep-until-expiring

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
    error "Certificate generation failed."
fi

info "Copying certificates to nginx/certs/..."
cp "${CERT_DIR}/fullchain.pem" nginx/certs/
cp "${CERT_DIR}/privkey.pem" nginx/certs/

info "Generating SSL nginx config..."
cat > nginx/conf.d/default.conf << SSLCONF
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}

server {
    listen 443 ssl http2;
    server_name ${API_DOMAIN};

    ssl_certificate /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://new-api:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_connect_timeout 30s;

        proxy_buffering off;
    }
}

server {
    listen 80;
    server_name ${DOMAIN} ${API_DOMAIN};
    return 301 https://\$host\$request_uri;
}
SSLCONF

info "Setting up auto-renewal..."
cat > /etc/cron.d/letsencrypt-renew << CRON
0 3 * * * root certbot renew --quiet --post-hook "cp /etc/letsencrypt/live/${DOMAIN}/fullchain.pem $(pwd)/nginx/certs/ && cp /etc/letsencrypt/live/${DOMAIN}/privkey.pem $(pwd)/nginx/certs/ && docker compose -f $(pwd)/docker-compose.yml restart nginx"
CRON

info "Starting nginx..."
docker compose start nginx

echo ""
echo "============================================"
echo "   SSL Setup Complete!"
echo "============================================"
echo ""
echo "  Main site:  https://${DOMAIN}"
echo "  API endpoint: https://${API_DOMAIN}"
echo ""
echo "  Certificates auto-renew via cron."
echo "============================================"
