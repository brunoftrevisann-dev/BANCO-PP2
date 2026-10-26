// Suma el importe (negativo para debitar) en SQL, sin errores de punto flotante de JS, y devuelve el saldo guardado.
// Si antes se chequeó que alcanzara el saldo, la fila ya tiene que estar bloqueada con FOR UPDATE.
async function moverSaldo(client, idCuenta, importe) {
  const { rows } = await client.query(
    'UPDATE Cuentas_Bancarias SET saldo = saldo + $1 WHERE id_cuenta = $2 RETURNING saldo',
    [importe, idCuenta]
  );
  return Number(rows[0].saldo);
}

module.exports = moverSaldo;
