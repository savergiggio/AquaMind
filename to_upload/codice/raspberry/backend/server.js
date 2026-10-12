/**
 * AquaMind Backend Server
 * 
 * Features:
 * - REST API for sensor data, controls, schedules
 * - WebSocket for real-time updates
 * - Serial communication with Arduino
 * - USB Camera streaming via MJPEG
 * - SQLite database for history
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const Database = require('better-sqlite3');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const multer = require('multer'); // Middleware for handling multipart/form-data
const FormData = require('form-data'); // Required for forwarding file to ESP32


// ============== CONFIGURATION ==============
const PORT = process.env.PORT || 3001;
const SERIAL_PORT = process.env.SERIAL_PORT || '/dev/ttyACM0';
const SERIAL_BAUD = parseInt(process.env.SERIAL_BAUD) || 115200;
const CAMERA_DEVICE = process.env.CAMERA_DEVICE || '/dev/video0'; // Physical USB camera
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ============== DATABASE SETUP ==============
const dbPath = process.env.DB_PATH || './data/aquamind.db';
console.log('📁 Database path:', dbPath);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('📁 Created database directory:', dbDir);
}

const db = new Database(dbPath);
console.log('📁 Database connected successfully');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tanks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'esp32_wifi', -- 'arduino_local' or 'esp32_wifi'
    address TEXT, -- IP address or hostname for ESP32
    camera_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sensor_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    temp REAL,
    ph REAL,
    tds REAL,
    level INTEGER
  );

  CREATE TABLE IF NOT EXISTS controls (
    device_id TEXT PRIMARY KEY,
    tank_id INTEGER DEFAULT 1,
    state INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    device_id TEXT,
    label TEXT,
    days TEXT,
    start_time TEXT,
    end_time TEXT,
    quantity INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS alert_thresholds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    parameter TEXT NOT NULL,
    min_value REAL,
    max_value REAL,
    delta_value REAL,
    delta_minutes INTEGER DEFAULT 5,
    enabled INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS notification_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    provider TEXT DEFAULT 'ntfy',
    ntfy_server TEXT DEFAULT 'https://ntfy.sh',
    ntfy_topic TEXT,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    notify_device_triggers INTEGER DEFAULT 1,
    notify_thresholds INTEGER DEFAULT 1,
    notify_delta INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS alert_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT,
    parameter TEXT,
    message TEXT,
    value REAL
  );

  CREATE TABLE IF NOT EXISTS chihiros_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    address TEXT UNIQUE NOT NULL,
    model TEXT DEFAULT 'unknown',
    is_rgb INTEGER DEFAULT 0,
    brightness INTEGER DEFAULT 0,
    red INTEGER DEFAULT 0,
    green INTEGER DEFAULT 0,
    blue INTEGER DEFAULT 0,
    is_on INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    auto_mode INTEGER DEFAULT 0,
    on_time TEXT,
    off_time TEXT
  );

  CREATE TABLE IF NOT EXISTS maintenance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS maintenance_recurring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    type TEXT NOT NULL,
    description TEXT,
    frequency TEXT NOT NULL,
    interval INTEGER DEFAULT 1,
    weekdays TEXT,
    day_of_month INTEGER,
    start_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS water_parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    date TEXT NOT NULL,
    no2 REAL,
    no3 REAL,
    nh3 REAL,
    ph REAL,
    ph_source TEXT DEFAULT 'manual',
    gh REAL,
    kh REAL,
    po4 REAL,
    fe REAL,
    co2 REAL,
    o2 REAL,
    cl REAL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS fish_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    species TEXT,
    quantity INTEGER DEFAULT 1,
    date_added TEXT DEFAULT (date('now')),
    price REAL,
    photo_url TEXT,
    notes TEXT,
    status TEXT DEFAULT 'alive',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS plants_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    name TEXT NOT NULL,
    species TEXT,
    quantity INTEGER DEFAULT 1,
    date_added TEXT DEFAULT (date('now')),
    price REAL,
    photo_url TEXT,
    notes TEXT,
    status TEXT DEFAULT 'optimal',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tank_id INTEGER DEFAULT 1,
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ================= MIGRATIONS =================

const runMigration = (name, fn) => {
    try {
        fn();
        // console.log(`[Migration] ${name}: Success`);
    } catch (e) {
        if (!e.message.includes('duplicate column')) {
            console.error(`[Migration] ${name}: ${e.message}`);
        }
    }
};

// 1. Ensure tanks table exists and has default tank
// FORCE MIGRATION: Ensure camera_url exists independently of other checks
try {
    const columns = db.prepare('PRAGMA table_info(tanks)').all().map(c => c.name);
    if (!columns.includes('camera_url')) {
        db.prepare('ALTER TABLE tanks ADD COLUMN camera_url TEXT').run();
        console.log('[Migration] Added camera_url to tanks (Force Check)');
    }
} catch (e) {
    console.error('[Migration] Critical Error checking camera_url:', e.message);
}

// 1. Ensure tanks table exists and has default tank
runMigration('Create Default Tank', () => {
    // Check if tanks table is empty
    const check = db.prepare("SELECT count(*) as count FROM tanks").get();
    if (!check) { // Table newly created
        db.prepare("INSERT INTO tanks (id, name, type, address, camera_url) VALUES (1, 'Main Aquarium', 'arduino_local', ?, ?)").run('', process.env.CAMERA_DEVICE || '/dev/video0');
        console.log('[Migration] Created default Main Aquarium (ID: 1)');
    } else if (check.count === 0) {
        // Table exists but empty
        db.prepare("INSERT INTO tanks (id, name, type, address, camera_url) VALUES (1, 'Main Aquarium', 'arduino_local', ?, ?)").run('', process.env.CAMERA_DEVICE || '/dev/video0');
        console.log('[Migration] Inserted default Main Aquarium (ID: 1)');
    } else {
        // Migration: Ensure ID 1 exists
        console.log('[Migration] Tank 1 already exists');
    }
});

// 2. Add tank_id column to tables and backfill with 1
const tablesWithTankId = [
    'sensor_history', 'controls', 'schedules', 'alert_thresholds',
    'alert_log', 'chihiros_devices', 'maintenance_log', 'water_parameters', 'fish_inventory'
];

tablesWithTankId.forEach(table => {
    runMigration(`Add tank_id to ${table}`, () => {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN tank_id INTEGER DEFAULT 1`).run();
        console.log(`[Migration] Added tank_id to ${table}`);
        // Backfill existing data to tank_id = 1 (SQLite default does this, but being explicit is safe)
        db.prepare(`UPDATE ${table} SET tank_id = 1 WHERE tank_id IS NULL`).run();
    });
});

// 2b. Add Tank Dimensions columns if missing
runMigration('Add Tank Dimensions', () => {
    try {
        const tableInfo = db.prepare('PRAGMA table_info(tanks)').all();
        const columns = tableInfo.map(c => c.name);
        if (!columns.includes('width')) db.prepare('ALTER TABLE tanks ADD COLUMN width REAL').run();
        if (!columns.includes('height')) db.prepare('ALTER TABLE tanks ADD COLUMN height REAL').run();
        if (!columns.includes('depth')) db.prepare('ALTER TABLE tanks ADD COLUMN depth REAL').run();
        if (!columns.includes('volume')) db.prepare('ALTER TABLE tanks ADD COLUMN volume REAL').run();

        // Camera Image Controls
        if (!columns.includes('cam_brightness')) db.prepare('ALTER TABLE tanks ADD COLUMN cam_brightness REAL DEFAULT 0.0').run();
        if (!columns.includes('cam_contrast')) db.prepare('ALTER TABLE tanks ADD COLUMN cam_contrast REAL DEFAULT 1.0').run();
        if (!columns.includes('cam_saturation')) db.prepare('ALTER TABLE tanks ADD COLUMN cam_saturation REAL DEFAULT 1.0').run();

        console.log('[Migration] Checked/Added dimensions and camera control columns to tanks');
    } catch (err) {
        console.error('[Migration Error] Failed to add dimensions columns:', err);
    }
});

// 2c. Add firmware_version to tanks
runMigration('Add Firmware Version', () => {
    try {
        db.prepare('ALTER TABLE tanks ADD COLUMN firmware_version TEXT').run();
        console.log('[Migration] Added firmware_version to tanks');
    } catch (e) { /* Ignore if exists */ }
});

// 2c. Add mac_address to tanks for Autoset ID
runMigration('Add Mac Address', () => {
    try {
        // Check if column exists first to avoid error spam
        const columns = db.pragma('table_info(tanks)');
        if (!columns.some(c => c.name === 'mac_address')) {
            // Note: Cannot add UNIQUE constraint to existing table with data easily if defaults are null
            db.prepare('ALTER TABLE tanks ADD COLUMN mac_address TEXT').run();
            console.log('[Migration] Added mac_address to tanks');
        }
    } catch (e) {
        console.error('[Migration] Failed to add mac_address:', e.message);
    }
});

// 2d. Add reminder_time to maintenance tables
runMigration('Add Reminder Time', () => {
    try {
        const checkLog = db.prepare("PRAGMA table_info(maintenance_log)").all();
        if (!checkLog.some(c => c.name === 'reminder_time')) {
            db.prepare('ALTER TABLE maintenance_log ADD COLUMN reminder_time TEXT').run();
            console.log('[Migration] Added reminder_time to maintenance_log');
        }
        const checkRec = db.prepare("PRAGMA table_info(maintenance_recurring)").all();
        if (!checkRec.some(c => c.name === 'reminder_time')) {
            db.prepare('ALTER TABLE maintenance_recurring ADD COLUMN reminder_time TEXT').run();
            console.log('[Migration] Added reminder_time to maintenance_recurring');
        }
    } catch (e) {
        console.error('[Migration] Failed to add reminder_time:', e.message);
    }
});

// 2e. Add water_type to tanks
runMigration('Add Water Type', () => {
    try {
        const columns = db.prepare('PRAGMA table_info(tanks)').all().map(c => c.name);
        if (!columns.includes('water_type')) {
            db.prepare("ALTER TABLE tanks ADD COLUMN water_type TEXT DEFAULT 'freshwater'").run();
            console.log('[Migration] Added water_type to tanks');
        }
    } catch (e) {
        console.error('[Migration] Failed to add water_type:', e.message);
    }
});

// 2f. Add Water Level Sensor Config (min_distance, max_distance)
runMigration('Add Water Level Sensor Config', () => {
    try {
        const columns = db.prepare('PRAGMA table_info(tanks)').all().map(c => c.name);
        if (!columns.includes('min_distance')) {
            db.prepare('ALTER TABLE tanks ADD COLUMN min_distance REAL DEFAULT 5.0').run();
            console.log('[Migration] Added min_distance to tanks');
        }
        if (!columns.includes('max_distance')) {
            db.prepare('ALTER TABLE tanks ADD COLUMN max_distance REAL DEFAULT 15.0').run();
            console.log('[Migration] Added max_distance to tanks');
        }
        if (!columns.includes('ph_offset')) {
            db.prepare('ALTER TABLE tanks ADD COLUMN ph_offset REAL DEFAULT 0.0').run();
            console.log('[Migration] Added ph_offset to tanks');
        }
        if (!columns.includes('tds_k_value')) {
            db.prepare('ALTER TABLE tanks ADD COLUMN tds_k_value REAL DEFAULT 1.0').run();
            console.log('[Migration] Added tds_k_value to tanks');
        }
        if (!columns.includes('temp_offset')) {
            db.prepare('ALTER TABLE tanks ADD COLUMN temp_offset REAL DEFAULT 0.0').run();
            console.log('[Migration] Added temp_offset to tanks');
        }
        if (!columns.includes('light_watts')) {
            db.prepare('ALTER TABLE tanks ADD COLUMN light_watts REAL DEFAULT 0.0').run();
            console.log('[Migration] Added light_watts to tanks');
        }
        if (!columns.includes('heater_watts')) {
            db.prepare('ALTER TABLE tanks ADD COLUMN heater_watts REAL DEFAULT 0.0').run();
            console.log('[Migration] Added heater_watts to tanks');
        }
    } catch (e) {
        console.error('[Migration] Failed to add sensor config:', e.message);
    }
});

// 8. Ensure camera URLs use physical device
runMigration('Ensure Camera URLs use Physical Device', () => {
    try {
        const stmt = db.prepare("UPDATE tanks SET camera_url = '/dev/video0' WHERE camera_url = '/dev/video0' OR camera_url IS NULL OR camera_url = ''");
        const result = stmt.run();
        console.log(`[Migration] Updated ${result.changes} tank(s) to use camera /dev/video0`);
    } catch (error) {
        console.error('[Migration] Failed to update camera URLs:', error);
    }
});

// 9. Force update Tank 1 camera to video0
runMigration('Force Tank 1 Camera to video0', () => {
    try {
        const stmt = db.prepare("UPDATE tanks SET camera_url = '/dev/video0' WHERE id = 1");
        const result = stmt.run();
        console.log(`[Migration] Force updated Tank 1 camera_url to /dev/video0`);
    } catch (error) {
        console.error('[Migration] Failed to force update Tank 1 camera:', error);
    }
});

// 3. Other Migrations (Legacy)

// Migration: Add photo_url column if it doesn't exist
try {
    db.prepare('ALTER TABLE fish_inventory ADD COLUMN photo_url TEXT').run();
    console.log('[Migration] Added photo_url column to fish_inventory');
} catch (e) {
    if (!e.message.includes('duplicate column name')) {
        console.error('[Migration] Error adding photo_url:', e.message);
    }
}

// Migration: Add quantity column if it doesn't exist (for existing databases)
try {
    const columns = db.pragma('table_info(schedules)');
    const hasQuantity = columns.some(col => col.name === 'quantity');
    if (!hasQuantity) {
        console.log('Migrating schedules table: adding quantity column...');
        db.exec('ALTER TABLE schedules ADD COLUMN quantity INTEGER DEFAULT 1');
        console.log('Migration completed successfully');
    }
} catch (err) {
    console.error('Migration error:', err.message);
}

// Migration: Add auto_mode, on_time, off_time to chihiros_devices
try {
    const chihirosColumns = db.pragma('table_info(chihiros_devices)');
    const hasAutoMode = chihirosColumns.some(col => col.name === 'auto_mode');
    if (!hasAutoMode) {
        console.log('Migrating chihiros_devices table: adding auto scheduling columns...');
        db.exec('ALTER TABLE chihiros_devices ADD COLUMN auto_mode INTEGER DEFAULT 0');
        db.exec('ALTER TABLE chihiros_devices ADD COLUMN on_time TEXT');
        db.exec('ALTER TABLE chihiros_devices ADD COLUMN off_time TEXT');
        console.log('Chihiros migration completed');
    }
} catch (err) {
    console.error('Chihiros migration error:', err.message);
}

// Migration: Add new water parameters (Mg, K, SiO2, NH4, Cu, Ca)
try {
    const wpColumns = db.pragma('table_info(water_parameters)');
    const colNames = wpColumns.map(c => c.name);

    if (!colNames.includes('mg')) db.prepare('ALTER TABLE water_parameters ADD COLUMN mg REAL').run();
    if (!colNames.includes('k')) db.prepare('ALTER TABLE water_parameters ADD COLUMN k REAL').run();
    if (!colNames.includes('sio2')) db.prepare('ALTER TABLE water_parameters ADD COLUMN sio2 REAL').run();
    if (!colNames.includes('nh4')) db.prepare('ALTER TABLE water_parameters ADD COLUMN nh4 REAL').run();
    if (!colNames.includes('cu')) db.prepare('ALTER TABLE water_parameters ADD COLUMN cu REAL').run();
    if (!colNames.includes('ca')) db.prepare('ALTER TABLE water_parameters ADD COLUMN ca REAL').run();

    console.log('[Migration] Checked/Added new water parameters (Mg, K, SiO2, NH4, Cu, Ca)');
} catch (err) {
    console.error('[Migration] Water parameters migration error:', err.message);
}

// Migration: Add TDS column if missing (Replacing Salinity for new data)
try {
    const shColumns = db.pragma('table_info(sensor_history)');
    const colNames = shColumns.map(c => c.name);
    if (!colNames.includes('tds')) {
        db.prepare('ALTER TABLE sensor_history ADD COLUMN tds REAL').run();
        console.log('[Migration] Added tds column to sensor_history');
    }
} catch (err) {
    console.error('[Migration] TDS column error:', err.message);
}

// Migration: Disable legacy Salinity alerts (since values are incompatible with TDS)
try {
    const check = db.prepare("SELECT count(*) as count FROM alert_thresholds WHERE parameter = 'salinity' AND enabled = 1").get();
    if (check && check.count > 0) {
        db.prepare("UPDATE alert_thresholds SET enabled = 0 WHERE parameter = 'salinity'").run();
        console.log('[Migration] Disabled legacy Salinity alerts (incompatible with TDS)');
    }
} catch (err) {
    console.error('[Migration] Alert migration error:', err.message);
}

// Migration: Fix controls table unique constraint (device_id -> device_id + tank_id)
try {
    const controlsInfo = db.pragma('table_info(controls)');
    const pkColumns = controlsInfo.filter(c => c.pk > 0);
    // If only device_id is PK (count 1), we need to migrate to composite PK
    if (pkColumns.length === 1 && pkColumns[0].name === 'device_id') {
        console.log('Migrating controls table: updating primary key constraint...');

        // 1. Rename old table
        db.exec('ALTER TABLE controls RENAME TO controls_old');

        // 2. Create new table with composite PK
        db.exec(`
          CREATE TABLE controls (
            device_id TEXT,
            tank_id INTEGER DEFAULT 1,
            state INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (device_id, tank_id)
          )
        `);

        // 3. Copy data back
        // We only copy matching columns.
        db.exec('INSERT INTO controls (device_id, tank_id, state, updated_at) SELECT device_id, tank_id, state, updated_at FROM controls_old');

        // 4. Drop old table
        db.exec('DROP TABLE controls_old');

        console.log('Controls table migration completed successfully');

        // Trigger re-init for all tanks to ensure gaps are filled
        const tanks = db.prepare('SELECT id FROM tanks').all();
        tanks.forEach(t => initializeControlsForTank(t.id));
    }
} catch (err) {
    console.error('Controls migration error:', err.message);
}

