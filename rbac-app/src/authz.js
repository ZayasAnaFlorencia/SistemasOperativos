import { Permisos } from './domain.js';

export function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

export function requirePermisos(...acciones) {
  return (req, res, next) => {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    const permisos = new Set(user.permisos || []);
    const permitido = acciones.every(a => permisos.has(a) || permisos.has(Permisos.GESTION_TOTAL));
    if (!permitido) return res.status(403).render('403', { user });
    next();
  };
}
