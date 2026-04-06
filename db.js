const { Pool } = require('pg');
 
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});
 
// Convert ? placeholders to $1, $2, ... for pg
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}
 
async function query(sql, params = []) {
  const pgSql = convertPlaceholders(sql);
  const result = await pool.query(pgSql, params);
  return [result.rows];
}
 
module.exports = { query, pool };
 