// Initialize default controls if not exist
const defaultControls = ['mainLight', 'blueLight', 'pump', 'skimmer', 'heater', 'feeder'];
const insertControl = db.prepare('INSERT OR IGNORE INTO controls (device_id, state) VALUES (?, ?)');
defaultControls.forEach(device => insertControl.run(device, device === 'pump' || device === 'skimmer' || device === 'heater' ? 1 : 0));

// Initialize notification_settings with default row if not exists
db.prepare(`INSERT OR IGNORE INTO notification_settings (id, provider, ntfy_server, enabled) 
            VALUES (1, 'ntfy', 'https://ntfy.sh', 0)`).run();
console.log('📋 Default notification settings initialized');

// ============== EXPRESS APP ==============
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased for fish photos in base64
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);

const { Bonjour } = require('bonjour-service');

// ============== MDNS DISCOVERY ==============
const bonjour = new Bonjour();
const discoveredDevices = new Map(); // IP -> { name, ip, type }

// Start browsing for HTTP services
const browser = bonjour.find({ type: 'http' });

browser.on('up', (service) => {
    // Filter for our devices (aquamind_*)
    if (service.name.startsWith('aquamind')) {
        console.log('[Discovery] Found device:', service.name, service.referer.address);
        discoveredDevices.set(service.referer.address, {
            name: service.name,
            ip: service.referer.address,
            hostname: service.host,
            port: service.port,
            lastSeen: Date.now()
        });
    }
});

browser.on('down', (service) => {
    if (service.name.startsWith('aquamind')) {
        console.log('[Discovery] Device lost:', service.name);
        discoveredDevices.delete(service.referer.address);
    }
});

// Also scan specifically for 'aquamind' type if we switch to custom type later
bonjour.find({ type: 'aquamind' }, (service) => {
    console.log('[Discovery] Found AquaMind service:', service.name);
    // ... logic to add ...
});

// ============== MDNS PUBLISH ==============
// Publish AquaMind server for auto-discovery by mobile apps
bonjour.publish({
    name: 'aquamind-server',
    type: 'http',
    port: PORT,
    txt: {
        version: '1.0.0',
        api: '/api',
        name: 'AquaMind Backend'
    }
});

console.log(`[mDNS] AquaMind server published on network as 'aquamind-server' (Port ${PORT})`);



// ============== DEVICE REGISTRATION ==============
app.get('/api/discovery', (req, res) => {
    // Convert Map to Array
    const devices = Array.from(discoveredDevices.values());
    // Filter out stale devices (> 5 minutes old?) - optional
    res.json({ success: true, devices });
});

// Server Info endpoint for mobile app verification
app.get('/api/info', (req, res) => {
    res.json({
        success: true,
        server: {
            name: 'AquaMind Backend',
            version: '1.0.0',
            mDNS: 'aquamind-server',
            port: PORT,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }
    });
});
app.post('/api/setup', (req, res) => {
    try {
        const { mac, ip, type } = req.body;
        console.log(`[Setup] Request from MAC: ${mac} (IP: ${ip})`);

        if (!mac) {
            return res.status(400).json({ error: 'MAC address required' });
        }

        // Check if tank exists by MAC
        let tank = db.prepare('SELECT * FROM tanks WHERE mac_address = ?').get(mac);

        if (tank) {
            console.log(`[Setup] Existing tank found by MAC: ${tank.name} (ID: ${tank.id})`);
            // Update IP if changed
            if (ip && tank.address !== ip) {
                db.prepare('UPDATE tanks SET address = ? WHERE id = ?').run(ip, tank.id);
                console.log(`[Setup] Updated IP for Tank ${tank.id} to ${ip}`);
            }
            return res.json({ id: tank.id, name: tank.name });
        }

        // Fallback: Check if tank exists by IP (manual creation scenario)
        // Only if exact IP match AND mac_address is NULL or empty
        if (ip) {
            tank = db.prepare("SELECT * FROM tanks WHERE address = ? AND (mac_address IS NULL OR mac_address = '')").get(ip);
            if (tank) {
                console.log(`[Setup] Existing tank found by IP: ${tank.name} (ID: ${tank.id}) - Associating MAC`);

                // Associate MAC to this tank
                db.prepare('UPDATE tanks SET mac_address = ? WHERE id = ?').run(mac, tank.id);

                return res.json({ id: tank.id, name: tank.name });
            }
        }

        // New Tank - STRICT MODE: Do NOT create automatically.
        console.log(`[Setup] Unknown device (MAC: ${mac}, IP: ${ip}) tried to register.`);
        return res.status(404).json({
            error: 'Device not recognized. Please create a tank with this IP address in the AquaMind UI first.'
        });
    } catch (e) {
        console.error('[Setup] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ============== SERIAL PORT (ARDUINO / UART) GLOBAL STATE ==============
// Map: tankId -> { temp, ph, salinity, level, timestamp }
const currentSensorsMap = new Map();

// Map: tankId -> SerialPort instance
const tankSerialPorts = new Map();
const tankParsers = new Map();
const tankCalibrationModes = new Map(); // Store calibration mode state: tankId -> boolean
// Set: tankId (to block auto-reconnect during update)
const tankUpdateStatus = new Set();


// Initialize sensor data for defaults
currentSensorsMap.set(1, { temp: 25.0, ph: 8.2, tds: 350, level: 100 });

// ============== WEBSOCKET ==============
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('WebSocket client connected');

    // Send current state on connect
    ws.send(JSON.stringify({
        type: 'init',
        sensors: currentSensorsMap.get(1) || { temp: 0, ph: 0, tds: 0, level: 0 },
        controls: getControls()
    }));

    ws.on('close', () => {
        clients.delete(ws);
        console.log('WebSocket client disconnected');
    });
});

function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === 1) { // OPEN
            client.send(message);
        }
    });
}

// ============== SERIAL PORT (ARDUINO / UART) ==============

function initTankSerial(tank) {
    const tankId = tank.id;
    // For Tank 1, default to env var if address not set
    let portPath = tank.address;
    if (tankId === 1 && (!portPath || portPath === '')) {
        portPath = SERIAL_PORT;
    }

    if (!portPath) {
        console.log(`[Serial] No address/port for Tank ${tankId} (${tank.name})`);
        return;
    }

    if (tankSerialPorts.has(tankId)) {
        // Already open
        return;
    }

    // Check if this port is already used by another tank
    // Iterate existing open ports to see if path matches
    for (const [existingId, port] of tankSerialPorts.entries()) {
        if (port.path === portPath) {
            console.log(`[Serial] Port ${portPath} already in use by Tank ${existingId}. Skipping Tank ${tankId}.`);
            // We assume one port = one tank. If user configured both to same port, only the first one gets it.
            // Tank 1 usually loads first.
            return;
        }
    }

    if (!fs.existsSync(portPath)) {
        console.log(`[Serial] Port ${portPath} for Tank ${tankId} not found. Retrying in 10s...`);
        setTimeout(() => initTankSerial(tank), 10000);
        return;
    }

    try {
        const port = new SerialPort({
            path: portPath,
            baudRate: SERIAL_BAUD,
            hupcl: false // Disable Hang Up on Close (DTR) to prevent resets
        });

        const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

        port.on('open', () => {
            console.log(`[Serial] Tank ${tankId} connected on ${portPath}`);
            tankSerialPorts.set(tankId, port);

            // Wait 2s for ESP32 to boot before sending commands
            setTimeout(() => {
                if (port.isOpen) {
                    port.write('CAL:MODE:OFF\n', (err) => {
                        if (!err) console.log(`[Serial] Tank ${tankId} reset to Normal Mode`);
                        else console.error(`[Serial] Tank ${tankId} reset write error:`, err.message);
                    });
                }
            }, 2000);
        });

        parser.on('data', (line) => {
            try {
                const data = JSON.parse(line.trim());
                if (data.temp !== undefined) {
                    const sensors = {
                        temp: data.temp,
                        ph: data.ph,
                        tds: data.tds !== undefined ? data.tds : (data.salinity ? data.salinity * 500 : 0), // Fallback if old FW
                        level: data.level,
                        timestamp: new Date().toISOString()
                    };

                    currentSensorsMap.set(tankId, sensors);

                    // Update firmware version if present
                    if (data.fw_version) {
                        db.prepare('UPDATE tanks SET firmware_version = ? WHERE id = ?').run(data.fw_version, tankId);
                    }

                    // Save to history
                    saveSensorReading(tankId, sensors);

                    // Broadcast
                    broadcast({
                        type: 'sensors_update', // Unified event name
                        tankId: tankId,
                        data: sensors
                    });
                }
            } catch (e) {
                // Ignore non-JSON
            }
        });

        port.on('error', (err) => {
            console.error(`[Serial] Tank ${tankId} error:`, err.message);
            tankSerialPorts.delete(tankId);
        });

        port.on('close', () => {
            console.log(`[Serial] Tank ${tankId} closed`);
            tankSerialPorts.delete(tankId);
            // Only auto-reconnect if NOT updating firmware
            if (!tankUpdateStatus.has(tankId)) {
                setTimeout(() => initTankSerial(tank), 5000);
            }
        });

    } catch (err) {
        console.error(`[Serial] Failed to open ${portPath} for Tank ${tankId}:`, err.message);
        setTimeout(() => initTankSerial(tank), 10000);
    }
}

function startSerialManager() {
    // Load tanks that are 'arduino_local' or have serial addresses
    // We assume 'arduino_local' implies serial connection needed
    // Or we just try for any tank with an address that looks like a COM port?
    // User logic: "configuro secondary with esp32 receive data from uart" -> maybe type=esp32_wifi but connected via USB?
    // Let's just try to init serial for ALL tanks valid address OR type='arduino_local'

    // Only init serial for 'arduino_local' tanks.
    // ESP32 tanks use WiFi (push data), so we don't open a Serial port for them.
    const tanks = db.prepare("SELECT * FROM tanks WHERE type = 'arduino_local'").all();
    tanks.forEach(tank => initTankSerial(tank));
}

// Start serial manager
setTimeout(startSerialManager, 1000);

// ============== DATABASE HELPERS ==============
const insertSensor = db.prepare(`
  INSERT INTO sensor_history (tank_id, temp, ph, tds, level, timestamp) VALUES (?, ?, ?, ?, ?, ?)
`);

// Map: tankId -> lastSaveTime
const tankLastSave = new Map();
const SAVE_INTERVAL = 15000; // Save allowed every 15 seconds (prevents dropping 60s packets due to jitter)



// Map: key "tankId_param_type" -> timestamp
const alertThrottleMap = new Map();
const ALERT_THROTTLE_MS = 30000; // 30 seconds throttle per alert type

// Map: key "tankId_param_delta_id" -> count
const alertConfirmationMap = new Map();
const ALERT_CONFIRMATION_THRESHOLD = 3; // Condition must persist for 3 consecutive checks (~15s)

function checkAlerts(tankId, sensors) {
    if (!tankId || !sensors) return;

    try {
        // const thresholds = db.prepare('SELECT * FROM alert_thresholds WHERE tank_id = ?').all(tankId);
        // Filter enabled in SQL for efficiency now that debug is done
        const thresholds = db.prepare('SELECT * FROM alert_thresholds WHERE tank_id = ? AND enabled = 1').all(tankId);

        // Get Tank Name for nicer notifications
        const tankObj = db.prepare('SELECT name FROM tanks WHERE id = ?').get(tankId);
        const tankName = tankObj ? tankObj.name : `Tank ${tankId}`;

        thresholds.forEach(t => {
            const val = sensors[t.parameter];
            if (val === undefined || val === null) return;

            // 1. Min/Max Alerts (No cooldown, checks every minute)
            // THROTTLE CHECK
            const minKey = `${tankId}_${t.parameter}_min`;
            const maxKey = `${tankId}_${t.parameter}_max`;
            const now = Date.now();

            if (t.min_value !== null && Number(val) < t.min_value) {
                // Check Throttle
                if (alertThrottleMap.has(minKey) && (now - alertThrottleMap.get(minKey) < ALERT_THROTTLE_MS)) return;

                const paramIcons = { temp: '🌡️', ph: '🧪', tds: 'TDS', level: '💧' };
                const icon = paramIcons[t.parameter] || '⚠️';

                const title = `${icon} ALLARME ${t.parameter.toUpperCase()} [${tankName}]`;
                const msgBody = `⚠️ VALORE SOTTO SOGLIA\n————————————————————\n📉 Misurato: ${Number(val).toFixed(2)}\n🚫 Minimo:   ${t.min_value}\n————————————————————\nControllare l'acquario!`;
                // const dbMsg = `Basso: ${Number(val).toFixed(2)} < ${t.min_value}`;

                logAlert('threshold_min', t.parameter, msgBody, val, tankId);
                sendNotification(title, msgBody, 'high').catch(console.error);
                console.log(`[Alerts] ${title} - ${msgBody.replace(/\n/g, ' ')}`);
                alertThrottleMap.set(minKey, now);
            } else if (t.max_value !== null && Number(val) > t.max_value) {
                // Check Throttle
                if (alertThrottleMap.has(maxKey) && (now - alertThrottleMap.get(maxKey) < ALERT_THROTTLE_MS)) return;

                const paramIcons = { temp: '🌡️', ph: '🧪', tds: 'TDS', level: '💧' };
                const icon = paramIcons[t.parameter] || '⚠️';

                const title = `${icon} ALLARME ${t.parameter.toUpperCase()} [${tankName}]`;
                const msgBody = `⚠️ VALORE SOPRA SOGLIA\n————————————————————\n📈 Misurato: ${Number(val).toFixed(2)}\n🚫 Massimo:  ${t.max_value}\n————————————————————\nControllare l'acquario!`;
                // const dbMsg = `Alto: ${Number(val).toFixed(2)} > ${t.max_value}`;

                logAlert('threshold_max', t.parameter, msgBody, val, tankId);
                sendNotification(title, msgBody, 'high').catch(console.error);
                console.log(`[Alerts] ${title} - ${msgBody.replace(/\n/g, ' ')}`);
                alertThrottleMap.set(maxKey, now);
            }

            // 2. Delta (Rate of Change) Alerts
            // Logic: Compare current value with value from N minutes ago
            if (t.delta_value !== null && t.delta_value > 0) {
                const minutes = t.delta_minutes || 5;
                // Enforce a valid time window: looking for data older than N mins, but not older than 2*N mins (to avoid stale comparisons)
                // Also ensure we don't pick up data from "just now" if N is small.
                const maxHistoryParams = Math.max(minutes * 2, minutes + 60); // Allow at least 1h buffer or 2x minutes

                const oldReading = db.prepare(`
                    SELECT ${t.parameter} as val, timestamp FROM sensor_history 
                    WHERE tank_id = ? 
                    AND timestamp <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${minutes} minutes') 
                    AND timestamp >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${maxHistoryParams} minutes')
                    ORDER BY timestamp DESC LIMIT 1
                `).get(tankId);

                const countKey = `${tankId}_${t.parameter}_delta_${t.id || 'default'}`;

                if (oldReading && oldReading.val !== null) {
                    const diff = Number(val) - oldReading.val;

                    // DEBUG: Log the comparison details for verification
                    // console.log(`[Delta Check] ${t.parameter.toUpperCase()} Now: ${Number(val).toFixed(2)} vs Old: ${Number(oldReading.val).toFixed(2)} (@ ${oldReading.timestamp}). Diff: ${diff.toFixed(2)}`);

                    if (Math.abs(diff) >= t.delta_value) {
                        // CONFIRMATION CHECK
                        // Increment confirmation counter
                        const currentCount = (alertConfirmationMap.get(countKey) || 0) + 1;
                        alertConfirmationMap.set(countKey, currentCount);

                        // Only trigger if we have seen this condition enough times (e.g., 3 times x 5s = 15s persistence)
                        if (currentCount < ALERT_CONFIRMATION_THRESHOLD) {
                            console.log(`[Alerts] Potential ${t.parameter} delta detected (${currentCount}/${ALERT_CONFIRMATION_THRESHOLD}). Now: ${val}, Old: ${oldReading.val} (@ ${oldReading.timestamp})`);
                            return;
                        }

                        const type = diff > 0 ? 'rapid_rise' : 'rapid_drop';
                        const deltaKey = `${tankId}_${t.parameter}_delta_throttle`;
                        // Check Throttle
                        if (alertThrottleMap.has(deltaKey) && (now - alertThrottleMap.get(deltaKey) < ALERT_THROTTLE_MS)) return;

                        const sign = diff > 0 ? '+' : '';
                        const paramIcons = { temp: '🌡️', ph: '🧪', tds: 'TDS', level: '💧' };
                        const icon = paramIcons[t.parameter] || '⚠️';

                        const title = `${icon} ALLARME RAPIDO ${t.parameter.toUpperCase()} [${tankName}]`;
                        const msgBody = `⚠️ CAMBIO REPENTINO\n————————————————————\n📊 Delta: ${sign}${diff.toFixed(2)}\n⏱️ Tempo: ${minutes} min\n————————————————————\nPossibile anomalia sensore o evento critico.`;
                        // const dbMsg = `Delta: ${sign}${diff.toFixed(2)} in ${minutes}m`;

                        logAlert(type, t.parameter, msgBody, val, tankId);
                        sendNotification(title, msgBody, 'high').catch(console.error);
                        console.log(`[Alerts] TRIGGERED: ${title} - Comparison: Now=${val} vs Old=${oldReading.val} (${oldReading.timestamp})`);
                        alertThrottleMap.set(deltaKey, now);
                    } else {
                        // Reset counter if condition clears
                        alertConfirmationMap.delete(countKey);
                    }
                } else {
                    // No valid history found, reset counter just in case
                    alertConfirmationMap.delete(countKey);
                }
            }
        });
    } catch (e) {
        console.error(`[Alerts] Error checking alerts for Tank ${tankId}:`, e.message);
    }
}

// Map: tankId -> lastAlertCheckTime
const tankLastAlertCheck = new Map();
const ALERT_CHECK_INTERVAL = 5000; // Check alerts every 5 seconds

