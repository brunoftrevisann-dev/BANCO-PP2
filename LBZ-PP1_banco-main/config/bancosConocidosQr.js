const { obtenerBankCode, obtenerKid, obtenerClavePublicaJwk } = require('../utils/qrJwt');

// Claves públicas de los bancos de la cátedra, intercambiadas a mano (qr-interbancario-jwt.md, sección 6).
// Para sumar uno: agregar una entrada  [bankCode]: { kid, nombre, publicKeyJwk }  acá abajo.
const bancosConocidos = {};

// Un problema con la clave propia no tiene que impedir que arranque el resto del banco.
try {
  bancosConocidos[obtenerBankCode()] = {
    kid: obtenerKid(),
    nombre: 'TUO-PRUEBA',
    publicKeyJwk: obtenerClavePublicaJwk()
  };
} catch (e) {
  console.error('QR interbancario: no se pudo cargar la clave propia, el QR firmado queda deshabilitado:', e.message);
}

module.exports = bancosConocidos;
