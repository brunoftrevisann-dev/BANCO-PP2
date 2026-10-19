// Suma un importe al saldo de una cuenta (negativo para debitar) y devuelve el saldo que quedó.
// La cuenta la hace Postgres sobre la columna DECIMAL(15,2) (igual que las acreditaciones que ya
// usaban "saldo = saldo + $1" directo en SQL), así no se arrastran errores de punto flotante de JS (0.1 + 0.2 = 0.30000000000000004)
// y el saldo que se devuelve al frontend es exactamente el que quedó guardado. El llamador ya
// debe tener la fila bloqueada con FOR UPDATE si antes chequeó que alcanzara el saldo.
async function moverSaldo(client, idCuenta, importe) {
  const { rows } = await client.query(
    'UPDATE Cuentas_Bancarias SET saldo = saldo + $1 WHERE id_cuenta = $2 RETURNING saldo',
    [importe, idCuenta]
  );
  return Number(rows[0].saldo);
}

module.exports = moverSaldo;
