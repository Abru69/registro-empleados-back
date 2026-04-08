const { query, pool } = require('./db');
const bcrypt = require('bcryptjs');

async function initDB() {
  console.log('Iniciando DB...');

  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      usuario VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      rol VARCHAR(20) DEFAULT 'user'
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS empleados (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      UNIQUE (nombre, usuario_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS registros (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      fecha DATE NOT NULL,
      hora TIME NOT NULL,
      hora_salida TIME,
      total_horas REAL,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE
    );
  `);

  console.log('Tablas creadas (si no existían).');

  const [usuarios] = await query('SELECT * FROM usuarios WHERE usuario = $1', ['admin']);
  if (usuarios.length === 0) {
    const hash = await bcrypt.hash('admin123', 10);
    await query('INSERT INTO usuarios (usuario, password, rol) VALUES ($1, $2, $3)', ['admin', hash, 'admin']);
    console.log('Usuario admin por defecto insertado.');
  } else {
    console.log('El usuario admin ya existe.');
  }

  const [empleadoUsers] = await query('SELECT * FROM usuarios WHERE usuario = $1', ['empleado']);
  if (empleadoUsers.length === 0) {
    const hashEmpleado = await bcrypt.hash('empleado123', 10);
    await query('INSERT INTO usuarios (usuario, password, rol) VALUES ($1, $2, $3)', ['empleado', hashEmpleado, 'user']);
    console.log('Usuario empleado por defecto insertado.');
  } else {
    console.log('El usuario empleado ya existe.');
  }

  // Cerrar la conexión
  await pool.end();
}

initDB().catch(console.error);
