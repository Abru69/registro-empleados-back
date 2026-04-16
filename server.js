require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const upload = multer();
const db = require('./db');
// --- Nuevas inclusiones Swagger ---
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_fallback';
const PORT = process.env.PORT || 3000;

app.use(cors({ 
  origin: [FRONTEND_URL, 'http://localhost:4200'], 
  credentials: true 
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Configuración Swagger ---
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Registro de Empleados',
      version: '1.0.0',
      description: 'Documentación de los Endpoints (API) para asistencias de empleados.'
    },
    servers: [{ url: `http://localhost:${PORT}` }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        }
      }
    },
    security: [{ bearerAuth: [] }]
  },
  apis: ['./server.js']
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));


// Middleware JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.json({ success: false, status: 'error', mensaje: 'No hay token de acceso' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.json({ success: false, status: 'error', mensaje: 'Token inválido o expirado' });
    req.user_id = user.user_id;
    req.rol = user.rol;
    req.usuario = user.usuario;
    req.admin_id = user.admin_id; // Add admin_id from token
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.rol !== 'admin') {
    return res.status(403).json({ success: false, status: 'error', mensaje: 'Acceso denegado: se requiere rol de administrador' });
  }
  next();
}

function hhmmFromMinutes(m) {
  if (m === null || isNaN(m)) return null;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function mins(fecha, hEntrada, hSalida) {
  if (!hEntrada || !hSalida) return null;
  let e = new Date(`${fecha}T${hEntrada}`);
  let s = new Date(`${fecha}T${hSalida}`);
  if (s < e) s = new Date(s.getTime() + 86400000);
  return Math.round((s - e) / 60000);
}

/**
 * @swagger
 * /api/login:
 *   post:
 *     summary: Inicia sesión en el sistema y recibe un Token web
 *     tags: [Autenticación]
 *     security: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               usuario:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Devuelve status ok y un token Bearer.
 */
app.post('/api/login', upload.none(), async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) return res.json({ status: 'error', mensaje: 'Usuario y contraseña son requeridos' });
    
    const [rows] = await db.query('SELECT * FROM usuarios WHERE usuario = $1 LIMIT 1', [usuario]);
    if (rows.length > 0) {
      const match = await bcrypt.compare(password, rows[0].password);
      if (match) {
        const userPayload = { 
          user_id: rows[0].id, 
          rol: rows[0].rol, 
          usuario: rows[0].usuario,
          admin_id: rows[0].admin_id 
        };
        const token = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '24h' });
        
        return res.json({ 
          status: 'ok', 
          mensaje: 'Login exitoso', 
          usuario, 
          rol: rows[0].rol, 
          user_id: rows[0].id,
          token
        });
      }
    }
    res.json({ status: 'error', mensaje: 'Usuario o contraseña incorrectos' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', mensaje: 'Error del servidor' });
  }
});

/**
 * @swagger
 * /api/logout:
 *   get:
 *     summary: Endpoint obsoleto para logout. Retorna Ok.
 *     tags: [Autenticación]
 *     responses:
 *       200:
 *         description: Exitoso
 */
app.get('/api/logout', (req, res) => {
  res.json({ status: 'ok' }); // Con JWT no se necesita borrar nada en server
});

app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  authenticateToken(req, res, next);
});

/**
 * @swagger
 * /api/registrar:
 *   post:
 *     summary: Registra entrada o salida de un empleado.
 *     tags: [Asistencia]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               accion:
 *                 type: string
 *                 enum: [entrada, salida]
 *               fecha:
 *                 type: string
 *                 description: Fecha local del navegador en formato YYYY-MM-DD
 *               hora:
 *                 type: string
 *                 description: Hora local del navegador en formato HH:MM:SS
 *     responses:
 *       200:
 *         description: Hora de accion devuelta
 */
