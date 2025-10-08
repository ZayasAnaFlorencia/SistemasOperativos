import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Rol, Usuario, SistemaLogin, Permisos } from './domain.js';
import { requireAuth, requirePermisos } from './authz.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    secret: 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }
  })
);

// In-memory store for demo
const sistema = new SistemaLogin();

function exposeUser(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}
app.use(exposeUser);

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { nombre, clave } = req.body;
  const usuario = await sistema.autenticar(nombre, clave, bcrypt);
  if (!usuario) return res.status(401).render('login', { error: 'Credenciales inválidas' });
  req.session.user = {
    nombreUsuario: usuario.getNombreUsuario(),
    rol: usuario.getRol().nombre,
    permisos: Array.from(usuario.getRol().permisos)
  };
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard');
});

// Protected sample routes
app.get('/lectura', requireAuth, requirePermisos(Permisos.LECTURA), (req, res) => {
  res.render('feature', { title: 'Lectura', body: 'Acceso a reportes en modo lectura.' });
});

app.get('/edicion', requireAuth, requirePermisos(Permisos.EDICION), (req, res) => {
  res.render('feature', { title: 'Edición', body: 'Acceso para editar registros.' });
});

app.get('/aprobacion', requireAuth, requirePermisos(Permisos.APROBACION), (req, res) => {
  res.render('feature', { title: 'Aprobación', body: 'Acceso para aprobar solicitudes.' });
});

app.get('/decision', requireAuth, requirePermisos(Permisos.DECISION), (req, res) => {
  res.render('feature', { title: 'Decisión', body: 'Acceso a decisiones estratégicas.' });
});

app.get('/control', requireAuth, requirePermisos(Permisos.CONTROL), (req, res) => {
  res.render('feature', { title: 'Control', body: 'Acceso a controles y auditorías.' });
});

app.get('/admin', requireAuth, requirePermisos(Permisos.GESTION_TOTAL), (req, res) => {
  res.render('feature', { title: 'Administración del Sistema', body: 'Acceso total a la gestión del sistema.' });
});

// 403 view route fallback
app.use((req, res, next) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RBAC app escuchando en http://localhost:${PORT}`));

// Seed users and roles on startup for demo
async function seed() {
  const rolPersonal = new Rol('Personal', [Permisos.LECTURA]);
  const rolJefe = new Rol('Jefe de Área', [Permisos.LECTURA, Permisos.EDICION]);
  const rolGerente = new Rol('Gerente', [Permisos.LECTURA, Permisos.EDICION, Permisos.APROBACION]);
  const rolDirector = new Rol('Director', [Permisos.LECTURA, Permisos.EDICION, Permisos.APROBACION, Permisos.DECISION]);
  const rolSupervisor = new Rol('Supervisor', [Permisos.LECTURA, Permisos.CONTROL]);
  const rolAdmin = new Rol('Administrador del Sistema', [Permisos.GESTION_TOTAL]);

  const usuarios = [
    { nombre: 'juan', clave: '1234', rol: rolPersonal },
    { nombre: 'ana', clave: 'claveSegura', rol: rolAdmin },
    { nombre: 'carlos', clave: 'gerente123', rol: rolGerente },
  ];

  for (const u of usuarios) {
    const hash = await bcrypt.hash(u.clave, 10);
    sistema.registrarUsuario(new Usuario(u.nombre, hash, u.rol));
  }
}
seed();
