# Pusher Admin Dashboard

Multi-app Pusher-compatible WebSocket server (Soketi) dengan admin dashboard berbasis Vue 3.

## Fitur

- **Auth** — Register/login JWT, role admin/operator, 2FA (TOTP)
- **Apps** — CRUD multi-aplikasi, rotate key, duplicate, batch toggle, export JSON/CSV
- **Notify** — Trigger event ke channel, multi-channel broadcast, template payload, scheduled/delayed event
- **Monitoring** — Grafik event (Chart.js), server metrics (CPU/mem/uptime), message throughput, channel presence viewer
- **Logs** — Event logs, audit trail, webhook logs viewer & retry
- **Security** — IP whitelist per app, 2FA, password change, audit trail
- **Developer** — API docs, WebSocket debugger, code snippet generator (JS/Python/PHP/cURL), export config
- **UI/UX** — Landing page, collapsible sidebar, global search, multi-language (ID/EN), keyboard shortcuts, mobile responsive

## Stack

| Layer | Teknologi |
|-------|-----------|
| WebSocket | Soketi (Pusher protocol) |
| Backend | Node.js + Express |
| Frontend | Vue 3 + Vue Router 5 + Vite 8 |
| Database | MySQL |
| Auth | JWT + bcryptjs |
| 2FA | speakeasy + qrcode |
| Charts | Chart.js |
| Deploy | PM2 (ecosystem.config.js) |

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/coijiryuna/pusher-server.git
cd pusher-server
npm install
```

### 2. Database

Buat database MySQL, lalu import `db.sql`:

```bash
mysql -u root -p db_pusher < db.sql
```

### 3. Config

Edit `config.json`:

```json
{
  "port": 6001,
  "appManager.driver": "mysql",
  "appManager.mysql.host": "localhost",
  "appManager.mysql.port": 3306,
  "appManager.mysql.user": "db_pusher",
  "appManager.mysql.password": "password",
  "appManager.mysql.database": "db_pusher"
}
```

### 4. Build frontend

```bash
cd frontend
npm run build
cd ..
```

### 5. Run

```bash
# Development (soketi + admin dashboard)
npm run dev

# Production (PM2)
pm2 start ecosystem.config.js
```

Server berjalan di:
- **WebSocket**: `http://localhost:6001`
- **Dashboard**: `http://localhost:9000/dashboard`

## API Endpoints

Dokumentasi lengkap tersedia di dashboard setelah login → **Dokumentasi API**.

| Method | Path | Deskripsi |
|--------|------|-----------|
| POST | `/api/login` | Login user |
| POST | `/api/register` | Daftar user baru |
| GET | `/api/me` | Info user saat ini |
| GET/POST/PUT/DELETE | `/api/apps[/:id]` | CRUD aplikasi |
| POST | `/api/apps/:id/rotate-key` | Rotasi key & secret |
| POST | `/api/apps/:id/duplicate` | Duplikasi app |
| PATCH | `/api/apps/:id/toggle` | Enable/disable app |
| POST | `/api/apps/batch/toggle` | Batch toggle |
| POST | `/api/notify` | Trigger event Pusher |
| GET | `/api/event-logs` | Riwayat event |
| GET | `/api/audit-logs` | Log aktivitas user |
| GET | `/api/metrics` | Server metrics (CPU/mem) |
| GET | `/api/event-throughput` | Message throughput |
| GET | `/api/webhook-logs` | Webhook logs |
| GET/PUT | `/api/config` | Konfigurasi server |
| POST | `/api/change-password` | Ubah password |
| GET/PUT | `/api/apps/:id/ip-whitelist` | IP whitelist |
| POST | `/api/2fa/setup` | Setup 2FA |
| POST | `/api/2fa/enable` | Aktifkan 2FA |
| POST | `/api/2fa/disable` | Nonaktifkan 2FA |
| GET | `/api/2fa/status` | Status 2FA |

## Environment Variables

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `JWT_SECRET` | `pusher-dash-secret-change-in-prod` | Secret key JWT |
| `DASHBOARD_PORT` | `9000` | Port admin dashboard |

## MGINX

```
server
{
    listen 80;
    listen [::]:80;
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name push.baznastangerangkab.or.id;
    index index.html index.htm default.htm default.html;
    # root /home/www/pusher-server;
    
    #SSL-START SSL related configuration
    #error_page 404/404.html;
    ssl_certificate    /www/server/panel/vhost/cert/pusherserver/fullchain.pem;
    ssl_certificate_key    /www/server/panel/vhost/cert/pusherserver/privkey.pem;
    ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+CHACHA20-draft:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    add_header Strict-Transport-Security "max-age=31536000";
    error_page 497  https://$host$request_uri;
    #SSL-END
    
    #ERROR-PAGE-START  Error page related configuration
    #error_page 404 /404.html;
    #error_page 502 /502.html;
    #ERROR-PAGE-END
    
    
    #REWRITE-START Pseudo-static related configuration
    include /www/server/panel/vhost/rewrite/node_pusherserver.conf;
    #REWRITE-END
    
    #Files or directories forbidden to access
    location ~ ^/(\.user.ini|\.htaccess|\.git|\.svn|\.project|LICENSE|README.md|package.json|package-lock.json|\.env|node_modules) {
        return 404;
    }
    
    #One-click application for SSL certificate verification directory related settings
    location /.well-known/ {
        root  /home/www/pusher-server;
    }

    # HTTP reverse proxy related settings begin. You can make proxy cache settings here.>>>
    #location ~ /purge(/.*) {
    #    proxy_cache_purge cache_one $host$request_uri$is_args$args;
    #}
    
    location = / {
        return 302 /dashboard/;
    }

     # ── WebSocket (Soketi) ───────────────────────────────────────
    # all paths that begin with /app/ are handled by Soketi
    location ^~ / {
        proxy_pass http://127.0.0.1:3090;          # Soketi internal HTTP + WS port
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 30s;
    }

    # ── API (Express) ───────────────────────────────────────────
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # ── Dashboard (static files served by Express) ─────────────
    # everything else (/, /dashboard/*, assets, etc.) goes to Express
    location ^~ /dashboard/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # End of HTTP reverse proxy related settings <<<
    
    access_log  /www/wwwlogs/pusherserver.log;
    error_log  /www/wwwlogs/pusherserver.error.log;
}
```

## License

MIT © CoijiRyuna