app.post('/api/registrar', upload.none(), async (req, res) => {
  const target_id = req.admin_id || req.user_id; // <-- The ID of the silo owner
  const nombre = (req.body.nombre || '').toLowerCase().trim();
  const accion = req.body.accion;
  let fecha = req.body.fecha;
  let hora = req.body.hora;
  
  if (!nombre) return res.json({ status: 'error', mensaje: 'Debe ingresar su nombre' });
  
  if (!/^[a-záéíóúñ\s]+$/.test(nombre)) {
     return res.json({ status: 'error', mensaje: 'El nombre solo puede contener letras y espacios' });
  }

  const now = new Date();
  const pad = (value) => value.toString().padStart(2, '0');
  const serverFecha = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const serverHora = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;
  const horaRegex = /^\d{2}:\d{2}:\d{2}$/;

  if (!fecha || !fechaRegex.test(fecha)) fecha = serverFecha;
  if (!hora || !horaRegex.test(hora)) hora = serverHora;

  try {
     if (accion === 'entrada') {
       const [rows] = await db.query(`SELECT id, fecha, hora FROM registros WHERE nombre = $1 AND hora_salida IS NULL AND usuario_id = $2 ORDER BY fecha DESC, hora DESC LIMIT 1`, [nombre, target_id]);
       
       if (rows.length > 0) {
         const dEntrada = new Date(rows[0].fecha instanceof Date ? rows[0].fecha.toISOString().split('T')[0] : rows[0].fecha);
         const dActual = new Date(fecha);
         const diffTime = dActual - dEntrada;
         const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
         
         let turnoActivo = false;
         if (diffDays === 0) {
           turnoActivo = true;
         } else if (diffDays === 1 && hora <= '02:00:00') {
           turnoActivo = true;
         }
         
         if (turnoActivo) {
           return res.json({ status: 'error', mensaje: 'Debes registrar tu SALIDA anterior antes de una nueva ENTRADA' });
         }
       }
       
       await db.query(`INSERT INTO registros (nombre, fecha, hora, usuario_id) VALUES ($1, $2, $3, $4)`, [nombre, fecha, hora, target_id]);
       res.json({ status: 'ok', mensaje: `Entrada registrada a las ${hora}` });

     } else if (accion === 'salida') {
       const [rows] = await db.query(`SELECT id, fecha, hora FROM registros WHERE nombre = $1 AND hora_salida IS NULL AND usuario_id = $2 ORDER BY fecha DESC, hora DESC LIMIT 1`, [nombre, target_id]);
       if (rows.length === 0) return res.json({ status: 'error', mensaje: 'No hay una ENTRADA activa para registrar SALIDA' });
       
       const registroAnterior = rows[0];
       const fechaEntrada = registroAnterior.fecha;
       const horaEntrada = registroAnterior.hora;
       
       const dEntrada = new Date(fechaEntrada instanceof Date ? fechaEntrada.toISOString().split('T')[0] : fechaEntrada);
       const dActual = new Date(fecha);
       const diffTime = dActual - dEntrada;
       const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
       
       let isExpired = false;
       if (diffDays === 0) {
           if (hora <= horaEntrada) return res.json({ status: 'error', mensaje: 'La hora de SALIDA debe ser posterior a la hora de ENTRADA' });
       } else if (diffDays === 1) {
           if (hora > '02:00:00') {
               isExpired = true;
           }
       } else {
           isExpired = true;
       }
       
       if (isExpired) {
           return res.json({ status: 'error', mensaje: 'Turno expirado (límite superó las 2:00 AM). Solicita al administrador registrar tus horas manuales.' });
       }
       
       let fEntradaStr = fechaEntrada instanceof Date ? fechaEntrada.toISOString().split('T')[0] : fechaEntrada;
       const totalMinutos = mins(fEntradaStr, horaEntrada, hora);
       const totalHoras = totalMinutos !== null ? totalMinutos / 60 : null;
       
       await db.query(`UPDATE registros SET hora_salida = $1, total_horas = $2 WHERE id = $3 AND usuario_id = $4`, [hora, totalHoras, registroAnterior.id, target_id]);
       res.json({ status: 'ok', mensaje: `Salida registrada a las ${hora}` });

     } else {
       res.json({ status: 'error', mensaje: 'Acción no válida' });
     }
  } catch (err) {
    res.json({ status: 'error', mensaje: 'Error del servidor' });
  }
});


