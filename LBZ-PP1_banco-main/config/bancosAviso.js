// bankCode -> { nombre, avisoUrl } de los bancos de la cátedra que ya implementaron el
// "aviso de lectura" del QR interbancario (ver prompt-aviso-lectura-qr.md). A diferencia
// de bancosConocidosQr.js, esta tabla NO necesita la clave pública de nadie: el aviso no
// mueve plata ni verifica quién lo mandó, solo muestra un mensaje tipo "Fulano escaneó tu QR".
// Se completa a mano: cuando un banco te pase su bankCode + avisoUrl, agregalo acá, y
// pasale el tuyo (ver BANK_CODE en .env) + tu propio /api/qr/aviso-lectura.
module.exports = {
  3: { nombre: 'Monix', avisoUrl: 'https://jrsismsrdqvhwmegfslz.supabase.co/functions/v1/qr-lectura' }
};
