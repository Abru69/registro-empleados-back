const db = require('./db');
const bcrypt = require('bcrypt');

async function migrate() {
  console.log("Iniciando migración de la base de datos...");

  // 1. Empleados: Añadir columna usuario_id y cambiar UNIQUE constraint
  console.log("Migrando tabla empleados...");
  try {
    await db.query(`ALTER TABLE empleados ADD COLUMN IF NOT EXISTS usuario_id INTEGER NOT NULL DEFAULT 1`);
    // Drop old unique on nombre alone if exists, add composite unique
    await db.query(`ALTER TABLE empleados DROP CONSTRAINT IF EXISTS empleados_nombre_key`);
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'empleados_usuario_id_nombre_key') THEN
          ALTER TABLE empleados ADD CONSTRAINT empleados_usuario_id_nombre_key UNIQUE(usuario_id, nombre);
        END IF;
      END $$;
    `);
    console.log("Tabla empleados migrada.");
  } catch (err) {
    console.log("Posiblemente la tabla empleados ya fue migrada. Omitiendo...", err.message);
  }

  // 2. Registros: Solo añadir la columna usuario_id
  console.log("Migrando tabla registros...");
  try {
    await db.query(`ALTER TABLE registros ADD COLUMN IF NOT EXISTS usuario_id INTEGER NOT NULL DEFAULT 1`);
    console.log("Columna usuario_id añadida a registros.");
  } catch (err) {
    console.log("Posiblemente la columna usuario_id ya existe en registros. Omitiendo...", err.message);
  }

  // 3. Crear Usuarios: Jose y Juan con clave 12345
  console.log("Creando usuarios jose y juan...");
  const hash = await bcrypt.hash('12345', 10);
  await db.query(`INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?) ON CONFLICT (usuario) DO NOTHING`, ['jose', hash, 'user']);
  console.log("Usuario jose insertado (o ya existía).");
  
  await db.query(`INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?) ON CONFLICT (usuario) DO NOTHING`, ['juan', hash, 'user']);
  console.log("Usuario juan insertado (o ya existía).");

  // 4. Poblar empleados de prueba a sus respectivos usuarios
  console.log("Cargando empleados de prueba para jose y juan...");
  
  const [joseRows] = await db.query(`SELECT id FROM usuarios WHERE usuario = ?`, ['jose']);
  const [juanRows] = await db.query(`SELECT id FROM usuarios WHERE usuario = ?`, ['juan']);
  const idJose = joseRows[0].id;
  const idJuan = juanRows[0].id;

  const empJose = ['Tony Stark', 'Rosa', 'Alan'];
  const empJuan = ['Angy', 'Tere'];

  for (let nombre of empJose) {
    try { await db.query(`INSERT INTO empleados (nombre, usuario_id) VALUES (?, ?) ON CONFLICT (usuario_id, nombre) DO NOTHING`, [nombre, idJose]); } catch(e){}
  }
  for (let nombre of empJuan) {
    try { await db.query(`INSERT INTO empleados (nombre, usuario_id) VALUES (?, ?) ON CONFLICT (usuario_id, nombre) DO NOTHING`, [nombre, idJuan]); } catch(e){}
  }

  console.log("Migración completada exitosamente.");
}

migrate().catch(console.error);