/**
 * @swagger
 * /api/attendance_list:
 *   get:
 *     summary: Obtiene lista paginada y filtrada de asistencias
 *     tags: [Asistencia]
 *     parameters:
 *       - in: query
 *         name: desde
 *         schema:
 *           type: string
 *         description: YYYY-MM-DD
 *       - in: query
 *         name: hasta
 *         schema:
 *           type: string
 *         description: YYYY-MM-DD
 *       - in: query
 *         name: nombre
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Arreglo de asistencias devuelto
 */
app.get('/api/attendance_list', async (req, res) => {
  const target_id = req.admin_id || req.user_id;
  const { desde, hasta, nombre } = req.query;

  let sql = `SELECT id, nombre, fecha, hora, hora_salida, total_horas FROM registros WHERE usuario_id = $1`;
  let params = [target_id];
  let paramCount = 2;

  if (desde && /^\d{4}-\d{2}-\d{2}$/.test(desde)) { sql += ` AND fecha >= $${paramCount}`; params.push(desde); paramCount++; }
  if (hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta)) { sql += ` AND fecha <= $${paramCount}`; params.push(hasta); paramCount++; }
  if (nombre) { sql += ` AND nombre LIKE $${paramCount}`; params.push(`%${nombre}%`); paramCount++; }

  sql += ` ORDER BY fecha DESC, hora ASC`;

  try {
    const [rows] = await db.query(sql, params);
    const data = rows.map(r => {
      let m = null;
      if (r.total_horas !== null) m = Math.round(parseFloat(r.total_horas) * 60);
      else m = mins(r.fecha, r.hora, r.hora_salida);

      return {
        id: r.id,
        nombre: r.nombre,
        fecha: r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha,
        hora: r.hora,
        hora_salida: r.hora_salida,
        total_hhmm: m !== null ? hhmmFromMinutes(m) : '---'
      };
    });
    res.json({ data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: true, message: 'db-error' });
  }
});


/**
 * @swagger
 * /api/weekly_hours:
 *   get:
 *     summary: Horas semanales acumuladas
 *     tags: [Asistencia]
 *     parameters:
 *       - in: query
 *         name: semana
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Devuelve agrupaciones de horas de trabajo por semana
 */
