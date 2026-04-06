const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const multer = require('multer');
const upload = multer();
const db = require('./db');
const { pool } = require('./db');

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:4200', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'super_secret_key_asistencia',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

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

app.post('/api/login', upload.none(), async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) return res.json({ status: 'error', mensaje: 'Usuario y contraseña son requeridos' });

    if (req.session.usuario && req.session.usuario === usuario) {
      return res.json({ status: 'ok', mensaje: 'Sesión ya activa', usuario: req.session.usuario, rol: req.session.rol, user_id: req.session.user_id });
    }

    const [rows] = await db.query('SELECT * FROM usuarios WHERE usuario = ? LIMIT 1', [usuario]);
    if (rows.length > 0) {
      const hash = rows[0].password.replace(/^\$2y\$/, '$2a$');
      const match = await bcrypt.compare(password, hash);
      if (match) {
        req.session.usuario = usuario;
        req.session.rol = rows[0].rol;
        req.session.user_id = rows[0].id;
        return res.json({ status: 'ok', mensaje: 'Login exitoso', usuario, rol: rows[0].rol, user_id: rows[0].id });
      }
    }
    res.json({ status: 'error', mensaje: 'Usuario o contraseña incorrectos' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', mensaje: 'Error del servidor' });
  }
});

app.get('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ status: 'ok' });
});

app.post('/api/registrar', upload.none(), async (req, res) => {
  if (!req.session || !req.session.user_id) return res.json({ status: 'error', mensaje: 'Debes iniciar sesión para registrar asistencia' });
  const user_id = req.session.user_id;
  const nombre = (req.body.nombre || '').toLowerCase().trim();
  const accion = req.body.accion;
  if (!nombre) return res.json({ status: 'error', mensaje: 'Debe ingresar su nombre' });

  if (!/^[a-záéíóúñ\s]+$/.test(nombre)) {
    return res.json({ status: 'error', mensaje: 'El nombre solo puede contener letras y espacios' });
  }

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const fecha = now.toISOString().split('T')[0];
  const hora = now.toISOString().split('T')[1].split('.')[0];

  try {
    if (accion === 'entrada') {
      const [rows] = await db.query(`SELECT id FROM registros WHERE nombre = ? AND fecha = ? AND hora_salida IS NULL AND usuario_id = ?`, [nombre, fecha, user_id]);
      if (rows.length > 0) return res.json({ status: 'error', mensaje: 'Debes registrar tu SALIDA antes de una nueva ENTRADA' });

      await db.query(`INSERT INTO registros (nombre, fecha, hora, usuario_id) VALUES (?, ?, ?, ?)`, [nombre, fecha, hora, user_id]);
      res.json({ status: 'ok', mensaje: `Entrada registrada a las ${hora}` });
    } else if (accion === 'salida') {
      const [rows] = await db.query(`SELECT id, hora FROM registros WHERE nombre = ? AND fecha = ? AND hora_salida IS NULL AND usuario_id = ? ORDER BY hora DESC LIMIT 1`, [nombre, fecha, user_id]);
      if (rows.length === 0) return res.json({ status: 'error', mensaje: 'No hay una ENTRADA activa para registrar SALIDA' });

      const horaEntrada = rows[0].hora;
      if (hora <= horaEntrada) return res.json({ status: 'error', mensaje: 'La hora de SALIDA debe ser posterior a la hora de ENTRADA' });

      await db.query(`UPDATE registros SET hora_salida = ? WHERE id = ? AND usuario_id = ?`, [hora, rows[0].id, user_id]);
      res.json({ status: 'ok', mensaje: `Salida registrada a las ${hora}` });
    } else {
      res.json({ status: 'error', mensaje: 'Acción no válida' });
    }
  } catch (err) {
    res.json({ status: 'error', mensaje: 'Error del servidor' });
  }
});

app.get('/api/attendance_list', async (req, res) => {
  if (!req.session || !req.session.user_id) return res.json({ data: [] });
  const user_id = req.session.user_id;
  const { desde, hasta, nombre } = req.query;
  let sql = `SELECT id, nombre, fecha, hora, hora_salida, total_horas FROM registros WHERE usuario_id = ?`;
  const params = [user_id];

  if (desde && /^\d{4}-\d{2}-\d{2}$/.test(desde)) { sql += ` AND fecha >= ?`; params.push(desde); }
  if (hasta && /^\d{4}-\d{2}-\d{2}$/.test(hasta)) { sql += ` AND fecha <= ?`; params.push(hasta); }
  if (nombre) { sql += ` AND nombre LIKE ?`; params.push(`%${nombre}%`); }

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
        fecha: r.fecha,
        hora: r.hora,
        hora_salida: r.hora_salida,
        total_hhmm: m !== null ? hhmmFromMinutes(m) : '---'
      };
    });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: true, message: 'db-error' });
  }
});