function saveSensorReading(tankId, sensors) {
    const cleanTankId = Number(tankId);

    // DEBUG LOG check entry
    // console.log(`[saveSensorReading] Called for Tank ${cleanTankId} (orig: ${tankId})`);

    const now = Date.now();
    const lastSave = tankLastSave.get(cleanTankId) || 0;
    const lastAlertCheck = tankLastAlertCheck.get(cleanTankId) || 0;
    const diff = now - lastAlertCheck;
    // console.log(`[Alert Loop Debug] Tank ${cleanTankId}: diff=${diff}, last=${lastAlertCheck}, now=${now}`);

    // 1. Alert Check (More frequent: every 5s)
    if (diff >= ALERT_CHECK_INTERVAL) {
        // console.log(`[Alert Loop] Tank ${cleanTankId} Checking alerts... (Diff: ${diff}ms)`);
        checkAlerts(cleanTankId, sensors);
        tankLastAlertCheck.set(cleanTankId, now);
    } else {
        // console.log(`[Alert Loop] Tank ${cleanTankId} Skipping (Diff: ${diff}ms < 5000)`);
    }

    // 2. Data Persistence (Less frequent: every 60s)
    if (now - lastSave >= SAVE_INTERVAL) {
        insertSensor.run(cleanTankId, sensors.temp, sensors.ph, sensors.tds, sensors.level, new Date().toISOString());
        tankLastSave.set(cleanTankId, now);

        // Cleanup old records (keep last 1 year)
        db.exec(`DELETE FROM sensor_history WHERE timestamp < datetime('now', '-365 days')`);
    }
}

function getControls(tankId) {
    const tid = tankId || 1;
    const rows = db.prepare('SELECT device_id, state FROM controls WHERE tank_id = ?').all(tid);
    const controls = {};
    rows.forEach(row => {
        controls[row.device_id] = row.state === 1;
    });
    return controls;
}

// Helper to initialize controls for a tank
function initializeControlsForTank(tankId) {
    const defaults = ['mainLight', 'blueLight', 'pump', 'skimmer', 'heater', 'feeder'];
    const insert = db.prepare('INSERT OR IGNORE INTO controls (device_id, state, tank_id) VALUES (?, 0, ?)');

    defaults.forEach(device => {
        insert.run(device, tankId);
    });
    console.log(`[Controls] Initialized defaults for Tank ${tankId}`);
}

// Startup: Ensure all tanks have controls
setTimeout(() => {
    try {
        const tanks = db.prepare('SELECT id FROM tanks').all();
        tanks.forEach(t => initializeControlsForTank(t.id));
    } catch (e) {
        console.error('[Controls] Startup init failed:', e.message);
    }
}, 1000);


// ============== FIRMWARE UPDATE ==============

