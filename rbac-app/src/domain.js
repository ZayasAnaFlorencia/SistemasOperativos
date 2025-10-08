export class Rol {
  constructor(nombre, permisos = []) {
    this.nombre = nombre;
    this.permisos = new Set(permisos);
  }
  tienePermiso(accion) {
    return this.permisos.has(accion);
  }
}

export class Usuario {
  #nombreUsuario;
  #claveHash;
  #rol;
  constructor(nombreUsuario, claveHash, rol) {
    this.#nombreUsuario = nombreUsuario;
    this.#claveHash = claveHash;
    this.#rol = rol;
  }
  getNombreUsuario() { return this.#nombreUsuario; }
  getRol() { return this.#rol; }
  async validarClave(entradaClave, bcrypt) {
    return await bcrypt.compare(entradaClave, this.#claveHash);
  }
}

export class SistemaLogin {
  #usuarios;
  constructor() {
    this.#usuarios = new Map();
  }
  registrarUsuario(usuario) {
    this.#usuarios.set(usuario.getNombreUsuario(), usuario);
  }
  async autenticar(nombre, clave, bcrypt) {
    const usuario = this.#usuarios.get(nombre);
    if (!usuario) return null;
    const ok = await usuario.validarClave(clave, bcrypt);
    return ok ? usuario : null;
  }
  autorizar(usuario) {
    if (!usuario) return [];
    return [...usuario.getRol().permisos];
  }
}

export const Permisos = {
  LECTURA: 'LECTURA',
  EDICION: 'EDICIÓN',
  APROBACION: 'APROBACIÓN',
  DECISION: 'DECISIÓN',
  CONTROL: 'CONTROL',
  GESTION_TOTAL: 'GESTIÓN_TOTAL'
};
