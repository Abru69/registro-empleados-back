const db = require('./db');
const bcrypt = require('bcrypt');

async function init() {
  console.log("Inicializando base de datos SQLite...");
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'user'
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS registros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      hora_salida TEXT,
      total_horas REAL
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS empleados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL
    );
  `);

  const hash = await bcrypt.hash('12345', 10);
  try {
    await db.query(`INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)`, ['admin', hash, 'admin']);
    console.log("Usuario admin (clave 12345) insertado.");
  } catch (err) {
    console.log("Usuario admin ya existe.");
  }

  console.log("Inicialización exitosa.");
}

init().catch(console.error);
