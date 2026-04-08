const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/registros_db',
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function query(text, params = []) {
  try {
    const res = await pool.query(text, params);
    // Para mantener retrocompatibilidad con el formato esperado [rows]
    return [res.rows]; 
  } catch (err) {
    console.error('Database Query Error:', err);
    throw err;
  }
}

module.exports = { query, pool };
