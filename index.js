/**
 * Pusher WebSocket Server (Soketi)
 * Entry point file to boot Soketi using config.json
 */

const fs = require('fs');
const path = require('path');

// 1. Baca config.json
const configPath = path.join(__dirname, 'config.json');
let config = {};
try {
    const raw = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(raw);
    console.log('[Soketi] Berhasil memuat config.json');
} catch (e) {
    console.error('[Soketi] Gagal memuat config.json:', e.message);
}

// 2. Mapping config.json ke Environment Variables (yang dimengerti Soketi)
const envMap = {
    'port': 'SOKETI_PORT',
    'appManager.driver': 'SOKETI_APP_MANAGER_DRIVER',
    'appManager.mysql.host': 'SOKETI_DB_MYSQL_HOST',
    'appManager.mysql.port': 'SOKETI_DB_MYSQL_PORT',
    'appManager.mysql.user': 'SOKETI_DB_MYSQL_USERNAME',
    'appManager.mysql.password': 'SOKETI_DB_MYSQL_PASSWORD',
    'appManager.mysql.database': 'SOKETI_DB_MYSQL_DATABASE'
};

for (const [jsonKey, envKey] of Object.entries(envMap)) {
    if (config[jsonKey] !== undefined) {
        process.env[envKey] = config[jsonKey];
    }
}

// 3. Jalankan Soketi Server
if (!process.argv.includes('start')) {
    process.argv.push('start');
}
require('@soketi/soketi/bin/server.js');
