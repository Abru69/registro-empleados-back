const db = require('./db');
const bcrypt = require('bcrypt');

async function migrate() {
  console.log("Iniciando migración de la base de datos...");

  // 1. Empleados: Recrear tabla para cambiar el UNIQUE constraint
  console.log("Migrando tabla empleados...");
  try {
    await db.query(`ALTER TABLE empleados RENAME TO empleados_old`);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS empleados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        usuario_id INTEGER NOT NULL DEFAULT 1,
        UNIQUE(usuario_id, nombre)
      );
    `);

    // Pasar la data al nuevo (aquí se les pondrá usuario_id = 1 implícitamente por el default si no lo proveemos, o podemos setearlo)
    await db.query(`INSERT INTO empleados (id, nombre, usuario_id) SELECT id, nombre, 1 FROM empleados_old`);
    await db.query(`DROP TABLE empleados_old`);
    console.log("Tabla empleados migrada.");
  } catch (err) {
    if (err.message.includes('no such table')) {
      console.log("La tabla empleados no existe o ya fue migrada parcialmente.");
    } else {
      console.log("Posiblemente la tabla empleados ya fue migrada. Omitiendo...", err.message);
    }
  }

  // 2. Registros: Solo añadir la columna usuario_id
  console.log("Migrando tabla registros...");
  try {
    await db.query(`ALTER TABLE registros ADD COLUMN usuario_id INTEGER NOT NULL DEFAULT 1`);
    console.log("Columna usuario_id añadida a registros.");
  } catch (err) {
    console.log("Posiblemente la columna usuario_id ya existe en registros. Omitiendo...", err.message);
  }

  // 3. Crear Usuarios: Jose y Juan con clave 12345
  console.log("Creando usuarios jose y juan...");
  const hash = await bcrypt.hash('12345', 10);
  try {
    await db.query(`INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)`, ['jose', hash, 'user']);
    console.log("Usuario jose insertado.");
  } catch(e) { console.log("Usuario jose ya existe."); }
  
  try {
    await db.query(`INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)`, ['juan', hash, 'user']);
    console.log("Usuario juan insertado.");
  } catch(e) { console.log("Usuario juan ya existe."); }

  // 4. Poblar empleados de prueba a sus respecivos usuarios
  console.log("Cargando empleados de prueba para jose y juan...");
  
  // Get users
  const [joseRows] = await db.query(`SELECT id FROM usuarios WHERE usuario = 'jose'`);
  const [juanRows] = await db.query(`SELECT id FROM usuarios WHERE usuario = 'juan'`);
  const idJose = joseRows[0].id;
  const idJuan = juanRows[0].id;

  const empJose = ['Tony Stark', 'Rosa', 'Alan'];
  const empJuan = ['Angy', 'Tere'];

  for (let nombre of empJose) {
    try { await db.query(`INSERT INTO empleados (nombre, usuario_id) VALUES (?, ?)`, [nombre, idJose]); } catch(e){}
  }
  for (let nombre of empJuan) {
    try { await db.query(`INSERT INTO empleados (nombre, usuario_id) VALUES (?, ?)`, [nombre, idJuan]); } catch(e){}
  }

  console.log("Migración completada exitosamente.");
}

migrate().catch(console.error);
