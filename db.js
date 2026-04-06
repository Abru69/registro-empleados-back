const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let dbPromise = null;

async function query(sql, params = []) {
  if (!dbPromise) {
    dbPromise = open({ filename: path.join(__dirname, 'database.sqlite'), driver: sqlite3.Database });
  }
  const db = await dbPromise;
  
  if (sql.trim().toUpperCase().startsWith('SELECT')) {
    const rows = await db.all(sql, params);
    return [rows];
  } else {
    const result = await db.run(sql, params);
    return [result];
  }
}

module.exports = { query };
