const Database = require('better-sqlite3');
const path = require('path');

// Adjusted path to DB relative to backend folder
const dbPath = process.env.DB_PATH || '../data/aquamind.db';
console.log('Using DB Path:', dbPath);

const db = new Database(dbPath);

console.log('--- Checking Tank Table Info ---');
const info = db.pragma('table_info(tanks)');
console.log(info);

console.log('\n--- Checking Existing Tanks ---');
const tanks = db.prepare('SELECT id, name, type, mac_address FROM tanks').all();
console.log(tanks);

console.log('\n--- Testing Insert Logic ---');
try {
    const mac = 'TEST:MAC:ADDRESS:01';

    // Check duplication
    const existingCheck = db.prepare('SELECT * FROM tanks WHERE mac_address = ?');
    // If column missing, this prepare might fail? No, prepare usually specific.

    if (existingCheck) {
        const existing = existingCheck.get(mac);
        if (existing) {
            console.log('Test tank already exists, deleting for retry...');
            db.prepare('DELETE FROM tanks WHERE mac_address = ?').run(mac);
        }
    }

    const result = db.prepare('INSERT INTO tanks (name, type, address, mac_address) VALUES (?, ?, ?, ?)').run(
        'Test Aquarium',
        'esp32_wifi',
        '1.2.3.4',
        mac
    );
    console.log('Insert Success:', result);

    // Cleanup
    db.prepare('DELETE FROM tanks WHERE id = ?').run(result.lastInsertRowid);
    console.log('Cleanup Success');
} catch (e) {
    console.error('INSERT FAILED:', e.message);
    if (e.message.includes('mac_address')) {
        console.log('!!! COLUMN mac_address MISSING !!!');
    }
}
