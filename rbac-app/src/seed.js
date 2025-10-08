import bcrypt from 'bcryptjs';
import { Rol, Usuario, SistemaLogin, Permisos } from './domain.js';

// Example seed usable for tests or custom startups
export async function createSeedSistema() {
  const sistema = new SistemaLogin();
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
  return sistema;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  createSeedSistema().then(() => {
    console.log('Sistema seed generado en memoria');
  });
}
