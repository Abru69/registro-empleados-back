const db = require('./db');
const bcrypt = require('bcrypt');

async function init() {
  console.log("Inicializando base de datos PostgreSQL...");

  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      usuario TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'user'
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS registros (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      hora_salida TEXT,
      total_horas REAL,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS empleados (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
      UNIQUE(nombre, usuario_id)
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      CONSTRAINT session_pkey PRIMARY KEY (sid)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
  `);

  const hash = await bcrypt.hash('12345', 10);
  await db.query(
    `INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?) ON CONFLICT (usuario) DO NOTHING`,
    ['admin', hash, 'admin']
  );
  console.log("Usuario admin creado (usuario: admin / clave: 12345).");
  console.log("Inicialización exitosa.");
}

init().catch(console.error);