// Multer config for temporary storage
const uploadDir = path.join('/tmp', 'firmware_uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

app.post('/api/tanks/:id/firmware', upload.single('firmware'), async (req, res) => {
    const tankId = parseInt(req.params.id);
    const { platform } = req.body; // 'esp32' or 'arduino'
    const file = req.file;

    if (!file) {
        return res.status(400).json({ success: false, message: 'Nessun file caricato' });
    }

    try {
        const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(tankId);
        if (!tank) throw new Error('Acquario non trovato');

        console.log(`[Firmware] Starting update for Tank ${tankId} (${tank.name}). Platform: ${platform || 'auto'}...`);

        // Case 1: ESP32 WiFi (OTA)
        if (tank.type === 'esp32_wifi' && tank.address) {
            console.log(`[Firmware] Mode: OTA to ${tank.address}`);

            // Use curl for robustness against chunked encoding issues
            console.log(`[Firmware] Executing curl upload to ${tank.address}...`);
            await new Promise((resolve, reject) => {
                const curl = spawn('curl', [
                    '-v',
                    '--connect-timeout', '10', // 10s connection timeout
                    '--max-time', '300',       // 5m total header/transfer limit
                    '-F', `firmware=@${file.path}`,
                    `http://${tank.address}/update`
                ]);

                let stdout = '';
                let stderr = '';

                curl.stdout.on('data', d => stdout += d);
                curl.stderr.on('data', d => stderr += d);

                curl.on('close', (code) => {
                    if (code === 0 && !stdout.includes('FAIL')) {
                        console.log(`[Firmware] OTA Curl Success: ${stdout}`);
                        res.json({ success: true, message: 'Aggiornamento WiFi completato' });
                        resolve();
                    } else {
                        console.error(`[Firmware] OTA Curl Error (code ${code}): ${stderr}`);
                        reject(new Error(`Errore OTA (curl code ${code})`));
                    }
                });
            });

        }
        // Case 2: USB / Serial (UART)
        else {
            // Default to USB if arduino_local or standard serial usage
            const portPath = tank.address || SERIAL_PORT;
            console.log(`[Firmware] Mode: Serial/UART on ${portPath}`);

            // Mark as updating to prevent auto-reconnect
            tankUpdateStatus.add(tankId);

            // Close serial connection first if open (to release lock)
            if (tankSerialPorts.has(tankId)) {
                console.log(`[Firmware] Closing serial port ${portPath} for update...`);
                // Close properly
                const port = tankSerialPorts.get(tankId);
                if (port.isOpen) {
                    await new Promise((resolve) => port.close(resolve));
                }
                tankSerialPorts.delete(tankId);
                // Give OS time to release the file handle
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Determine command based on platform
            let cmd, args;
            let detectedPlatform = platform;

            // Auto-detect platform from extension if not specified
            if (!detectedPlatform || detectedPlatform === 'auto') {
                if (file.originalname.endsWith('.bin')) detectedPlatform = 'esp32';
                else if (file.originalname.endsWith('.hex')) detectedPlatform = 'arduino';
            }

            if (detectedPlatform === 'esp32') {
                // ESP32 via esptool
                cmd = 'python3';
                // Use offset 0x10000 to avoid overwriting the bootloader at 0x0
                // Added --before/--after for reliable rebooting
                args = [
                    '-m', 'esptool',
                    '--chip', 'esp32c3',
                    '--port', portPath,
                    '--baud', '115200',
                    '--before', 'default_reset',
                    '--after', 'hard_reset',
                    'write_flash', '0x10000',
                    file.path
                ];
            } else {
                // Arduino Uno (AVR) via avrdude
                cmd = 'avrdude';
                args = [
                    '-p', 'atmega328p',
                    '-c', 'arduino',
                    '-P', portPath,
                    '-b', '115200',
                    '-D',
                    `-Uflash:w:${file.path}:i` // :i for intel hex, :r for raw binary
                ];
                // Check extension
                if (!file.originalname.endsWith('.hex')) {
                    console.warn('[Firmware] Warning: Arduino Uno typically requires .hex files. Trying auto-detect (:a)...');
                    args[args.length - 1] = `-Uflash:w:${file.path}:a`;
                }
            }

            console.log(`[Firmware] Executing: ${cmd} ${args.join(' ')}`);

            await new Promise((resolve, reject) => {
                const process = spawn(cmd, args);

                process.stdout.on('data', (data) => console.log(`[FwUpdate] ${data}`));
                process.stderr.on('data', (data) => console.error(`[FwUpdate] ${data}`));

                process.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Process exited with code ${code}`));
                });
            });

            console.log('[Firmware] Update successful!');
            res.json({ success: true, message: 'Aggiornamento seriale completato' });
        }

    } catch (err) {
        console.error('[Firmware] Update failed:', err.message);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        // Cleanup temp file
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);

        // Remove update flag
        if (tankId) tankUpdateStatus.delete(tankId);

        // Re-init serial (if it was local/USB) after small delay
        if (tankId && !tankSerialPorts.has(tankId)) {
            const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(tankId);
            if (tank && tank.type === 'arduino_local') {
                setTimeout(() => initTankSerial(tank), 3000);
            }
        }
    }
});

// ============== API ROUTES ==============

// --- Sensors ---
app.get('/api/sensors', (req, res) => {
    const tankId = parseInt(req.query.tankId) || 1;
    const sensors = currentSensorsMap.get(tankId) || { temp: 0, ph: 0, salinity: 0, level: 0 };
    res.json(sensors);
});

app.get('/api/sensors/history', (req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    const tankId = parseInt(req.query.tankId) || 1;

    // Dynamic timestamp format and interval based on range
    let timeFormat, intervalMinutes;
    if (hours <= 1) {
        timeFormat = '%H:%M';
        intervalMinutes = 1;
    } else if (hours <= 6) {
        timeFormat = '%H:%M';
        intervalMinutes = 2;
    } else if (hours <= 24) {
        timeFormat = '%H:%M';
        intervalMinutes = 5;
    } else if (hours <= 168) {
        timeFormat = '%d/%m %H:%M';
        intervalMinutes = 30;
    } else {
        timeFormat = '%d/%m/%Y';
        intervalMinutes = 60;
    }

    // Get actual data from DB
    const rows = db.prepare(`
        SELECT 
            timestamp,
            strftime('${timeFormat}', timestamp, 'localtime') as time,
            temp,
            ph,
            tds,
            level
        FROM sensor_history 
        WHERE timestamp >= datetime('now', '-${hours} hour')
        AND tank_id = ?
        ORDER BY timestamp ASC
    `).all(tankId);

    // Generate time slots for the entire range and fill gaps with null
    const now = new Date();
    const startTime = new Date(now.getTime() - (hours * 60 * 60 * 1000));

    // Round both startTime and now to interval boundaries to match data rounding
    const intervalMs = intervalMinutes * 60 * 1000;
    const roundedStart = Math.floor(startTime.getTime() / intervalMs) * intervalMs;
    const roundedNow = Math.floor(now.getTime() / intervalMs) * intervalMs;

    const slots = [];

    // Create a map of actual data by rounded timestamp
    const dataMap = new Map();
    rows.forEach(row => {
        const ts = new Date(row.timestamp); // Already ISO format with Z or local, new Date() handles it handles it best without forcing Z if already present
        const roundedTs = Math.floor(ts.getTime() / intervalMs) * intervalMs;
        dataMap.set(roundedTs, row);
    });

    // Generate all time slots
    for (let t = roundedStart; t <= roundedNow; t += intervalMinutes * 60 * 1000) {
        const slotDate = new Date(t);

        // Format time label
        const tz = process.env.TZ || 'Europe/Rome';
        let timeLabel;
        if (hours <= 24) {
            timeLabel = slotDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: tz });
        } else if (hours <= 168) {
            timeLabel = slotDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: tz }) + ' ' +
                slotDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: tz });
        } else {
            timeLabel = slotDate.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz });
        }

        const existingData = dataMap.get(t);
        if (existingData) {
            slots.push({
                time: timeLabel,
                temp: existingData.temp,
                ph: existingData.ph,
                tds: existingData.tds,
                level: existingData.level
            });
        } else {
            // Gap - insert null values
            slots.push({
                time: timeLabel,
                temp: null,
                ph: null,
                tds: null,
                level: null
            });
        }
    }

    // Calculate stats (Min, Max, Delta) with timestamps
    const stats = {
        temp: { min: null, max: null, minAt: null, maxAt: null, delta: 0 },
        ph: { min: null, max: null, minAt: null, maxAt: null, delta: 0 },
        tds: { min: null, max: null, minAt: null, maxAt: null, delta: 0 },
        level: { min: null, max: null, minAt: null, maxAt: null, delta: 0 }
    };

    rows.forEach(row => {
        ['temp', 'ph', 'tds', 'level'].forEach(key => {
            const val = row[key];
            if (val !== null && val !== undefined) {
                // Init min/max if null
                if (stats[key].min === null || val < stats[key].min) {
                    stats[key].min = val;
                    stats[key].minAt = row.timestamp;
                }
                if (stats[key].max === null || val > stats[key].max) {
                    stats[key].max = val;
                    stats[key].maxAt = row.timestamp;
                }
            }
        });
    });

    // Calculate Delta
    Object.keys(stats).forEach(key => {
        if (stats[key].min !== null && stats[key].max !== null) {
            stats[key].delta = parseFloat((stats[key].max - stats[key].min).toFixed(2));
        }
    });

    console.log(`[History] Requested ${hours}h, found ${rows.length} records, generated ${slots.length} slots`);
    res.json({ history: slots, stats });
});

// Debug endpoint to check timestamp issues
app.get('/api/sensors/history-debug', (req, res) => {
    const hours = parseInt(req.query.hours) || 3;

    // Get current time in various formats
    const nowInfo = db.prepare(`
        SELECT 
            datetime('now') as utc_now,
            datetime('now', 'localtime') as local_now,
            datetime('now', '-${hours} hour') as utc_cutoff,
            datetime('now', '-${hours} hour', 'localtime') as local_cutoff
    `).get();

    // Get first and last timestamps in DB
    const range = db.prepare(`
        SELECT 
            MIN(timestamp) as oldest,
            MAX(timestamp) as newest,
            COUNT(*) as total_records
        FROM sensor_history
    `).get();

    // Get records matching query
    const matchingCount = db.prepare(`
        SELECT COUNT(*) as count 
        FROM sensor_history 
        WHERE timestamp >= datetime('now', '-${hours} hour')
    `).get();

    // Get sample of recent data
    const samples = db.prepare(`
        SELECT timestamp, temp, ph
        FROM sensor_history 
        ORDER BY timestamp DESC
        LIMIT 10
    `).all();

    res.json({
        requestedHours: hours,
        now: nowInfo,
        dataRange: range,
        matchingRecords: matchingCount.count,
        sampleData: samples
    });
});

app.delete('/api/sensors/history', (req, res) => {
    const tankId = parseInt(req.query.tankId) || 1;
    const type = req.query.type; // 'temp', 'ph', 'tds', 'level'

    try {
        if (type && ['temp', 'ph', 'tds', 'level'].includes(type)) {
            // Set specific column to NULL instead of deleting row
            db.prepare(`UPDATE sensor_history SET ${type} = NULL WHERE tank_id = ?`).run(tankId);
            console.log(`[History] Cleared ${type} history for Tank ${tankId}`);
            res.json({ success: true, message: `Storico ${type} eliminato` });
        } else {
            // Delete entire rows
            db.prepare('DELETE FROM sensor_history WHERE tank_id = ?').run(tankId);
            console.log(`[History] Cleared ALL history for Tank ${tankId}`);
            res.json({ success: true, message: 'Storico eliminato completamente' });
        }
    } catch (e) {
        console.error('[History] Clear error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Single item delete
app.delete('/api/sensors/history/:id', (req, res) => {
    const id = parseInt(req.params.id);
    try {
        db.prepare('DELETE FROM sensor_history WHERE id = ?').run(id);
        console.log(`[History] Deleted record ${id}`);
        res.json({ success: true, message: 'Record eliminato' });
    } catch (e) {
        console.error('[History] Delete item error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get raw history log (for management)
app.get('/api/sensors/history/log', (req, res) => {
    const tankId = parseInt(req.query.tankId) || 1;
    const limit = parseInt(req.query.limit) || 100;

    try {
        const rows = db.prepare(`
            SELECT id, timestamp, temp, ph, tds, level
            FROM sensor_history 
            WHERE tank_id = ? 
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(tankId, limit);

        res.json(rows);
    } catch (e) {
        console.error('[History] Log error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/alerts/log', (req, res) => {
    const tankId = parseInt(req.query.tankId) || 1;
    try {
        db.prepare('DELETE FROM alert_log WHERE tank_id = ?').run(tankId);
        console.log(`[Alerts] Cleared log for Tank ${tankId}`);
        res.json({ success: true, message: 'Log alert eliminato' });
    } catch (e) {
        console.error('[Alerts] Clear log error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Notification Settings ---
app.get('/api/alerts/settings', (req, res) => {
    try {
        const settings = db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
        if (settings) {
            // Convert integers to booleans for frontend
            res.json({
                ...settings,
                notify_device_triggers: settings.notify_device_triggers === 1,
                notify_thresholds: settings.notify_thresholds === 1,
                notify_delta: settings.notify_delta === 1,
                enabled: settings.enabled === 1
            });
        } else {
            res.json({});
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/alerts/settings', (req, res) => {
    const { provider, ntfy_server, ntfy_topic, telegram_bot_token, telegram_chat_id, notify_device_triggers, notify_thresholds, notify_delta, enabled } = req.body;
    try {
        db.prepare(`
            INSERT INTO notification_settings (id, provider, ntfy_server, ntfy_topic, telegram_bot_token, telegram_chat_id, notify_device_triggers, notify_thresholds, notify_delta, enabled)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
            provider=excluded.provider,
            ntfy_server=excluded.ntfy_server,
            ntfy_topic=excluded.ntfy_topic,
            telegram_bot_token=excluded.telegram_bot_token,
            telegram_chat_id=excluded.telegram_chat_id,
            notify_device_triggers=excluded.notify_device_triggers,
            notify_thresholds=excluded.notify_thresholds,
            notify_delta=excluded.notify_delta,
            enabled=excluded.enabled
        `).run(
            provider,
            ntfy_server,
            ntfy_topic,
            telegram_bot_token,
            telegram_chat_id,
            notify_device_triggers ? 1 : 0,
            notify_thresholds ? 1 : 0,
            notify_delta ? 1 : 0,
            enabled ? 1 : 0
        );
        console.log('[Alerts] Notification settings updated');
        res.json({ success: true });
    } catch (e) {
        console.error('[Alerts] Settings update error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Controls ---
app.get('/api/controls', (req, res) => {
    const tankId = req.query.tankId || 1;
    res.json(getControls(tankId));
});

app.post('/api/controls', (req, res) => {
    const { device, state, tankId } = req.body;
    const tid = tankId || 1;

    if (!device || state === undefined) {
        return res.status(400).json({ error: 'device and state required' });
    }

    db.prepare('UPDATE controls SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE device_id = ? AND tank_id = ?')
        .run(state ? 1 : 0, device, tid);

    const controls = getControls(tid);

    // Broadcast control change (specific tank and filters)
    // We update broadcast to support tankId payload filter
    broadcast({
        type: 'controls',
        tankId: tid,
        data: controls
    });

    res.json({ success: true, controls });
});

// --- Schedules ---
app.get('/api/schedules', (req, res) => {
    const tankId = req.query.tankId || 1;
    const rows = db.prepare('SELECT * FROM schedules WHERE tank_id = ?').all(tankId);
    const schedules = rows.map(row => ({
        id: row.id,
        deviceId: row.device_id,
        label: row.label,
        days: JSON.parse(row.days),
        startTime: row.start_time,
        endTime: row.end_time,
        quantity: row.quantity || 1,
        active: row.active === 1
    }));
    res.json(schedules);
});

app.post('/api/schedules', (req, res) => {
    const { deviceId, label, days, startTime, endTime, quantity, tankId } = req.body;
    const result = db.prepare(`
    INSERT INTO schedules (device_id, label, days, start_time, end_time, quantity, tank_id) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(deviceId, label, JSON.stringify(days), startTime, endTime, quantity || 1, tankId || 1);

    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/schedules/:id', (req, res) => {
    const { id } = req.params;
    const { active, deviceId, label, days, startTime, endTime, quantity } = req.body;

    if (active !== undefined) {
        db.prepare('UPDATE schedules SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    }
    if (deviceId && label && days && startTime) {
        db.prepare(`
      UPDATE schedules SET device_id = ?, label = ?, days = ?, start_time = ?, end_time = ?, quantity = ? WHERE id = ?
    `).run(deviceId, label, JSON.stringify(days), startTime, endTime || startTime, quantity || 1, id);
    }

    res.json({ success: true });
});

app.delete('/api/schedules/:id', (req, res) => {
    db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Get list of devices that have active schedules
// Get list of devices that have active schedules
app.get('/api/schedules/active-devices', (req, res) => {
    const tankId = req.query.tankId || 1;
    const rows = db.prepare('SELECT DISTINCT device_id FROM schedules WHERE active = 1 AND tank_id = ?').all(tankId);
    const devices = rows.map(r => r.device_id);
    res.json(devices);
});

// --- Tanks Configuration ---
app.get('/api/tanks/:id', (req, res) => {
    const tankId = parseInt(req.params.id);
    try {
        const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(tankId);
        if (!tank) {
            return res.status(404).json({ error: 'Tank not found' });
        }
        res.json(tank);
    } catch (e) {
        console.error('[Tanks] GET error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/tanks/:id', (req, res) => {
    const tankId = parseInt(req.params.id);
    const {
        name, type, address, camera_url,
        width, height, depth, volume,
        water_type, min_distance, max_distance,
        ph_offset, tds_k_value, temp_offset,
        cam_brightness, cam_contrast, cam_saturation,
        light_watts, heater_watts
    } = req.body;

    try {
        // Build dynamic UPDATE query based on provided fields
        const updates = [];
        const values = [];

        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (type !== undefined) { updates.push('type = ?'); values.push(type); }
        if (address !== undefined) { updates.push('address = ?'); values.push(address); }
        if (camera_url !== undefined) { updates.push('camera_url = ?'); values.push(camera_url); }
        if (width !== undefined) { updates.push('width = ?'); values.push(width); }
        if (height !== undefined) { updates.push('height = ?'); values.push(height); }
        if (depth !== undefined) { updates.push('depth = ?'); values.push(depth); }
        if (volume !== undefined) { updates.push('volume = ?'); values.push(volume); }
        if (water_type !== undefined) { updates.push('water_type = ?'); values.push(water_type); }
        if (min_distance !== undefined) {
            updates.push('min_distance = ?');
            values.push(min_distance);
        }
        if (max_distance !== undefined) {
            updates.push('max_distance = ?');
            values.push(max_distance);
        }
        if (ph_offset !== undefined) {
            updates.push('ph_offset = ?');
            values.push(ph_offset);
        }
        if (tds_k_value !== undefined) {
            updates.push('tds_k_value = ?');
            values.push(tds_k_value);
        }
        if (temp_offset !== undefined) {
            updates.push('temp_offset = ?');
            values.push(temp_offset);
        }
        if (cam_brightness !== undefined) { updates.push('cam_brightness = ?'); values.push(cam_brightness); }
        if (cam_contrast !== undefined) { updates.push('cam_contrast = ?'); values.push(cam_contrast); }
        if (cam_saturation !== undefined) { updates.push('cam_saturation = ?'); values.push(cam_saturation); }
        if (light_watts !== undefined) { updates.push('light_watts = ?'); values.push(light_watts); }
        if (heater_watts !== undefined) { updates.push('heater_watts = ?'); values.push(heater_watts); }

        if (updates.length > 0) {
            values.push(tankId);
            const sql = `UPDATE tanks SET ${updates.join(', ')} WHERE id = ?`;
            db.prepare(sql).run(...values);

            // Send updated config to Arduino via Serial (if local)
            const tank = db.prepare('SELECT type FROM tanks WHERE id = ?').get(tankId);
            if (tank && tank.type === 'arduino_local') {
                sendSensorConfig(tankId);
            }

            console.log(`[Tanks] Updated config for Tank ${tankId}`);
        }

        res.json({ success: true, message: 'Configuration updated' });
    } catch (e) {
        console.error('[Tanks] PUT error:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============== CHIHIROS LED CONTROL ==============
const readline = require('readline');

const CHIHIROS_DAEMON = path.join(__dirname, 'chihiros_daemon.py');

// Persistent daemon process
let chihirosDaemon = null;
let daemonReady = false;
let pendingCommands = new Map();
let commandId = 0;

// Start the Chihiros daemon
function startChihirosDaemon() {
    if (chihirosDaemon) return;

    console.log('[Chihiros] Starting daemon...');
    chihirosDaemon = spawn('python3', [CHIHIROS_DAEMON], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    const rl = readline.createInterface({ input: chihirosDaemon.stdout });

    rl.on('line', (line) => {
        try {
            const data = JSON.parse(line);

            if (data.type === 'ready') {
                daemonReady = true;
                console.log('[Chihiros] Daemon ready, library:', data.library);
                return;
            }

            // Find and resolve pending command
            // Since we process sequentially, resolve the oldest pending
            for (const [id, handler] of pendingCommands) {
                handler.resolve(data);
                pendingCommands.delete(id);
                break;
            }
        } catch (e) {
            console.error('[Chihiros] Parse error:', line);
        }
    });

    chihirosDaemon.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.log('[Chihiros Daemon]', msg);
    });

    chihirosDaemon.on('exit', (code) => {
        console.log('[Chihiros] Daemon exited with code', code);
        chihirosDaemon = null;
        daemonReady = false;
        // Reject all pending commands
        for (const [id, handler] of pendingCommands) {
            handler.reject(new Error('Daemon exited'));
        }
        pendingCommands.clear();
        // Restart after 2 seconds
        setTimeout(startChihirosDaemon, 2000);
    });

    chihirosDaemon.on('error', (err) => {
        console.error('[Chihiros] Daemon error:', err.message);
    });
}

// Send command to daemon
function sendChihirosCommand(cmd, timeout = 30000) {
    return new Promise((resolve, reject) => {
        if (!chihirosDaemon || !daemonReady) {
            reject(new Error('Daemon not ready'));
            return;
        }

        const id = ++commandId;
        const timer = setTimeout(() => {
            pendingCommands.delete(id);
            reject(new Error('Command timeout'));
        }, timeout);

        pendingCommands.set(id, {
            resolve: (data) => {
                clearTimeout(timer);
                resolve(data);
            },
            reject: (err) => {
                clearTimeout(timer);
                reject(err);
            }
        });

        chihirosDaemon.stdin.write(JSON.stringify(cmd) + '\n');
    });
}

// Legacy wrapper for compatibility
async function runChihirosCommand(args) {
    const action = args[0];

    if (action === 'scan') {
        const timeout = parseInt(args[1]) || 10;
        return sendChihirosCommand({ action: 'scan', timeout });
    } else if (action === 'control') {
        const address = args[1];
        const command = args[2];
        const params = {};

        if (command === 'set_brightness' && args[3]) {
            params.brightness = parseInt(args[3]);
        } else if (command === 'set_rgb' && args[5]) {
            params.red = parseInt(args[3]);
            params.green = parseInt(args[4]);
            params.blue = parseInt(args[5]);
        } else if (command === 'set_channel' && args[4]) {
            params.channel = parseInt(args[3]);
            params.brightness = parseInt(args[4]);
        } else if (command === 'add_schedule' && args[7]) {
            params.sunrise_hour = parseInt(args[3]);
            params.sunrise_minute = parseInt(args[4]);
            params.sunset_hour = parseInt(args[5]);
            params.sunset_minute = parseInt(args[6]);
            if (args[7]) params.brightness = parseInt(args[7]);
            if (args[8]) params.ramp_minutes = parseInt(args[8]);
            if (args[9]) params.weekdays = parseInt(args[9]);
        }

        return sendChihirosCommand({ action: 'control', address, command, params });
    }

    throw new Error('Unknown action: ' + action);
}

// Start daemon on server startup - MOVED to server.listen
// startChihirosDaemon();

// Scan for Chihiros BLE devices
app.get('/api/chihiros/scan', async (req, res) => {
    try {
        console.log('[Chihiros] Starting BLE scan...');
        const result = await runChihirosCommand(['scan', '10']);
        console.log('[Chihiros] Scan complete, found', result.devices?.length || 0, 'devices');
        res.json(result);
    } catch (error) {
        console.error('[Chihiros] Scan error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all saved Chihiros devices
app.get('/api/chihiros/devices', (req, res) => {
    const tankId = req.query.tankId;
    let query = 'SELECT * FROM chihiros_devices';
    // If tankId is provided, filter by it. Otherwise show all or fallback logic.
    // For now, let's filter if provided, else show all
    if (tankId) query += ` WHERE tank_id = ${parseInt(tankId)}`;
    query += ' ORDER BY created_at DESC';

    const devices = db.prepare(query).all();
    res.json(devices);
});

// Add a new Chihiros device
app.post('/api/chihiros/devices', (req, res) => {
    const { name, address, model, is_rgb } = req.body;

    try {
        const result = db.prepare(`
            INSERT INTO chihiros_devices (name, address, model, is_rgb, tank_id)
            VALUES (?, ?, ?, ?, ?)
        `).run(name, address, model || 'unknown', is_rgb ? 1 : 0, req.body.tankId || 1);

        console.log('[Chihiros] Added device:', name, address);
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('[Chihiros] Add device error:', error.message);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Update a Chihiros device
app.put('/api/chihiros/devices/:id', (req, res) => {
    const { id } = req.params;
    const { name, is_rgb } = req.body;

    db.prepare('UPDATE chihiros_devices SET name = ?, is_rgb = ? WHERE id = ?')
        .run(name, is_rgb ? 1 : 0, id);

    res.json({ success: true });
});

// Delete a Chihiros device
app.delete('/api/chihiros/devices/:id', (req, res) => {
    db.prepare('DELETE FROM chihiros_devices WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Turn on a Chihiros device (restores saved RGB values)
app.post('/api/chihiros/devices/:id/on', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    try {
        // Restore saved RGB values (or 100 if not set)
        const r = device.red || 100;
        const g = device.green || 100;
        const b = device.blue || 100;

        await runChihirosCommand(['control', device.address, 'set_channel', '0', String(r)]);
        await runChihirosCommand(['control', device.address, 'set_channel', '1', String(g)]);
        await runChihirosCommand(['control', device.address, 'set_channel', '2', String(b)]);

        db.prepare('UPDATE chihiros_devices SET is_on = 1 WHERE id = ?').run(device.id);
        console.log(`[Chihiros] Turned ON ${device.name} with RGB(${r}, ${g}, ${b})`);
        res.json({ success: true, rgb: [r, g, b] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Turn off a Chihiros device
app.post('/api/chihiros/devices/:id/off', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    try {
        const result = await runChihirosCommand(['control', device.address, 'turn_off']);
        db.prepare('UPDATE chihiros_devices SET is_on = 0, brightness = 0 WHERE id = ?').run(device.id);
        console.log('[Chihiros] Turned OFF:', device.name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set brightness (non-RGB)
app.post('/api/chihiros/devices/:id/brightness', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { brightness } = req.body;

    try {
        const result = await runChihirosCommand(['control', device.address, 'set_brightness', String(brightness)]);
        db.prepare('UPDATE chihiros_devices SET brightness = ?, is_on = 1 WHERE id = ?').run(brightness, device.id);
        console.log('[Chihiros] Set brightness:', device.name, brightness);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set RGB brightness
app.post('/api/chihiros/devices/:id/rgb', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { red, green, blue } = req.body;

    try {
        const result = await runChihirosCommand([
            'control', device.address, 'set_rgb',
            String(red), String(green), String(blue)
        ]);
        db.prepare('UPDATE chihiros_devices SET red = ?, green = ?, blue = ?, is_on = 1 WHERE id = ?')
            .run(red, green, blue, device.id);
        console.log('[Chihiros] Set RGB:', device.name, red, green, blue);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set individual channel brightness (0=Red, 1=Green, 2=Blue)
app.post('/api/chihiros/devices/:id/channel', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { channel, brightness } = req.body;
    const channelName = ['red', 'green', 'blue'][channel] || 'unknown';

    try {
        const result = await runChihirosCommand([
            'control', device.address, 'set_channel',
            String(channel), String(brightness)
        ]);

        // Update the specific color in database
        const updateField = channelName === 'red' ? 'red' : channelName === 'green' ? 'green' : 'blue';
        db.prepare(`UPDATE chihiros_devices SET ${updateField} = ?, is_on = 1 WHERE id = ?`)
            .run(brightness, device.id);

        console.log('[Chihiros] Set channel', channelName, ':', device.name, brightness);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Enable auto mode
app.post('/api/chihiros/devices/:id/auto-mode', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    try {
        const result = await runChihirosCommand(['control', device.address, 'enable_auto_mode']);
        console.log('[Chihiros] Enabled auto mode:', device.name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sync time
app.post('/api/chihiros/devices/:id/sync-time', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    try {
        const result = await runChihirosCommand(['control', device.address, 'set_time']);
        console.log('[Chihiros] Synced time:', device.name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset all settings
app.post('/api/chihiros/devices/:id/reset', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    try {
        const result = await runChihirosCommand(['control', device.address, 'reset_settings']);
        console.log('[Chihiros] Reset settings:', device.name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add schedule
app.post('/api/chihiros/devices/:id/schedule', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { sunrise_hour, sunrise_minute, sunset_hour, sunset_minute, brightness, ramp_minutes, weekdays } = req.body;

    try {
        const args = [
            'control', device.address, 'add_schedule',
            String(sunrise_hour || 8), String(sunrise_minute || 0),
            String(sunset_hour || 18), String(sunset_minute || 0),
            String(brightness || 100), String(ramp_minutes || 0), String(weekdays || 127)
        ];
        const result = await runChihirosCommand(args);
        console.log('[Chihiros] Added schedule:', device.name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete schedule  
app.post('/api/chihiros/devices/:id/schedule/delete', async (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { sunrise_hour, sunrise_minute, sunset_hour, sunset_minute, ramp_minutes, weekdays } = req.body;

    try {
        const args = [
            'control', device.address, 'delete_schedule',
            String(sunrise_hour || 8), String(sunrise_minute || 0),
            String(sunset_hour || 18), String(sunset_minute || 0),
            String(ramp_minutes || 0), String(weekdays || 127)
        ];
        const result = await runChihirosCommand(args);
        console.log('[Chihiros] Deleted schedule:', device.name);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============== SERVER-SIDE CHIHIROS SCHEDULING ==============
// Save auto schedule settings (uses stored RGB values from sliders)
app.post('/api/chihiros/devices/:id/auto-schedule', (req, res) => {
    const device = db.prepare('SELECT * FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { auto_mode, on_time, off_time } = req.body;

    db.prepare('UPDATE chihiros_devices SET auto_mode = ?, on_time = ?, off_time = ? WHERE id = ?')
        .run(auto_mode ? 1 : 0, on_time || null, off_time || null, device.id);

    console.log('[Chihiros] Auto schedule updated:', device.name, { auto_mode, on_time, off_time });
    res.json({ success: true });
});

// Get auto schedule settings
app.get('/api/chihiros/devices/:id/auto-schedule', (req, res) => {
    const device = db.prepare('SELECT auto_mode, on_time, off_time, red, green, blue FROM chihiros_devices WHERE id = ?').get(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json(device);
});

// Chihiros scheduler - runs every minute
let lastChihirosScheduleState = {};

async function processChihirosSchedules() {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

    const devices = db.prepare('SELECT * FROM chihiros_devices WHERE auto_mode = 1').all();

    for (const device of devices) {
        const stateKey = `chihiros_${device.id}`;
        const lastState = lastChihirosScheduleState[stateKey];

        // Check ON time
        if (device.on_time === currentTime && lastState !== 'on') {
            console.log(`[Chihiros Scheduler] Turning ON ${device.name} with RGB(${device.red}, ${device.green}, ${device.blue})`);
            try {
                // Set each channel separately (R=0, G=1, B=2)
                await runChihirosCommand(['control', device.address, 'set_channel', '0', String(device.red || 100)]);
                await runChihirosCommand(['control', device.address, 'set_channel', '1', String(device.green || 100)]);
                await runChihirosCommand(['control', device.address, 'set_channel', '2', String(device.blue || 100)]);
                db.prepare('UPDATE chihiros_devices SET is_on = 1 WHERE id = ?').run(device.id);
                lastChihirosScheduleState[stateKey] = 'on';
            } catch (err) {
                console.error('[Chihiros Scheduler] Error turning on:', err.message);
            }
        }

        // Check OFF time
        if (device.off_time === currentTime && lastState !== 'off') {
            console.log(`[Chihiros Scheduler] Turning OFF ${device.name}`);
            try {
                await runChihirosCommand(['control', device.address, 'turn_off']);
                db.prepare('UPDATE chihiros_devices SET is_on = 0 WHERE id = ?').run(device.id);
                lastChihirosScheduleState[stateKey] = 'off';
            } catch (err) {
                console.error('[Chihiros Scheduler] Error turning off:', err.message);
            }
        }

        // Reset state tracker when not at on/off time
        if (device.on_time !== currentTime && device.off_time !== currentTime) {
            delete lastChihirosScheduleState[stateKey];
        }
    }
}

// Run Chihiros scheduler every minute - MOVED to startBackgroundJobs
// setInterval(processChihirosSchedules, 60000);
// console.log('⏰ Chihiros scheduler started (every 60 seconds)');

// ============== MAINTENANCE LOG ==============
app.get('/api/maintenance', (req, res) => {
    const tankId = req.query.tankId || 1;
    const entries = db.prepare('SELECT * FROM maintenance_log WHERE tank_id = ? ORDER BY date DESC, created_at DESC').all(tankId);
    res.json(entries);
});

app.post('/api/maintenance', (req, res) => {
    const { date, type, description, reminder_time, tankId } = req.body;
    const result = db.prepare('INSERT INTO maintenance_log (date, type, description, reminder_time, tank_id) VALUES (?, ?, ?, ?, ?)').run(date, type, description, reminder_time || null, tankId || 1);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/maintenance/all', (req, res) => {
    const tankId = req.query.tankId || 1;
    // console.log(`[Maintenance] Deleting ALL logs for Tank ${tankId}`);
    db.prepare('DELETE FROM maintenance_log WHERE tank_id = ?').run(tankId);
    res.json({ success: true });
});

app.delete('/api/maintenance/:id', (req, res) => {
    db.prepare('DELETE FROM maintenance_log WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Maintenance Recurring Rules
app.get('/api/maintenance/recurring', (req, res) => {
    const tankId = req.query.tankId || 1;
    const rules = db.prepare('SELECT * FROM maintenance_recurring WHERE tank_id = ?').all(tankId);

    // Parse JSON fields
    const formattedRules = rules.map(r => ({
        ...r,
        weekdays: r.weekdays ? JSON.parse(r.weekdays) : []
    }));

    res.json(formattedRules);
});

app.post('/api/maintenance/recurring', (req, res) => {
    const { type, description, frequency, interval, weekdays, day_of_month, start_date, tankId } = req.body;

    const result = db.prepare(`
        INSERT INTO maintenance_recurring 
        (tank_id, type, description, frequency, interval, weekdays, day_of_month, start_date, reminder_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        tankId || 1,
        type,
        description,
        frequency,
        interval || 1,
        weekdays ? JSON.stringify(weekdays) : null,
        day_of_month || null,
        start_date,
        req.body.reminder_time || null
    );

    res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/maintenance/recurring/:id', (req, res) => {
    db.prepare('DELETE FROM maintenance_recurring WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ============== WATER PARAMETERS ==============
app.get('/api/water-params', (req, res) => {
    const { from, to, tankId } = req.query;
    let query = 'SELECT * FROM water_parameters WHERE 1=1';
    const params = [];

    if (tankId) {
        query += ' AND tank_id = ?';
        params.push(tankId);
    } else {
        query += ' AND tank_id = 1'; // Default to Main Tank
    }

    if (from && to) {
        query += ' AND date >= ? AND date <= ?';
        params.push(from, to);
    }
    query += ' ORDER BY date DESC';
    const entries = db.prepare(query).all(...params);
    res.json(entries);
});

app.post('/api/water-params', (req, res) => {
    const { date, no2, no3, nh3, nh4, ph, ph_source, gh, kh, po4, fe, k, mg, sio2, cu, ca, co2, o2, cl, notes, tankId } = req.body;
    const result = db.prepare(`
        INSERT INTO water_parameters (date, no2, no3, nh3, nh4, ph, ph_source, gh, kh, po4, fe, k, mg, sio2, cu, ca, co2, o2, cl, notes, tank_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(date, no2, no3, nh3, nh4, ph, ph_source || 'manual', gh, kh, po4, fe, k, mg, sio2, cu, ca, co2, o2, cl, notes, tankId || 1);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/water-params/:id', (req, res) => {
    const { date, no2, no3, nh3, nh4, ph, ph_source, gh, kh, po4, fe, k, mg, sio2, cu, ca, co2, o2, cl, notes, tankId } = req.body;
    db.prepare(`
        UPDATE water_parameters 
        SET date = ?, no2 = ?, no3 = ?, nh3 = ?, nh4 = ?, ph = ?, ph_source = ?, gh = ?, kh = ?, po4 = ?, fe = ?, k = ?, mg = ?, sio2 = ?, cu = ?, ca = ?, co2 = ?, o2 = ?, cl = ?, notes = ?, tank_id = ?
        WHERE id = ?
    `).run(date, no2, no3, nh3, nh4, ph, ph_source || 'manual', gh, kh, po4, fe, k, mg, sio2, cu, ca, co2, o2, cl, notes, tankId || 1, req.params.id);
    res.json({ success: true });
});

app.delete('/api/water-params/:id', (req, res) => {
    db.prepare('DELETE FROM water_parameters WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ============== FISH INVENTORY ==============
app.get('/api/fish', (req, res) => {
    const tankId = req.query.tankId || 1;
    const fish = db.prepare('SELECT * FROM fish_inventory WHERE tank_id = ? ORDER BY date_added DESC').all(tankId);
    res.json(fish);
});

app.post('/api/fish', (req, res) => {
    const { name, species, quantity, price, photo_url, notes, tankId } = req.body;
    const result = db.prepare(`
        INSERT INTO fish_inventory (name, species, quantity, price, photo_url, notes, tank_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, species, quantity || 1, price, photo_url, notes, tankId || 1);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/fish/:id', (req, res) => {
    const { name, species, quantity, price, photo_url, notes, status, tankId } = req.body;
    db.prepare(`
        UPDATE fish_inventory SET name = ?, species = ?, quantity = ?, price = ?, photo_url = ?, notes = ?, status = ?
        WHERE id = ?
    `).run(name, species, quantity, price, photo_url, notes, status, req.params.id);
    res.json({ success: true });
});

app.delete('/api/fish/:id', (req, res) => {
    db.prepare('DELETE FROM fish_inventory WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ============== PLANTS INVENTORY ==============
app.get('/api/plants', (req, res) => {
    const tankId = req.query.tankId || 1;
    const plants = db.prepare('SELECT * FROM plants_inventory WHERE tank_id = ? ORDER BY date_added DESC').all(tankId);
    res.json(plants);
});

app.post('/api/plants', (req, res) => {
    const { name, species, quantity, price, photo_url, notes, tankId } = req.body;
    const result = db.prepare(`
        INSERT INTO plants_inventory (name, species, quantity, price, photo_url, notes, tank_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, species, quantity || 1, price, photo_url, notes, tankId || 1);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/plants/:id', (req, res) => {
    const { name, species, quantity, price, photo_url, notes, status, tankId } = req.body;
    db.prepare(`
        UPDATE plants_inventory SET name = ?, species = ?, quantity = ?, price = ?, photo_url = ?, notes = ?, status = ?
        WHERE id = ?
    `).run(name, species, quantity, price, photo_url, notes, status, req.params.id);
    res.json({ success: true });
});

app.delete('/api/plants/:id', (req, res) => {
    db.prepare('DELETE FROM plants_inventory WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ============== BACKUP & RESTORE ==============

app.get('/api/backup', (req, res) => {
    const { tankId: reqTankId, include } = req.query;
    const tankId = parseInt(reqTankId) || 1;
    const tank = db.prepare('SELECT name FROM tanks WHERE id = ?').get(tankId);
    const tankName = tank ? tank.name.replace(/\s+/g, '_') : `Tank${tankId}`;

    // Parse included sections (default to ALL if not specified)
    const sections = include ? include.split(',') : ['config', 'schedules', 'livestock', 'history'];
    const data = {};

    console.log(`[Backup] Generating backup for Tank ${tankId} (${tankName}). Sections: ${sections.join(', ')}`);

    // --- CONFIG SECTION ---
    if (sections.includes('config')) {
        data.controls = db.prepare('SELECT * FROM controls WHERE tank_id = ?').all(tankId);
        data.chihiros_devices = db.prepare('SELECT * FROM chihiros_devices WHERE tank_id = ?').all(tankId);
        data.alert_thresholds = db.prepare('SELECT * FROM alert_thresholds WHERE tank_id = ?').all(tankId);
        // data.settings = ... (global settings excluded)
    }

    // --- SCHEDULES SECTION ---
    if (sections.includes('schedules')) {
        data.schedules = db.prepare('SELECT * FROM schedules WHERE tank_id = ?').all(tankId);
    }

    // --- LIVESTOCK SECTION ---
    if (sections.includes('livestock')) {
        data.fish_inventory = db.prepare('SELECT * FROM fish_inventory WHERE tank_id = ?').all(tankId);
    }

    // --- HISTORY SECTION ---
    if (sections.includes('history')) {
        data.sensor_history = db.prepare('SELECT * FROM sensor_history WHERE tank_id = ?').all(tankId);
        data.alert_log = db.prepare('SELECT * FROM alert_log WHERE tank_id = ?').all(tankId);
        data.maintenance_log = db.prepare('SELECT * FROM maintenance_log WHERE tank_id = ?').all(tankId);
        data.water_parameters = db.prepare('SELECT * FROM water_parameters WHERE tank_id = ?').all(tankId);
    }

    const backup = {
        version: 1.1,
        timestamp: new Date().toISOString(),
        tankId: tankId,
        tankName: tankName,
        sections: sections,
        data: data
    };

    res.setHeader('Content-Disposition', `attachment; filename=aquamind-${tankName}-backup-${new Date().toISOString().split('T')[0]}.json`);
    res.json(backup);
});

app.post('/api/restore', (req, res) => {
    try {
        const { data: backupData, sections } = req.body;
        const targetTankId = parseInt(req.query.tankId);

        if (!backupData || !backupData.data) return res.status(400).json({ error: 'Invalid backup format' });
        if (!targetTankId) return res.status(400).json({ error: 'Target Tank ID required' });

        // Define groups for validation/mapping
        const tableGroups = {
            config: ['controls', 'chihiros_devices', 'alert_thresholds'],
            schedules: ['schedules'],
            livestock: ['fish_inventory'],
            history: ['sensor_history', 'alert_log', 'maintenance_log', 'water_parameters']
        };

        // Determine tables to restore based on requested sections
        // If 'sections' is not provided, restore everything present in the backup
        let tablesToRestore = [];
        if (sections && Array.isArray(sections) && sections.length > 0) {
            sections.forEach(sec => {
                if (tableGroups[sec]) {
                    tablesToRestore.push(...tableGroups[sec]);
                }
            });
        } else {
            // Default: Restore all known tables found in backup
            const allTables = Object.values(tableGroups).flat();
            tablesToRestore = allTables.filter(t => backupData.data[t]);
        }

        console.log(`[Restore] Restoring to Tank ${targetTankId}. Tables: ${tablesToRestore.join(', ')}`);

        db.transaction(() => {
            for (const table of tablesToRestore) {
                if (backupData.data[table]) {
                    // 1. Delete existing data for this tank
                    db.prepare(`DELETE FROM ${table} WHERE tank_id = ?`).run(targetTankId);

                    // 2. Insert new data
                    const rows = backupData.data[table];
                    if (rows.length > 0) {
                        // Dynamic column detection
                        const cols = Object.keys(rows[0]).filter(k => k !== 'id');
                        if (cols.length === 0) continue;

                        const placeholders = cols.map(() => '?').join(', ');
                        const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`);

                        for (const row of rows) {
                            // Enforce tank_id
                            const values = cols.map(c => {
                                if (c === 'tank_id') return targetTankId;
                                return row[c];
                            });
                            stmt.run(...values);
                        }
                    }
                }
            }
        })();

        console.log(`[Backup] Restored data for Tank ${targetTankId}`);
        res.json({ success: true, tankId: targetTankId, restoredTables: tablesToRestore });
    } catch (error) {
        console.error('[Restore] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============== SCHEDULE PROCESSOR ==============
// Process schedules every minute to auto-control devices
function processSchedules() {
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

    // Log current time info for debugging
    // console.log(`[Scheduler] Current: ${currentTime} (day ${currentDay}), UTC: ${now.toISOString()}`);

    // Get all active schedules
    const schedules = db.prepare('SELECT * FROM schedules WHERE active = 1').all();

    if (schedules.length === 0) {
        return; // No schedules to process
    }

    // console.log(`[Scheduler] Processing ${schedules.length} active schedules`);

    // Track which devices should be ON based on schedules
    // Track which devices should be ON based on schedules
    // Key: tankId_deviceId
    const scheduledStates = {};

    for (const schedule of schedules) {
        const days = JSON.parse(schedule.days);
        const deviceId = schedule.device_id;
        const startTime = schedule.start_time;
        const endTime = schedule.end_time;
        const tankId = schedule.tank_id || 1;

        // For feeder, we just trigger at start time (no end time logic)
        if (deviceId === 'feeder') {
            if (currentTime === startTime) {
                // Trigger feeder
                setControlState('feeder', true, tankId);
                broadcast({ type: 'controls', tankId: tankId, data: getControls(tankId) });

                // Turn off after 2 seconds per quantity
                const quantity = schedule.quantity || 1;
                setTimeout(() => {
                    setControlState('feeder', false, tankId);
                    broadcast({ type: 'controls', tankId: tankId, data: getControls(tankId) });
                }, quantity * 2000);
            }
            continue;
        }

        // Check if today is a scheduled day
        let isActiveQuery = false;

        // 1. Check Today's Schedule
        if (days.includes(currentDay)) {
            if (startTime < endTime) {
                // Standard day schedule (e.g. 09:00 - 18:00)
                isActiveQuery = (currentTime >= startTime && currentTime < endTime);
            } else {
                // Overnight schedule starting today (e.g. 20:00 - 02:00)
                // Active from 20:00 to 23:59
                isActiveQuery = (currentTime >= startTime);
            }
        }

        // 2. Check Yesterday's Schedule (if it spills over to today)
        if (!isActiveQuery) {
            const yesterday = (currentDay + 6) % 7;
            if (days.includes(yesterday) && startTime > endTime) {
                // Overnight schedule set yesterday (e.g. 20:00 - 02:00)
                // Active from 00:00 to 02:00
                isActiveQuery = (currentTime < endTime);
            }
        }

        const inWindow = isActiveQuery;

        // console.log(`[Scheduler] Tank ${tankId} ${deviceId}: ${startTime}-${endTime}, current: ${currentTime}, inWindow: ${inWindow}`);

        const key = `${tankId}_${deviceId}`;
        if (scheduledStates[key] === undefined) {
            scheduledStates[key] = { tankId, deviceId, state: false };
        }

        if (inWindow) {
            scheduledStates[key].state = true;
        }
    }

    // Update device states based on schedules
    const changedTanks = new Set();
    for (const [key, config] of Object.entries(scheduledStates)) {
        const { tankId, deviceId, state } = config;
        const currentState = getControlState(deviceId, tankId);

        if (currentState !== state) {
            setControlState(deviceId, state, tankId);
            changedTanks.add(tankId);
            // console.log(`Schedule: Tank ${tankId} ${deviceId} -> ${state ? 'ON' : 'OFF'}`);
            // Send notification for scheduled device change
            notifyDeviceTrigger(deviceId, state, 'programmazione', tankId)
                .then(() => console.log(`[Schedule] Notification sent for ${deviceId}`))
                .catch(err => console.error(`[Schedule] Notification failed for ${deviceId}:`, err.message));
        }
    }

    // Since we can't easily know WHICH tank changed if we just flag stateChanged generically,
    // we should ideally optimize. But for now, if ANY state changed, we might need to broadcast.
    // However, broadcast() usually sends to EVERYONE.
    // Let's improve broadcast to just send to relevant subs if possible, 
    // or just broadcast generic "controls" update and let frontend filter.
    // The previous code did: broadcast({ type: 'controls', data: getControls() });
    // This implies sending ALL controls. 
    // We should probably iterate active tanks and broadcast per tank?
    // Or just broadcast global and let frontend filter?
    // The `getControls` function likely returns EVERYTHING or filters.
    // Let's check `getControls`. It wasn't shown in view_file.
    // Assuming `getControls` returns all. 
    // Safest fix: 
    if (changedTanks.size > 0) {
        changedTanks.forEach(tid => {
            broadcast({ type: 'controls', tankId: tid, data: getControls(tid) });
            console.log(`[Scheduler] Broadcast update for Tank ${tid}`);
        });
    }
}

function getControlState(deviceId, tankId) {
    const tid = tankId || 1;
    const row = db.prepare('SELECT state FROM controls WHERE device_id = ? AND tank_id = ?').get(deviceId, tid);
    return row ? row.state === 1 : false;
}

function setControlState(deviceId, state, tankId) {
    const tid = tankId || 1;
    db.prepare('UPDATE controls SET state = ? WHERE device_id = ? AND tank_id = ?').run(state ? 1 : 0, deviceId, tid);
}

// Run schedule processor every 2 seconds - MOVED to startBackgroundJobs
// setInterval(processSchedules, 2000);
// Also run immediately on startup
// setTimeout(processSchedules, 2000);

// ============== MAINTENANCE REMINDERS ==============
function processMaintenanceReminders() {
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

    // Localized labels for event types
    const typeLabels = {
        water_change: 'Cambio Acqua',
        filter_clean: 'Pulizia Filtro',
        fertilizer: 'Fertilizzante',
        medication: 'Medicinale',
        note: 'Nota',
        custom: 'Personalizzato'
    };

    // Helper to get display name
    const getDisplayName = (type, description) => {
        // If type is a standard key, use label. If custom, check if type itself is custom name or use description?
        // App logic: "type" is stored as "water_change" OR the custom string input by user if type was 'custom'
        // So: typeLabels[type] || type.
        return typeLabels[type] || type;
    };

    // console.log(`[Maintenance Check] Checking for reminders at ${currentTime}...`); // verbose

    // 1. Check ONE-OFF events for TODAY that have a reminder_time matching current time
    const todaysEvents = db.prepare(`
        SELECT * FROM maintenance_log 
        WHERE date = ? AND reminder_time = ?
    `).all(currentDate, currentTime);

    todaysEvents.forEach(event => {
        // Guard to prevent spamming if logic runs multiple times in same minute (though interval is 60s, ideally)
        // But since we don't have a "notified" flag, we rely on exact minute match. 
        // If this function runs multiple times per minute, we might spam. 
        // Ideally we track it. For now, we assume called once per minute or rely on client side dedupe? 
        // Server side notification sending is expensive so better be careful.
        // Simple fix: We can't easily flag "notified" without updating column.
        // Let's assume the interval is roughly 60s.

        const tank = db.prepare('SELECT name FROM tanks WHERE id = ?').get(event.tank_id);
        const tankName = tank ? tank.name : `Tank ${event.tank_id}`;

        const displayName = getDisplayName(event.type);

        sendNotification(
            `🔧 Promemoria Manutenzione`,
            `[${tankName}] È ora di: ${displayName}\n\n${event.description || ''}`,
            'high'
        );
        logAlert('maintenance_reminder', event.type, `Promemoria: ${displayName}`, 1, event.tank_id);
        console.log(`[Maintenance] Reminder sent for event ${event.id} (Tank ${event.tank_id})`);
    });

    // 2. Check RECURRING rules
    const recurringRules = db.prepare(`
        SELECT * FROM maintenance_recurring
        WHERE reminder_time = ?
    `).all(currentTime);

    recurringRules.forEach(rule => {
        const startDate = new Date(rule.start_date);
        startDate.setHours(0, 0, 0, 0);
        const currentDayDate = new Date();
        currentDayDate.setHours(0, 0, 0, 0);

        if (currentDayDate < startDate) return;

        let isDue = false;

        if (rule.frequency === 'interval') {
            const diffTime = currentDayDate - startDate;
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            isDue = (diffDays % (rule.interval || 1) === 0);
        } else if (rule.frequency === 'weekly') {
            const weekdays = rule.weekdays ? JSON.parse(rule.weekdays) : [];
            isDue = weekdays.includes(currentDayDate.getDay());
        } else if (rule.frequency === 'monthly') {
            const targetDom = rule.day_of_month || startDate.getDate();
            isDue = (currentDayDate.getDate() === targetDom);
        }

        if (isDue) {
            const tank = db.prepare('SELECT name FROM tanks WHERE id = ?').get(rule.tank_id);
            const tankName = tank ? tank.name : `Tank ${rule.tank_id}`;
            const displayName = getDisplayName(rule.type);

            // Check if we already created a log for this today? 
            // Actually, reminder is separate from "Done". We just remind.

            sendNotification(
                `🔄 Manutenzione Programmata`,
                `[${tankName}] Promemoria ${rule.frequency}: ${displayName}\n\n${rule.description || ''}`,
                'high'
            );
            logAlert('maintenance_reminder', rule.type, `Promemoria Ricorrente: ${displayName}`, 1, rule.tank_id);
            console.log(`[Maintenance] Recurring reminder sent for rule ${rule.id} (Tank ${rule.tank_id})`);
        }
    });
}

// Run maintenance check every minute
setInterval(processMaintenanceReminders, 60000);
// Run once on startup after short delay
setTimeout(processMaintenanceReminders, 5000);

// --- TANKS ---
app.get('/api/tanks', (req, res) => {
    try {
        const tanks = db.prepare('SELECT * FROM tanks ORDER BY created_at ASC').all();
        res.json(tanks);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get Single Tank by ID
app.get('/api/tanks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    try {
        const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(id);
        if (!tank) return res.status(404).json({ error: 'Tank not found' });
        res.json(tank);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/tanks', (req, res) => {
    try {
        const { name, type, address, camera_url, width, height, depth, volume, cam_brightness, cam_contrast, cam_saturation, water_type, tank_height, sensor_offset, ph_offset, tds_k_value, temp_offset } = req.body;

        // Find first available gap ID
        const activeIds = db.prepare('SELECT id FROM tanks ORDER BY id ASC').all().map(t => t.id);
        let newId = 1;
        while (activeIds.includes(newId)) {
            newId++;
        }

        const result = db.prepare('INSERT INTO tanks (id, name, type, address, camera_url, width, height, depth, volume, cam_brightness, cam_contrast, cam_saturation, water_type, tank_height, sensor_offset, ph_offset, tds_k_value, temp_offset) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(newId, name, type || 'esp32_wifi', address, camera_url || null, width || null, height || null, depth || null, volume || null, cam_brightness || 0.0, cam_contrast || 1.0, cam_saturation || 1.0, water_type || 'freshwater', tank_height || 45.0, sensor_offset || 2.0, ph_offset || 0.0, tds_k_value || 1.0, temp_offset || 0.0);

        // Initialize controls for the new tank
        initializeControlsForTank(newId);

        res.json({ success: true, id: newId });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/tanks/:id/calibration-mode', (req, res) => {
    const id = parseInt(req.params.id);
    const { active } = req.body;

    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    // Update State
    tankCalibrationModes.set(id, active === true);
    console.log(`[Calibration] Tank ${id} Mode: ${active ? 'ON' : 'OFF'}`);

    // Send to Arduino if connected
    if (tankSerialPorts.has(id)) {
        const port = tankSerialPorts.get(id);
        if (port && port.isOpen) {
            const cmd = `CAL:MODE:${active ? 'ON' : 'OFF'}\n`;
            port.write(cmd, (err) => {
                if (err) console.error(`[Serial] Error sending CAL cmd:`, err);
                else console.log(`[Serial] Sent ${cmd.trim()}`);
            });
        }
    }

    res.json({ success: true, mode: active });
});

app.put('/api/tanks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    try {
        // 1. Fetch current tank to support partial updates
        const currentTank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(id);
        if (!currentTank) return res.status(404).json({ error: 'Tank not found' });

        // 2. Merge existing data with new data
        // Explicitly extract fields from body to avoid pollution, but fall back to currentTank if undefined
        const b = req.body;

        console.log(`[PUT DEBUG] Tank ${id} Update. Body:`, JSON.stringify(b));
        console.log(`[PUT DEBUG] Current Tank:`, JSON.stringify(currentTank));

        const newName = b.name !== undefined ? b.name : currentTank.name;

        let newType = b.type !== undefined ? b.type : currentTank.type;
        if (id === 1) newType = 'arduino_local'; // Guard: Tank 1 forced type

        const newAddress = b.address !== undefined ? b.address : currentTank.address;
        const newCamUrl = b.camera_url !== undefined ? b.camera_url : currentTank.camera_url;

        // Dimensions
        const newWidth = b.width !== undefined ? b.width : currentTank.width;
        const newHeight = b.height !== undefined ? b.height : currentTank.height;
        const newDepth = b.depth !== undefined ? b.depth : currentTank.depth;
        const newVolume = b.volume !== undefined ? b.volume : currentTank.volume;

        // Camera Settings
        const newBright = b.cam_brightness !== undefined ? b.cam_brightness : currentTank.cam_brightness;
        const newContr = b.cam_contrast !== undefined ? b.cam_contrast : currentTank.cam_contrast;
        const newSat = b.cam_saturation !== undefined ? b.cam_saturation : currentTank.cam_saturation;

        // Config
        const newWaterType = b.water_type !== undefined ? b.water_type : currentTank.water_type;
        const newTankHeight = b.tank_height !== undefined ? b.tank_height : currentTank.tank_height;
        const newSensorOffset = b.sensor_offset !== undefined ? b.sensor_offset : currentTank.sensor_offset;
        const newPhOffset = b.ph_offset !== undefined ? b.ph_offset : currentTank.ph_offset;
        const newTdsKValue = b.tds_k_value !== undefined ? b.tds_k_value : currentTank.tds_k_value;
        const newTempOffset = b.temp_offset !== undefined ? b.temp_offset : currentTank.temp_offset;

        // 3. Update with merged values
        const result = db.prepare(`
            UPDATE tanks SET 
            name = ?, type = ?, address = ?, camera_url = ?, 
            width = ?, height = ?, depth = ?, volume = ?, 
            cam_brightness = ?, cam_contrast = ?, cam_saturation = ?, 
            water_type = ?, tank_height = ?, sensor_offset = ?,
            ph_offset = ?, tds_k_value = ?, temp_offset = ?
            WHERE id = ?
        `).run(
            newName, newType, newAddress, newCamUrl,
            newWidth, newHeight, newDepth, newVolume,
            newBright, newContr, newSat,
            newWaterType, newTankHeight, newSensorOffset,
            newPhOffset, newTdsKValue, newTempOffset,
            id
        );

        console.log(`[PUT DEBUG] Update Result Changes: ${result.changes}`);
        console.log(`[PUT DEBUG] New Height: ${newTankHeight}, New Offset: ${newSensorOffset}`);

        if (result.changes > 0) {
            // Push config to Arduino/Serial if changed
            sendSensorConfig(id);
            res.json({ success: true, id });
        } else {
            res.status(404).json({ error: 'Tank not found (Update failed)' });
        }
    } catch (e) {
        console.error('[PUT Tank] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Update ONLY camera image settings (lightweight)
app.post('/api/tanks/:id/camera-settings', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });

    try {
        const { cam_brightness, cam_contrast, cam_saturation } = req.body;

        console.log(`[Camera Settings] Updating Tank ${id}: Bright=${cam_brightness}, Contrast=${cam_contrast}, Saturation=${cam_saturation}`);

        const result = db.prepare('UPDATE tanks SET cam_brightness = ?, cam_contrast = ?, cam_saturation = ? WHERE id = ?')
            .run(cam_brightness, cam_contrast, cam_saturation, id);

        if (result.changes > 0) {
            // Restart camera to apply changes
            killTankCamera(id).then(() => {
                startTankCamera(id);
            });
            res.json({ success: true, id });
        } else {
            res.status(404).json({ error: 'Tank not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Settings ---
app.get('/api/settings', (req, res) => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(row => {
        settings[row.key] = row.value;
    });
    settings.geminiApiKey = GEMINI_API_KEY ? '***configured***' : '';
    res.json(settings);
});

app.post('/api/settings', (req, res) => {
    const { key, value } = req.body;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    res.json({ success: true });
});

// ============== ALERTS & NOTIFICATIONS ==============

// Get notification settings
function getNotificationSettings() {
    let settings = db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
    if (!settings) {
        db.prepare(`INSERT OR IGNORE INTO notification_settings (id) VALUES (1)`).run();
        settings = db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
    }
    return settings;
}

// Send notification via configured providers (supports both simultaneously)
async function sendNotification(title, message, priority = 'default') {
    const settings = getNotificationSettings();
    if (!settings || !settings.enabled) {
        console.log('Notifications disabled or not configured');
        return;
    }

    const promises = [];

    // Send to ntfy if configured
    if (settings.ntfy_topic) {
        // ntfy expects plain text body with message
        const fullMessage = `${title}\n\n${message}`;
        const ntfyPromise = fetch(`${settings.ntfy_server}/${settings.ntfy_topic}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain; charset=utf-8'
            },
            body: fullMessage
        })
            .then(res => {
                if (res.ok) {
                    console.log('✓ ntfy notification sent:', title);
                } else {
                    console.error('✗ ntfy error status:', res.status);
                }
            })
            .catch(err => console.error('✗ ntfy error:', err.message, err));
        promises.push(ntfyPromise);
    }

    // Send to Telegram if configured
    if (settings.telegram_bot_token && settings.telegram_chat_id) {
        const telegramPromise = fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: settings.telegram_chat_id,
                text: `🐠 <b>${title}</b>\n\n${message}`,
                parse_mode: 'HTML'
            })
        })
            .then(() => console.log('✓ Telegram notification sent:', title))
            .catch(err => console.error('✗ Telegram error:', err.message));
        promises.push(telegramPromise);
    }

    if (promises.length === 0) {
        console.log('No notification providers configured. Settings state:');
        console.log(`- ntfy: ${settings.ntfy_topic ? 'Configured' : 'Missing Topic'} (${settings.ntfy_server})`);
        console.log(`- Telegram: ${settings.telegram_bot_token && settings.telegram_chat_id ? 'Configured' : 'Missing Token/ChatID'}`);
    }

    await Promise.all(promises);
}

// Log alert to database and broadcast
function logAlert(type, parameter, message, value, tankId) {
    const tid = tankId || 1;
    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO alert_log (tank_id, type, parameter, message, value, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(tid, type, parameter, message, value, now);
    // Keep only last 500 alerts (per tank or globally? globally is fine for now, or per tank)
    // Cleanup old global alerts
    db.exec('DELETE FROM alert_log WHERE id NOT IN (SELECT id FROM alert_log ORDER BY timestamp DESC LIMIT 500)');

    // Broadcast new alert via WebSocket
    broadcast({
        type: 'new_alert',
        tankId: tid,
        data: {
            id: result.lastInsertRowid,
            timestamp: new Date().toISOString(),
            tankId: tid,
            type: type,
            parameter: parameter,
            message: message,
            value: value
        }
    });
}

// Send device trigger notification
async function notifyDeviceTrigger(deviceId, state, source = 'schedule', tankId = 1) {
    console.log(`[notifyDeviceTrigger] Called for ${deviceId} -> ${state ? 'ON' : 'OFF'} (Tank ${tankId})`);

    const settings = getNotificationSettings();

    if (!settings) {
        console.log('[notifyDeviceTrigger] No settings found');
        return;
    }
    if (!settings.enabled) {
        console.log('[notifyDeviceTrigger] Notifications disabled');
        return;
    }
    if (!settings.notify_device_triggers) {
        console.log('[notifyDeviceTrigger] Device triggers disabled');
        return;
    }

    const deviceNames = {
        mainLight: 'Luci Diurne',
        blueLight: 'Luci Lunari',
        pump: 'Pompa Risalita',
        skimmer: 'Skimmer',
        heater: 'Riscaldatore',
        feeder: 'Mangiatoia'
    };

    // Get tank name
    const tank = db.prepare('SELECT name FROM tanks WHERE id = ?').get(tankId);
    const tankName = tank ? tank.name : `Vasche ${tankId}`;

    const name = deviceNames[deviceId] || deviceId;
    const stateText = state ? 'ACCESO' : 'SPENTO';
    const message = `[${tankName}] ${name} è stato ${stateText} (${source})`;

    console.log('[notifyDeviceTrigger] Sending notification:', message);
    await sendNotification('🔌 Dispositivo Attivato', message);
    logAlert('device_trigger', deviceId, message, state ? 1 : 0, tankId);
}

// --- Alert Thresholds API ---
app.get('/api/alerts/thresholds', (req, res) => {
    const tankId = req.query.tankId || 1;
    const thresholds = db.prepare('SELECT * FROM alert_thresholds WHERE tank_id = ?').all(tankId);
    res.json(thresholds);
});

app.post('/api/alerts/thresholds', (req, res) => {
    const { id, parameter, min_value, max_value, delta_value, delta_minutes, enabled, tankId } = req.body;
    const tid = tankId || 1;

    console.log(`[Thresholds Save] Saving threshold for: ${parameter} (Tank ${tid})`);

    // Check if threshold exists for this parameter AND tank
    const existing = db.prepare('SELECT id FROM alert_thresholds WHERE parameter = ? AND tank_id = ?').get(parameter, tid);
    const existingId = existing ? existing.id : null;

    db.prepare(`
        INSERT OR REPLACE INTO alert_thresholds (id, tank_id, parameter, min_value, max_value, delta_value, delta_minutes, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(existingId, tid, parameter, min_value, max_value, delta_value, delta_minutes, enabled ? 1 : 0);

    console.log('[Thresholds Save] Threshold saved for:', parameter);
    res.json({ success: true });
});

app.delete('/api/alerts/thresholds/:id', (req, res) => {
    db.prepare('DELETE FROM alert_thresholds WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// --- Notification Settings API ---
app.get('/api/alerts/settings', (req, res) => {
    const settings = getNotificationSettings();
    // Don't expose full tokens
    if (settings.telegram_bot_token) {
        settings.telegram_bot_token = settings.telegram_bot_token.substring(0, 10) + '...';
    }
    res.json(settings);
});

app.post('/api/alerts/settings', (req, res) => {
    const { provider, ntfy_server, ntfy_topic, telegram_bot_token, telegram_chat_id,
        notify_device_triggers, notify_thresholds, notify_delta, enabled } = req.body;

    console.log('[Settings Save] Saving notification settings:', { provider, ntfy_topic, enabled });

    // Get existing token if new one is masked
    let tokenToSave = telegram_bot_token;
    if (telegram_bot_token && telegram_bot_token.includes('...')) {
        // Keep existing token
        const existing = db.prepare('SELECT telegram_bot_token FROM notification_settings WHERE id = 1').get();
        tokenToSave = existing?.telegram_bot_token || '';
    }

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO notification_settings 
        (id, provider, ntfy_server, ntfy_topic, telegram_bot_token, telegram_chat_id,
         notify_device_triggers, notify_thresholds, notify_delta, enabled)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        provider || 'ntfy',
        ntfy_server || 'https://ntfy.sh',
        ntfy_topic || '',
        tokenToSave || '',
        telegram_chat_id || '',
        notify_device_triggers ? 1 : 0,
        notify_thresholds ? 1 : 0,
        notify_delta ? 1 : 0,
        enabled ? 1 : 0
    );

    console.log('[Settings Save] Notification settings saved successfully');
    res.json({ success: true });
});

// --- Alert Log API ---
app.get('/api/alerts/log', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const tankId = req.query.tankId || 1;
    const logs = db.prepare('SELECT * FROM alert_log WHERE tank_id = ? ORDER BY timestamp DESC LIMIT ?').all(tankId, limit);
    res.json(logs);
});

// --- Test Notification ---
app.post('/api/alerts/test', async (req, res) => {
    try {
        const settings = getNotificationSettings();

        if (!settings.ntfy_topic && !settings.telegram_bot_token) {
            return res.json({ success: false, message: 'Configura prima ntfy topic o Telegram' });
        }

        const title = 'Test AquaMind';
        const message = 'Questa è una notifica di test. Se la ricevi, la configurazione è corretta! 🐠';
        const results = [];

        // Send to ntfy if configured
        if (settings.ntfy_topic) {
            try {
                const fullMessage = `${title}\n\n${message}`;
                const res = await fetch(`${settings.ntfy_server}/${settings.ntfy_topic}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8'
                    },
                    body: fullMessage
                });
                if (res.ok) {
                    results.push('ntfy ✓');
                } else {
                    results.push(`ntfy ✗ (${res.status})`);
                }
            } catch (err) {
                console.error('ntfy test error:', err);
                results.push('ntfy ✗');
            }
        }

        // Send to Telegram if configured
        if (settings.telegram_bot_token && settings.telegram_chat_id) {
            try {
                await fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: settings.telegram_chat_id,
                        text: `🐠 <b>${title}</b>\n\n${message}`,
                        parse_mode: 'HTML'
                    })
                });
                results.push('Telegram ✓');
            } catch (err) {
                results.push('Telegram ✗');
            }
        }

        res.json({ success: true, message: `Inviato a: ${results.join(', ')}` });
    } catch (err) {
        console.error('Test notification error:', err);
        res.json({ success: false, message: err.message });
    }
});

// ============== ALERT PROCESSOR ==============
let lastAlertTimes = {}; // Track last alert time per parameter/tank
let sensorHistoryMap = new Map();  // Map: tankId -> [{timestamp, ...sensors}]

// [Legacy checkAlerts removed] - Alert logic is now handled in saveSensorReading()
// [Legacy setInterval removed]

// --- System Status ---
app.get('/api/status', (req, res) => {
    res.json({
        serialConnected,
        serialPort: SERIAL_PORT,
        cameraDevice: CAMERA_DEVICE,
        uptime: process.uptime(),
        geminiConfigured: !!GEMINI_API_KEY
    });
});

// --- Gemini API Proxy ---
app.post('/api/gemini', async (req, res) => {
    if (!GEMINI_API_KEY) {
        return res.status(400).json({ error: 'Gemini API key not configured' });
    }

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            }
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============== VIDEO STREAMING ==============
// ============== VIDEO STREAMING ==============
// Map: tankId -> { process, subscribers (Set), buffer, locked, settings, url }
const tankCameras = new Map();

// Configuration
const DEFAULT_CAMERA_DEVICE = process.env.CAMERA_DEVICE || '/dev/video0'; // Physical USB camera

// ============== CHAT HISTORY ==============

// Get conversations list
app.get('/api/conversations', (req, res) => {
    const tankId = parseInt(req.query.tankId) || 1;
    try {
        const rows = db.prepare('SELECT * FROM conversations WHERE tank_id = ? ORDER BY updated_at DESC').all(tankId);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new conversation
app.post('/api/conversations', (req, res) => {
    const { tankId, title } = req.body;
    try {
        const result = db.prepare('INSERT INTO conversations (tank_id, title) VALUES (?, ?)').run(tankId, title || 'Nuova Conversazione');
        const newConv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
        res.json(newConv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update conversation title
app.put('/api/conversations/:id', (req, res) => {
    const { title } = req.body;
    try {
        db.prepare('UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title, req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete conversation
app.delete('/api/conversations/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM conversations WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages for a conversation
app.get('/api/conversations/:id/messages', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC').all(req.params.id);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add message to conversation
app.post('/api/conversations/:id/messages', (req, res) => {
    const { sender, content } = req.body;
    const conversationId = req.params.id;
    try {
        const result = db.prepare('INSERT INTO messages (conversation_id, sender, content) VALUES (?, ?, ?)').run(conversationId, sender, content);

        // Update conversation timestamp
        db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);

        const newMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
        res.json(newMsg);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============== RECIPES API ==============

app.get('/api/recipes', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all();
        res.json(rows);
    } catch (error) {
        console.error('Error fetching recipes:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/recipes', (req, res) => {
    try {
        const { title, content, category } = req.body;
        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required' });
        }
        const result = db.prepare('INSERT INTO recipes (title, content, category) VALUES (?, ?, ?)').run(title, content, category || 'general');
        res.json({ id: result.lastInsertRowid, title, content, category });
    } catch (error) {
        console.error('Error creating recipe:', error);
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/recipes/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting recipe:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============== BACKUP / EXPORT ==============
// Export single tank data
app.get('/api/tanks/:id/export', (req, res) => {
    const tankId = parseInt(req.params.id);
    if (!tankId) return res.status(400).json({ error: 'Invalid tank ID' });

    try {
        // Get tank configuration
        const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(tankId);
        if (!tank) return res.status(404).json({ error: 'Tank not found' });

        // Get all related data
        const recipes = db.prepare('SELECT * FROM recipes').all(); // Global recipes
        const maintenanceLog = db.prepare('SELECT * FROM maintenance_log WHERE tank_id = ? ORDER BY date DESC').all(tankId);
        const maintenanceRecurring = db.prepare('SELECT * FROM maintenance_recurring WHERE tank_id = ?').all(tankId);
        const plants = db.prepare('SELECT * FROM plants_inventory WHERE tank_id = ?').all(tankId);
        const fish = db.prepare('SELECT * FROM fish_inventory WHERE tank_id = ?').all(tankId);
        const waterParams = db.prepare('SELECT * FROM water_parameters WHERE tank_id = ? ORDER BY date DESC').all(tankId);
        const alertThresholds = db.prepare('SELECT * FROM alert_thresholds WHERE tank_id = ?').all(tankId);
        const schedules = db.prepare('SELECT * FROM schedules WHERE tank_id = ?').all(tankId);
        const controls = db.prepare('SELECT * FROM controls WHERE tank_id = ?').all(tankId);

        // Sensor history - last 2 days only
        const sensorHistory = db.prepare(`
            SELECT * FROM sensor_history 
            WHERE tank_id = ? 
            AND timestamp >= datetime('now', '-2 days')
            ORDER BY timestamp DESC
        `).all(tankId);

        // AI conversations - last 30 days
        const conversations = db.prepare(`
            SELECT * FROM conversations 
            WHERE tank_id = ? 
            AND updated_at >= datetime('now', '-30 days')
            ORDER BY updated_at DESC
        `).all(tankId);

        // For each conversation, get messages
        const conversationsWithMessages = conversations.map(conv => {
            const messages = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC').all(conv.id);
            return { ...conv, messages };
        });

        // Build export object
        const exportData = {
            version: '1.0',
            exported_at: new Date().toISOString(),
            tank: tank,
            recipes: recipes,
            maintenance: {
                log: maintenanceLog,
                recurring: maintenanceRecurring
            },
            inventory: {
                plants: plants,
                fish: fish
            },
            water_parameters: waterParams,
            alert_thresholds: alertThresholds,
            schedules: schedules,
            controls: controls,
            sensor_history: sensorHistory,
            ai_conversations: conversationsWithMessages
        };

        console.log(`[Export] Tank ${tankId} exported successfully (${sensorHistory.length} sensor records, ${conversations.length} conversations)`);
        res.json(exportData);
    } catch (error) {
        console.error('[Export] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Import tank data (replace mode)
app.post('/api/tanks/:id/import', (req, res) => {
    const tankId = parseInt(req.params.id);
    if (!tankId) return res.status(400).json({ error: 'Invalid tank ID' });

    const backupData = req.body;
    if (!backupData || !backupData.version) {
        return res.status(400).json({ error: 'Invalid backup file format' });
    }

    try {
        // Verify tank exists
        const tank = db.prepare('SELECT * FROM tanks WHERE id = ?').get(tankId);
        if (!tank) return res.status(404).json({ error: 'Tank not found' });

        console.log(`[Import] Starting import for Tank ${tankId}...`);

        // Start transaction for atomic restore
        db.prepare('BEGIN TRANSACTION').run();

        try {
            // 1. Clear existing data for this tank
            db.prepare('DELETE FROM maintenance_log WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM maintenance_recurring WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM plants_inventory WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM fish_inventory WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM water_parameters WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM alert_thresholds WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM schedules WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM controls WHERE tank_id = ?').run(tankId);
            db.prepare('DELETE FROM sensor_history WHERE tank_id = ?').run(tankId);

            // Delete conversations and messages for this tank
            const convIds = db.prepare('SELECT id FROM conversations WHERE tank_id = ?').all(tankId).map(c => c.id);
            if (convIds.length > 0) {
                const placeholders = convIds.map(() => '?').join(',');
                db.prepare(`DELETE FROM messages WHERE conversation_id IN (${placeholders})`).run(...convIds);
            }
            db.prepare('DELETE FROM conversations WHERE tank_id = ?').run(tankId);

            console.log(`[Import] Cleared existing data for Tank ${tankId}`);

            // 2. Update tank configuration
            if (backupData.tank) {
                const t = backupData.tank;
                db.prepare(`
                    UPDATE tanks SET 
                        name = ?, type = ?, address = ?, camera_url = ?,
                        width = ?, height = ?, depth = ?, volume = ?,
                        water_type = ?, light_watts = ?, heater_watts = ?,
                        temp_offset = ?, ph_offset = ?, tds_k_value = ?,
                        min_distance = ?, max_distance = ?
                    WHERE id = ?
                `).run(
                    t.name, t.type, t.address, t.camera_url,
                    t.width, t.height, t.depth, t.volume,
                    t.water_type, t.light_watts, t.heater_watts,
                    t.temp_offset || 0, t.ph_offset || 0, t.tds_k_value || 1.0,
                    t.min_distance || 5, t.max_distance || 15,
                    tankId
                );
            }

            // 3. Restore maintenance logs
            if (backupData.maintenance?.log) {
                const stmt = db.prepare('INSERT INTO maintenance_log (tank_id, date, type, description, created_at) VALUES (?, ?, ?, ?, ?)');
                for (const log of backupData.maintenance.log) {
                    stmt.run(tankId, log.date, log.type, log.description, log.created_at || new Date().toISOString());
                }
                console.log(`[Import] Restored ${backupData.maintenance.log.length} maintenance logs`);
            }

            // 4. Restore recurring maintenance
            if (backupData.maintenance?.recurring) {
                const stmt = db.prepare('INSERT INTO maintenance_recurring (tank_id, type, description, frequency, interval, weekdays, day_of_month, start_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                for (const recur of backupData.maintenance.recurring) {
                    stmt.run(tankId, recur.type, recur.description, recur.frequency, recur.interval, recur.weekdays, recur.day_of_month, recur.start_date);
                }
                console.log(`[Import] Restored ${backupData.maintenance.recurring.length} recurring maintenance schedules`);
            }

            // 5. Restore plants
            if (backupData.inventory?.plants) {
                const stmt = db.prepare('INSERT INTO plants_inventory (tank_id, name, species, quantity, date_added, price, photo_url, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                for (const plant of backupData.inventory.plants) {
                    stmt.run(tankId, plant.name, plant.species, plant.quantity, plant.date_added, plant.price, plant.photo_url, plant.notes, plant.status, plant.created_at);
                }
                console.log(`[Import] Restored ${backupData.inventory.plants.length} plants`);
            }

            // 6. Restore fish
            if (backupData.inventory?.fish) {
                const stmt = db.prepare('INSERT INTO fish_inventory (tank_id, name, species, quantity, date_added, price, photo_url, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                for (const fish of backupData.inventory.fish) {
                    stmt.run(tankId, fish.name, fish.species, fish.quantity, fish.date_added, fish.price, fish.photo_url, fish.notes, fish.status, fish.created_at);
                }
                console.log(`[Import] Restored ${backupData.inventory.fish.length} fish`);
            }

            // 7. Restore water parameters
            if (backupData.water_parameters) {
                const stmt = db.prepare('INSERT INTO water_parameters (tank_id, date, no2, no3, nh3, ph, ph_source, gh, kh, po4, fe, co2, o2, cl, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                for (const param of backupData.water_parameters) {
                    stmt.run(tankId, param.date, param.no2, param.no3, param.nh3, param.ph, param.ph_source, param.gh, param.kh, param.po4, param.fe, param.co2, param.o2, param.cl, param.notes, param.created_at);
                }
                console.log(`[Import] Restored ${backupData.water_parameters.length} water parameter records`);
            }

            // 8. Restore alert thresholds
            if (backupData.alert_thresholds) {
                const stmt = db.prepare('INSERT INTO alert_thresholds (tank_id, parameter, min_value, max_value, delta_value, delta_minutes, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)');
                for (const threshold of backupData.alert_thresholds) {
                    stmt.run(tankId, threshold.parameter, threshold.min_value, threshold.max_value, threshold.delta_value, threshold.delta_minutes, threshold.enabled);
                }
                console.log(`[Import] Restored ${backupData.alert_thresholds.length} alert thresholds`);
            }

            // 9. Restore schedules
            if (backupData.schedules) {
                const stmt = db.prepare('INSERT INTO schedules (tank_id, device_id, label, days, start_time, end_time, quantity, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
                for (const sched of backupData.schedules) {
                    stmt.run(tankId, sched.device_id, sched.label, sched.days, sched.start_time, sched.end_time, sched.quantity || 1, sched.active);
                }
                console.log(`[Import] Restored ${backupData.schedules.length} schedules`);
            }

            // 10. Restore controls state
            if (backupData.controls) {
                const stmt = db.prepare('INSERT INTO controls (device_id, tank_id, state, updated_at) VALUES (?, ?, ?, ?)');
                for (const control of backupData.controls) {
                    stmt.run(control.device_id || control.device, tankId, control.state, control.updated_at || control.timestamp);
                }
                console.log(`[Import] Restored ${backupData.controls.length} control states`);
            }

            // 11. Restore sensor history
            if (backupData.sensor_history) {
                const stmt = db.prepare('INSERT INTO sensor_history (tank_id, timestamp, temp, ph, tds, level) VALUES (?, ?, ?, ?, ?, ?)');
                for (const history of backupData.sensor_history) {
                    stmt.run(tankId, history.timestamp, history.temp, history.ph, history.tds, history.level);
                }
                console.log(`[Import] Restored ${backupData.sensor_history.length} sensor history records`);
            }

            // 12. Restore AI conversations
            if (backupData.ai_conversations) {
                for (const conv of backupData.ai_conversations) {
                    const convResult = db.prepare('INSERT INTO conversations (tank_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
                        tankId, conv.title, conv.created_at, conv.updated_at
                    );
                    const newConvId = convResult.lastInsertRowid;

                    if (conv.messages && conv.messages.length > 0) {
                        const msgStmt = db.prepare('INSERT INTO messages (conversation_id, sender, content, timestamp) VALUES (?, ?, ?, ?)');
                        for (const msg of conv.messages) {
                            msgStmt.run(newConvId, msg.sender || msg.role, msg.content, msg.timestamp);
                        }
                    }
                }
                console.log(`[Import] Restored ${backupData.ai_conversations.length} AI conversations`);
            }

            // 13. Recipes are global, merge them (skip if title already exists)
            if (backupData.recipes) {
                let addedRecipes = 0;
                const existingTitles = db.prepare('SELECT title FROM recipes').all().map(r => r.title.toLowerCase());
                const stmt = db.prepare('INSERT INTO recipes (title, content, category, created_at) VALUES (?, ?, ?, ?)');
                for (const recipe of backupData.recipes) {
                    if (!existingTitles.includes(recipe.title.toLowerCase())) {
                        stmt.run(recipe.title, recipe.content, recipe.category, recipe.created_at);
                        addedRecipes++;
                    }
                }
                console.log(`[Import] Added ${addedRecipes} new recipes (${backupData.recipes.length - addedRecipes} duplicates skipped)`);
            }

            // Commit transaction
            db.prepare('COMMIT').run();

            console.log(`[Import] Tank ${tankId} import completed successfully`);
            res.json({ success: true, message: 'Import completato con successo' });

        } catch (innerError) {
            // Rollback on error
            db.prepare('ROLLBACK').run();
            throw innerError;
        }

    } catch (error) {
        console.error('[Import] Error:', error);
        res.status(500).json({ error: error.message });
    }
});



// ============== GEMINI AI ==============
app.post('/api/gemini', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) {
            console.error('[Gemini] Missing API Key');
            return res.status(500).json({ error: 'GEMINI_API_KEY non configurata (.env mancante o vuota)' });
        }

        const { contents, tools } = req.body;
        console.log('[Gemini] Sending request to Google API...');

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents,
                tools,
                generationConfig: {
                    temperature: 0.7,
                }
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error('[Gemini] API Error Response:', JSON.stringify(data.error, null, 2));
            // Send the full error message/details to client for debugging
            return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
        }

        res.json(data);

    } catch (error) {
        console.error('[Gemini] Server Exception:', error);
        res.status(500).json({ error: error.message });
    }
});

// Properly kill ffmpeg for a specific tank
function killTankCamera(tankId) {
    return new Promise((resolve) => {
        const session = tankCameras.get(tankId);
        if (!session || !session.process) {
            resolve();
            return;
        }

        console.log(`[Camera] Killing ffmpeg process for Tank ${tankId}...`);
        const proc = session.process;
        session.process = null;
        session.buffer = Buffer.alloc(0);

        // Set up exit handler
        proc.once('exit', () => {
            console.log(`[Camera] Tank ${tankId} ffmpeg terminated`);
            // Wait additional time for device release
            setTimeout(resolve, 1500);
        });

        // Kill the process
        try {
            proc.kill('SIGKILL');
        } catch (e) { }

        // Fallback timeout
        setTimeout(() => {
            resolve();
        }, 3000);
    });
}

app.post('/api/tanks/:id/camera/restart', async (req, res) => {
    const tankId = parseInt(req.params.id);
    if (!tankId) return res.status(400).json({ error: 'Invalid tank ID' });

    console.log(`[Camera] Manual restart requested for Tank ${tankId}`);
    try {
        await killTankCamera(tankId);
        startTankCamera(tankId);
        res.json({ success: true });
    } catch (e) {
        console.error(`[Camera] Restart failed:`, e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/stream', (req, res) => {
    const tankId = parseInt(req.query.tankId) || 1;

    res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Ensure session exists
    if (!tankCameras.has(tankId)) {
        tankCameras.set(tankId, {
            process: null,
            subscribers: new Set(),
            buffer: Buffer.alloc(0),
            locked: false,
            settings: { ...cameraSettings } // Clone global defaults
        });
    }
    const session = tankCameras.get(tankId);

    // Start ffmpeg if not running
    if (!session.process && !session.locked) {
        startTankCamera(tankId);
    }

    const sendFrame = (frame) => {
        res.write(`--frame\r\nContent-Type: image/jpeg\r\n\r\n`);
        res.write(frame);
        res.write('\r\n');
    };

    // Subscribe
    session.subscribers.add(sendFrame);
    console.log(`[Camera] Client connected to Tank ${tankId} stream (${session.subscribers.size} active clients)`);

    req.on('close', () => {
        session.subscribers.delete(sendFrame);
        console.log(`[Camera] Client disconnected from Tank ${tankId} stream (${session.subscribers.size} remaining)`);

        // Stop camera if no more subscribers
        if (session.subscribers.size === 0 && session.process && !session.locked) {
            console.log(`[Camera] No more subscribers for Tank ${tankId}, stopping stream...`);
            killTankCamera(tankId);
        }
    });
});

// Reuse frameSubscribers ref (removed global Set, used per session)
// Reuse frameBuffer ref (removed global Buffer, used per session)

// Camera settings (configurable)
let cameraSettings = {
    resolution: '640x480',
    fps: 15
};

// Camera capabilities cache
let cameraCapabilities = null;
let cameraCapabilitiesTimestamp = 0;
const CACHE_DURATION = 60000; // Cache for 60 seconds

// Function to get camera capabilities from v4l2-ctl
async function getCameraCapabilities() {
    // Return cached if valid
    if (cameraCapabilities && (Date.now() - cameraCapabilitiesTimestamp) < CACHE_DURATION) {
        return cameraCapabilities;
    }

    // Default fallback
    const defaultCapabilities = {
        resolutions: ['640x480', '1280x720'],
        fps: [15, 30]
    };

    // Check if device exists
    if (!fs.existsSync(CAMERA_DEVICE)) {
        return defaultCapabilities;
    }

    return new Promise((resolve) => {
        const { exec } = require('child_process');

        exec(`v4l2-ctl --list-formats-ext -d ${CAMERA_DEVICE}`, { timeout: 5000 }, (error, stdout, stderr) => {
            if (error) {
                console.log('v4l2-ctl error, using defaults');
                resolve(defaultCapabilities);
                return;
            }

            const resolutions = new Set();
            const fpsSet = new Set();

            // Parse v4l2-ctl output
            // Example format:
            // Size: Discrete 640x480
            //   Interval: Discrete 0.033s (30.000 fps)
            const lines = stdout.split('\n');
            let currentResolution = null;

            for (const line of lines) {
                // Match resolution: "Size: Discrete 640x480" or "Size: Discrete 1920x1080"
                const sizeMatch = line.match(/Size:\s*Discrete\s*(\d+)x(\d+)/i);
                if (sizeMatch) {
                    currentResolution = `${sizeMatch[1]}x${sizeMatch[2]}`;
                    resolutions.add(currentResolution);
                }

                // Match fps: "Interval: Discrete 0.033s (30.000 fps)"
                const fpsMatch = line.match(/\((\d+(?:\.\d+)?)\s*fps\)/i);
                if (fpsMatch) {
                    const fps = Math.round(parseFloat(fpsMatch[1]));
                    if (fps > 0 && fps <= 60) {
                        fpsSet.add(fps);
                    }
                }
            }

            // Convert to sorted arrays
            const resolutionsArr = Array.from(resolutions).sort((a, b) => {
                const [w1] = a.split('x').map(Number);
                const [w2] = b.split('x').map(Number);
                return w1 - w2;
            });

            const fpsArr = Array.from(fpsSet).sort((a, b) => a - b);

            // Use parsed values or fallback
            cameraCapabilities = {
                resolutions: resolutionsArr.length > 0 ? resolutionsArr : defaultCapabilities.resolutions,
                fps: fpsArr.length > 0 ? fpsArr : defaultCapabilities.fps
            };
            cameraCapabilitiesTimestamp = Date.now();

            console.log('Camera capabilities detected:', cameraCapabilities);
            resolve(cameraCapabilities);
        });
    });
}

// Load camera settings from database
const savedCameraSettings = db.prepare("SELECT value FROM settings WHERE key = 'camera_resolution'").get();
const savedCameraFps = db.prepare("SELECT value FROM settings WHERE key = 'camera_fps'").get();
if (savedCameraSettings) cameraSettings.resolution = savedCameraSettings.value;
if (savedCameraFps) cameraSettings.fps = parseInt(savedCameraFps.value);

// Camera settings API
app.get('/api/camera/settings', async (req, res) => {
    const available = await getCameraCapabilities();
    res.json({
        ...cameraSettings,
        available
    });
});

app.post('/api/camera/settings', async (req, res) => {
    const { resolution, fps } = req.body;

    if (resolution) {
        cameraSettings.resolution = resolution;
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('camera_resolution', ?)").run(resolution);
    }
    if (fps) {
        cameraSettings.fps = parseInt(fps);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('camera_fps', ?)").run(fps.toString());
    }

    console.log(`[Camera] Settings updated: ${cameraSettings.resolution} @ ${cameraSettings.fps}fps`);

    // Restart all active sessions
    for (const [tankId, session] of tankCameras.entries()) {
        if (session.process) {
            session.locked = true;
            await killTankCamera(tankId);
            session.settings = { ...cameraSettings }; // Update session settings
            if (session.subscribers.size > 0) {
                session.locked = false;
                startTankCamera(tankId);
            } else {
                session.locked = false;
            }
        } else {
            session.settings = { ...cameraSettings };
        }
    }

    res.json({ success: true, settings: cameraSettings });
});

function startTankCamera(tankId) {
    const session = tankCameras.get(tankId);
    if (!session) return;

    // Prevent concurrent starts
    if (session.locked) {
        console.log(`[Camera] Tank ${tankId} locked, skipping start...`);
        return;
    }

    // If ffmpeg is still running, wait
    if (session.process) {
        console.log(`[Camera] Tank ${tankId} already running`);
        return;
    }

    // Get config
    const tank = db.prepare('SELECT camera_url, address, cam_brightness, cam_contrast, cam_saturation FROM tanks WHERE id = ?').get(tankId);
    let deviceUrl = tank ? tank.camera_url : null;

    // Fallback logic
    if (!deviceUrl) {
        if (tankId === 1) {
            deviceUrl = DEFAULT_CAMERA_DEVICE;
        } else {
            // For now, no fallback for secondary tanks unless specified
            console.log(`[Camera] No camera_url configured for Tank ${tankId}`);
            return;
        }
    }

    if (deviceUrl.startsWith('http') || deviceUrl.startsWith('rtsp')) {
        console.log(`[Camera] Starting stream for Tank ${tankId} from ${deviceUrl} (Native Resolution/FPS)`);
    } else {
        console.log(`[Camera] Starting stream for Tank ${tankId} from ${deviceUrl} at ${session.settings.resolution} ${session.settings.fps}fps`);
    }

    const args = [];
    // If URL is HTTP/RTSP
    if (deviceUrl.startsWith('http') || deviceUrl.startsWith('rtsp')) {
        if (deviceUrl.startsWith('rtsp')) {
            args.push('-rtsp_transport', 'tcp');
        }
        args.push('-i', deviceUrl);
    } else {
        // v4l2 device (physical or virtual loopback)
        if (!fs.existsSync(deviceUrl)) {
            console.log(`[Camera] Device ${deviceUrl} not found!`);
            return;
        }

        // v4l2 device (physical camera)
        args.push(
            '-f', 'v4l2',
            '-input_format', 'mjpeg',
            '-video_size', session.settings.resolution,
            '-framerate', String(session.settings.fps),
            '-i', deviceUrl
        );
    }

    // Output args with filters
    const brightness = tank.cam_brightness !== undefined && tank.cam_brightness !== null ? tank.cam_brightness : 0.0;
    const contrast = tank.cam_contrast !== undefined && tank.cam_contrast !== null ? tank.cam_contrast : 1.0;
    const saturation = tank.cam_saturation !== undefined && tank.cam_saturation !== null ? tank.cam_saturation : 1.0;

    args.push(
        '-vf', `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
        '-c:v', 'mjpeg',
        '-q:v', '5',
        '-f', 'mjpeg',
        '-'
    );

    // Try with auto-detection first (most compatible)
    // Add RT buffer size to avoid "buffer underrun" on high res
    // Note: rtbufsize must be applied to input if using dshow/v4l2, but we are constructing args array.
    // Insert it before -i
    // Let's modify args insertion above.
    // Actually, I'll just Replace the whole block cleanly.

    /* 
       Refined args construction:
       Input:
       -f v4l2
       -input_format mjpeg
       -video_size ...
       -framerate ...
       -thread_queue_size 1024
       -ts_mono2abs (optional fix for some timestamps?)
       -i /dev/video0
    */
    session.process = spawn('ffmpeg', args);
    let ffmpegStarted = false;

    session.process.stdout.on('data', (chunk) => {
        ffmpegStarted = true;

        session.buffer = Buffer.concat([session.buffer, chunk]);

        // Look for JPEG markers
        let start = 0;
        let framesFound = 0;
        while (true) {
            const soi = session.buffer.indexOf(Buffer.from([0xFF, 0xD8]), start);
            if (soi === -1) break;

            const eoi = session.buffer.indexOf(Buffer.from([0xFF, 0xD9]), soi);
            if (eoi === -1) break;

            const frame = session.buffer.slice(soi, eoi + 2);
            framesFound++;
            session.subscribers.forEach(sub => {
                try { sub(frame); } catch (e) { }
            });

            start = eoi + 2;
        }



        // Keep remaining buffer
        if (start > 0) {
            session.buffer = session.buffer.slice(start);
        }

        // Prevent buffer overflow
        if (session.buffer.length > 5 * 1024 * 1024) {
            session.buffer = Buffer.alloc(0);
        }
    });

    session.process.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('error') || msg.includes('Error') || msg.includes('Invalid')) {
            console.log(`[Camera Tank ${tankId}] ffmpeg error:`, msg.substring(0, 200));
        }
    });

    session.process.on('error', (err) => {
        console.error(`[Camera Tank ${tankId}] ffmpeg spawn error:`, err.message);
        session.process = null;
    });

    session.process.on('exit', (code) => {
        console.log(`[Camera Tank ${tankId}] ffmpeg exited with code ${code}`);
        session.process = null;

        // Retry if there are still subscribers (only if not locked)
        if (!ffmpegStarted && code !== 0 && session.subscribers.size > 0 && !session.locked) {
            console.log(`[Camera Tank ${tankId}] Camera failed, retrying in 5 seconds...`);
            setTimeout(() => startTankCamera(tankId), 5000);
        }
    });
}

app.delete('/api/tanks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid ID' });
    if (id === 1) return res.status(403).json({ error: 'Cannot delete the Main Aquarium (ID 1)' });

    try {


        // Delete related data first
        const tablesToDelete = ['sensor_history', 'controls', 'schedules', 'alert_thresholds', 'maintenance_log', 'water_parameters', 'fish_inventory', 'chihiros_devices', 'alert_log'];
        tablesToDelete.forEach(table => {
            db.prepare(`DELETE FROM ${table} WHERE tank_id = ?`).run(id);
        });

        const result = db.prepare('DELETE FROM tanks WHERE id = ?').run(id);
        if (result.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Tank not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============== ESP32 INTEGRATION =================
app.post('/api/esp32/sensors', (req, res) => {
    let { aquarium_id, temp, ph, tds, level, timestamp } = req.body;

    // Round values to avoid excessive precision
    if (temp !== undefined) temp = parseFloat(Number(temp).toFixed(1)); // 25.0
    if (ph !== undefined) ph = parseFloat(Number(ph).toFixed(2));     // 8.15
    if (tds !== undefined) tds = parseFloat(Number(tds).toFixed(0)); // TDS is usually integer-ish

    // Default to tank 2 if not provided (for now, or use ID 1)
    const tankId = aquarium_id || 2;

    try {
        // Validate Tank ID exists
        const tankExists = db.prepare('SELECT id FROM tanks WHERE id = ?').get(tankId);
        if (!tankExists) {
            console.warn(`[ESP32] Rejected data for unknown Tank ID: ${tankId}`);
            return res.status(410).json({ error: 'Tank ID not found/deleted (Reset required)' });
        }

        const stmt = db.prepare(`
            INSERT INTO sensor_history (tank_id, temp, ph, tds, level, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(tankId, temp, ph, tds, level, timestamp || new Date().toISOString());

        // Update firmware version if present in body
        if (req.body.fw_version) {
            db.prepare('UPDATE tanks SET firmware_version = ? WHERE id = ?').run(req.body.fw_version, tankId);
        }

        // Update global map for realtime/alerts
        currentSensorsMap.set(tankId, { temp, ph, tds, level, timestamp: timestamp || new Date().toISOString() });

        // Broadcast update via WebSocket
        // We broadcast a 'sensors_update' event with tankId
        broadcast({
            type: 'sensors_update',
            tankId: tankId,
            data: { temp, ph, tds, level, timestamp: timestamp || new Date().toISOString() }
        });

        res.json({ success: true, id: result.lastInsertRowid });
    } catch (e) {
        console.error('[ESP32] Sensor Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/esp32/controls/:id', (req, res) => {
    const tankId = parseInt(req.params.id);
    if (!tankId) return res.status(400).json({ error: 'Invalid tank ID' });

    try {
        const controls = db.prepare('SELECT * FROM controls WHERE tank_id = ?').all(tankId);

        // Map controls to outputs (simple heuristic based on device_id suffix or standard names)
        // Standard names: "relay1", "relay2", "heater", "filter", "light"
        // We map to output1, output2, output3, output4

        const response = {
            aquarium_id: tankId,
            output1: false,
            output2: false,
            output3: false,
            output4: false,
            timestamp: new Date().toISOString()
        };

        controls.forEach(c => {
            const state = c.state === 1;
            if (c.device_id.includes('relay1') || c.device_id.includes('outlet1') || c.device_id.endsWith('_1')) response.output1 = state;
            else if (c.device_id.includes('relay2') || c.device_id.includes('outlet2') || c.device_id.endsWith('_2')) response.output2 = state;
            else if (c.device_id.includes('relay3') || c.device_id.includes('outlet3') || c.device_id.endsWith('_3')) response.output3 = state;
            else if (c.device_id.includes('relay4') || c.device_id.includes('outlet4') || c.device_id.endsWith('_4')) response.output4 = state;
        });

        // Add Configuration for ESP32 Sync
        const tank = db.prepare('SELECT min_distance, max_distance, ph_offset, tds_k_value, temp_offset FROM tanks WHERE id = ?').get(tankId);
        if (tank) {
            response.min_distance = tank.min_distance;
            response.max_distance = tank.max_distance;
            response.ph_offset = tank.ph_offset;
            response.tds_k_value = tank.tds_k_value;
            response.temp_offset = tank.temp_offset;
        }

        // Add Calibration Mode Flag
        response.calibration_mode = tankCalibrationModes.get(tankId) === true;

        res.json(response);
    } catch (e) {
        console.error('[ESP32] Control Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Helper to send Config to Arduino via Serial
function sendSensorConfig(tankId) {
    if (!tankSerialPorts.has(tankId)) return;

    const tank = db.prepare('SELECT min_distance, max_distance, ph_offset, tds_k_value, temp_offset FROM tanks WHERE id = ?').get(tankId);
    if (!tank) return;

    const port = tankSerialPorts.get(tankId);
    if (port && port.isOpen) {
        // Send Level Config (New Format: MIN and MAX distance)
        const cmdLevel = `CONFIG:TANK:MIN:${tank.min_distance},MAX:${tank.max_distance}\n`;
        port.write(cmdLevel);

        // Send pH Config
        setTimeout(() => {
            const cmdPh = `CONFIG:PH:${tank.ph_offset}\n`;
            if (port.isOpen) port.write(cmdPh);
        }, 100);

        // Send TDS Config
        setTimeout(() => {
            const cmdTds = `CONFIG:TDS:${tank.tds_k_value}\n`;
            if (port.isOpen) port.write(cmdTds);
        }, 200);

        // Send Temp Config
        setTimeout(() => {
            const cmdTemp = `CONFIG:TEMP:${tank.temp_offset}\n`;
            if (port.isOpen) port.write(cmdTemp);
        }, 300);

        console.log(`[Serial] Sent configs to Tank ${tankId}`);
    }
}

// ============== START SERVER ==============
server.listen(PORT, '0.0.0.0', () => {
    console.log(`AquaMind Backend running on port ${PORT}`);
    console.log(`Serial port: ${SERIAL_PORT}`);
    console.log(`Camera device: ${CAMERA_DEVICE}`);
    console.log(`Camera settings: ${cameraSettings.resolution} @ ${cameraSettings.fps}fps`);
    console.log(`Gemini API: ${GEMINI_API_KEY ? 'Configured' : 'Not configured'}`);

    // Start background jobs AFTER server is listening to prioritize health checks
    startBackgroundJobs();
});

function startBackgroundJobs() {
    console.log('--- Starting Background Jobs ---');

    // 1. Chihiros Daemon
    startChihirosDaemon();

    // 2. Chihiros Scheduler (every 60s)
    setInterval(processChihirosSchedules, 60000);
    console.log('⏰ Chihiros scheduler started');

    // 3. Device Scheduler (every 2s)
    setInterval(processSchedules, 2000);
    setTimeout(processSchedules, 2000);
    console.log('⏰ Device scheduler started');

    // 4. Camera Stream Cleanup (every 30s)
    setInterval(() => {
        for (const [tankId, session] of tankCameras.entries()) {
            // Kill FFmpeg if it's running but has no subscribers
            if (session.process && session.subscribers.size === 0 && !session.locked) {
                console.log(`[Camera Cleanup] Killing orphaned FFmpeg process for Tank ${tankId}`);
                killTankCamera(tankId);
            }
        }
    }, 30000);
    console.log('⏰ Camera cleanup scheduler started');
}

// ============== SHUTDOWN HANDLING ==============
async function gracefulShutdown(signal) {
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

    // 1. Kill Chihiros Daemon
    if (chihirosDaemon) {
        console.log('[Server] Stopping Chihiros Daemon...');
        chihirosDaemon.kill();
    }

    // 2. Kill all Camera streams
    console.log('[Server] Stopping Camera streams...');
    // Create an array of promises to kill all cameras in parallel
    const killPromises = [];
    for (const [tankId, session] of tankCameras.entries()) {
        if (session.process) {
            console.log(`[Server] Killing camera for Tank ${tankId}...`);
            killPromises.push(killTankCamera(tankId));
        }
    }

    // Wait for all cameras to close (max 2 seconds safety)
    try {
        await Promise.race([
            Promise.all(killPromises),
            new Promise(resolve => setTimeout(resolve, 2000))
        ]);
    } catch (e) {
        console.error('[Server] Error closing cameras:', e);
    }

    // 3. Unpublish mDNS service
    try {
        console.log('[Server] Unpublishing mDNS service...');
        bonjour.destroy();
    } catch (e) {
        console.error('[Server] Error unpublishing mDNS:', e);
    }

    // 4. Close Database
    try {
        console.log('[Server] Closing Database...');
        db.close();
    } catch (e) {
        console.error('[Server] Error closing database:', e);
    }

    console.log('[Server] Shutdown complete. Bye!');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
31