app.get('/api/weekly_hours', async (req, res) => {
  const target_id = req.admin_id || req.user_id;
  const { nombre, semana } = req.query;
  const cond = [`usuario_id = $1`];
  const params = [target_id];
  let paramCount = 2;

  if (nombre) {
     cond.push(`nombre LIKE $${paramCount}`);
     params.push(`%${nombre}%`);
     paramCount++;
  }
  const where = cond.length > 0 ? `WHERE ` + cond.join(' AND ') : '';
  const sql = `SELECT * FROM registros ${where}`;

  function getISOYearWeek(dateInput) {
     let dateStr = dateInput instanceof Date ? dateInput.toISOString().split('T')[0] : dateInput;
     const d = new Date(dateStr);
     d.setHours(0, 0, 0, 0);
     d.setDate(d.getDate() + 4 - (d.getDay()||7));
     const yearStart = new Date(Date.UTC(d.getFullYear(),0,1));
     const weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
     return `${d.getFullYear()}${weekNo.toString().padStart(2, '0')}`;
  }

  try {
     const [rows] = await db.query(sql, params);
     
     let filtered = rows;
     if (semana && /^(\\d{4})-W(\\d{2})$/.test(semana)) {
        const match = semana.match(/^(\\d{4})-W(\\d{2})$/);
        const yw = `${match[1]}${match[2]}`;
        filtered = rows.filter(r => getISOYearWeek(r.fecha) === yw);
     }

     const grouped = {};
     filtered.forEach(r => {
        let f = r.fecha instanceof Date ? r.fecha.toISOString().split('T')[0] : r.fecha;
        r.fechaStr = f;
        const yw = getISOYearWeek(f);
        const key = `${r.nombre}_${yw}`;
        if (!grouped[key]) {
           grouped[key] = { nombre: r.nombre, yearWeek: yw, registros: [], fechas: new Set() };
        }
        grouped[key].registros.push(r);
        grouped[key].fechas.add(f);
     });

     const out = [];
     for (const key of Object.keys(grouped)) {
         const grupo = grouped[key];
         const diasConDatos = grupo.fechas.size;
         const year = parseInt(grupo.yearWeek.substring(0,4));
         const weekNum = parseInt(grupo.yearWeek.substring(4));

         function getISODateByWeek(y, w, dow) {
            let simple = new Date(Date.UTC(y, 0, 1 + (w - 1) * 7));
            let dowMod = simple.getUTCDay() || 7;
            const ISOweekStart = new Date(simple.getTime());
            ISOweekStart.setUTCDate(simple.getUTCDate() - dowMod + 1);
            ISOweekStart.setUTCDate(ISOweekStart.getUTCDate() + dow - 1);
            return ISOweekStart.toISOString().split('T')[0];
         }

         const lunesISO = getISODateByWeek(year, weekNum, 1);
         const domingoISO = getISODateByWeek(year, weekNum, 7);
         const lF = lunesISO.split('-').reverse().join('/');
         const dF = domingoISO.split('-').reverse().join('/');

         let totalMinutos = 0;
         const regS = grupo.registros.sort((a,b) => a.fechaStr.localeCompare(b.fechaStr) || a.hora.localeCompare(b.hora));
         
         for (const reg of regS) {
             let m = null;
             if (reg.total_horas !== null) m = Math.round(parseFloat(reg.total_horas) * 60);
             else m = mins(reg.fechaStr, reg.hora, reg.hora_salida);
             if (m !== null && m > 0) totalMinutos += m;
         }

         const horasDecimal = totalMinutos / 60;
         const datosSuficientes = diasConDatos >= 1;

         out.push({
           nombre: grupo.nombre,
           semana_iso: `Semana ${weekNum}`,
           fecha_inicio: lunesISO,
           fecha_fin: domingoISO,
           rango_formato: `Lunes ${lF} a Domingo ${dF}`,
           total_registros: diasConDatos,
           total_horas_decimal: datosSuficientes ? Number(horasDecimal.toFixed(2)) : null,
           total_minutos: datosSuficientes ? totalMinutos : null,
           datos_suficientes: datosSuficientes,
           mensaje: datosSuficientes ? null : 'Datos insuficientes para calcular semana completa'
        });
     }

     out.sort((a,b) => {
         const ywA = a.semana_iso;
         const ywB = b.semana_iso;
         if (ywA !== ywB) return ywB.localeCompare(ywA);
         return a.nombre.localeCompare(b.nombre);
     });

     res.json({ success: true, data: out, count: out.length });
  } catch(err) {
     console.error(err);
     res.status(500).json({ error: true, success: false, message: 'Error', data: [] });
  }
});

/**
 * @swagger
 * /api/empleados:
 *   get:
 *     summary: Obtiene los empleados registrados
 *     tags: [Empleados]
 *     responses:
 *       200:
 *         description: Lista de empleados
 *   post:
 *     summary: Agrega un Empleado
 *     tags: [Empleados]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *     responses:
 *       200:
 *         description: Retorna el empleado agregado
 */
app.get('/api/empleados', authenticateToken, async (req, res) => {
  const target_id = req.admin_id || req.user_id;
  try {
    const [rows] = await db.query(
      'SELECT * FROM empleados WHERE usuario_id = $1 ORDER BY nombre ASC',
      [target_id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching empleados' });
  }
});

app.post('/api/empleados', requireAdmin, upload.none(), async (req, res) => {
  const user_id = req.user_id;
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.json({ success: false, message: 'Nombre es requerido' });
    
    await db.query('INSERT INTO empleados (nombre, usuario_id) VALUES ($1, $2)', [nombre, user_id]);
    const [rows] = await db.query('SELECT * FROM empleados WHERE nombre = $1 AND usuario_id = $2 LIMIT 1', [nombre, user_id]);
    res.json({ success: true, data: rows[0], message: 'Empleado agregado' });
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('duplicate')) {
      return res.json({ success: false, message: 'El empleado ya existe para este usuario' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

/**
 * @swagger
 * /api/empleados/{id}:
 *   delete:
 *     summary: Elimina un empleado
 *     tags: [Empleados]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Success true
 */
app.delete('/api/empleados/:id', requireAdmin, async (req, res) => {
  const user_id = req.user_id;
  try {
    const id = req.params.id;
    await db.query('DELETE FROM empleados WHERE id = $1 AND usuario_id = $2', [id, user_id]);
    res.json({ success: true, message: 'Empleado eliminado' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
