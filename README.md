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
git clone https://github.com/CoijiRyuna/pusherserver.git
cd pusherserver
npm install
cd frontend && npm install && cd ..
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
# API backend — Express (server.js port 9000)
server {
    listen 443 ssl http2;
    server_name wspush.your-domain.my.id;

    # SSL cert (Let's Encrypt buat wspush.your-domain.my.id)

    location /api {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# WebSocket — Soketi (port 3090)
server {
    listen 443 ssl http2;
    server_name wspush.your-domain.my.id;

    # SSL cert buat wspush.your-domain.my.id

    location / {
        proxy_pass http://127.0.0.1:3090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}

```

## License

MIT © CoijiRyuna