app.get('/api/weekly_hours', async (req, res) => {
  if (!req.session || !req.session.user_id) return res.json({ success: true, data: [], count: 0 });
  const user_id = req.session.user_id;
  const { nombre, semana } = req.query;
  const cond = [`usuario_id = ?`];
  const params = [user_id];
  if (nombre) {
    cond.push(`nombre LIKE ?`);
    params.push(`%${nombre}%`);
  }
  const where = cond.length > 0 ? `WHERE ` + cond.join(' AND ') : '';
  const sql = `SELECT * FROM registros ${where}`;

  function getISOYearWeek(dateStr) {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(Date.UTC(d.getFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}${weekNo.toString().padStart(2, '0')}`;
  }

  try {
    const [rows] = await db.query(sql, params);

    let filtered = rows;
    if (semana && /^(\d{4})-W(\d{2})$/.test(semana)) {
      const match = semana.match(/^(\d{4})-W(\d{2})$/);
      const yw = `${match[1]}${match[2]}`;
      filtered = rows.filter(r => getISOYearWeek(r.fecha) === yw);
    }

    const grouped = {};
    filtered.forEach(r => {
      const yw = getISOYearWeek(r.fecha);
      const key = `${r.nombre}_${yw}`;
      if (!grouped[key]) {
        grouped[key] = { nombre: r.nombre, yearWeek: yw, registros: [], fechas: new Set() };
      }
      grouped[key].registros.push(r);
      grouped[key].fechas.add(r.fecha);
    });

    const out = [];
    for (const key of Object.keys(grouped)) {
      const grupo = grouped[key];
      const diasConDatos = grupo.fechas.size;
      const year = parseInt(grupo.yearWeek.substring(0, 4));
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
      const regS = grupo.registros.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));

      for (const reg of regS) {
        let m = null;
        if (reg.total_horas !== null) m = Math.round(parseFloat(reg.total_horas) * 60);
        else m = mins(reg.fecha, reg.hora, reg.hora_salida);
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

    out.sort((a, b) => {
      const ywA = a.semana_iso;
      const ywB = b.semana_iso;
      if (ywA !== ywB) return ywB.localeCompare(ywA);
      return a.nombre.localeCompare(b.nombre);
    });

    res.json({ success: true, data: out, count: out.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: true, success: false, message: 'Error', data: [] });
  }
});

app.get('/api/empleados', async (req, res) => {
  if (!req.session || !req.session.user_id) return res.json({ success: false, message: 'No autenticado', data: [] });
  const user_id = req.session.user_id;
  try {
    const [rows] = await db.query('SELECT * FROM empleados WHERE usuario_id = ? ORDER BY nombre ASC', [user_id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching empleados' });
  }
});

app.post('/api/empleados', upload.none(), async (req, res) => {
  if (!req.session || !req.session.user_id) return res.json({ success: false, message: 'No autenticado' });
  const user_id = req.session.user_id;
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.json({ success: false, message: 'Nombre es requerido' });

    await db.query('INSERT INTO empleados (nombre, usuario_id) VALUES (?, ?)', [nombre, user_id]);
    const [rows] = await db.query('SELECT * FROM empleados WHERE nombre = ? AND usuario_id = ? LIMIT 1', [nombre, user_id]);
    res.json({ success: true, data: rows[0], message: 'Empleado agregado' });
  } catch (err) {
    if (err.message.includes('UNIQUE') || err.message.includes('duplicate key')) {
      return res.json({ success: false, message: 'El empleado ya existe para este usuario' });
    }
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

app.delete('/api/empleados/:id', async (req, res) => {
  if (!req.session || !req.session.user_id) return res.json({ success: false, message: 'No autenticado' });
  const user_id = req.session.user_id;
  try {
    const id = req.params.id;
    await db.query('DELETE FROM empleados WHERE id = ? AND usuario_id = ?', [id, user_id]);
    res.json({ success: true, message: 'Empleado eliminado' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});