# Modelo de datos

Base PostgreSQL (hosteada en Supabase). El esquema base vive en [`init/01_schema.sql`](../init/01_schema.sql); el resto de las tablas se crean en runtime la primera vez que arranca el servidor, con `CREATE TABLE IF NOT EXISTS` directo en [`app.js`](../app.js) — no hay un sistema de migraciones versionado, cada tabla nueva se agregó como un bloque de SQL idempotente.

## Diagrama entidad-relación

```mermaid
erDiagram
    Personas ||--o{ Productos : "tiene"
    Tipos_Producto ||--o{ Productos : "clasifica"
    Estados_Producto ||--o{ Productos : "clasifica"
    Productos ||--o| Cuentas_Bancarias : "1:1"
    Productos ||--o| Tarjetas_Credito : "1:1"
    Productos ||--o| Tarjetas_Debito : "1:1"
    Productos ||--o| Prestamos : "1:1"
    Productos ||--o| Reservas : "1:1"
    Cuentas_Bancarias ||--o| Tarjetas_Debito : "respalda"
    Prestamos ||--o{ Cuotas : "tiene"
    Productos ||--o{ Consumos_Tarjeta : "genera"
    Personas ||--o{ Dispositivos_Conocidos : "registra"
    Personas ||--o{ Notificaciones : "recibe"
    Personas ||--o{ Qr_Lecturas : "lee/emite"
    Personas ||--o{ Asistente_Uso : "consume"
    Personas }o--o{ Roles : "Roles_x_Personas"

    Personas {
        int id PK
        varchar nombre
        varchar apellido
        varchar dni UK
        varchar email UK
        varchar telefono
        date fecha_nac
        varchar direccion
        varchar password "hash bcrypt"
        boolean verificado
        varchar token_verificacion
        timestamptz token_expira
        int intentos_verificacion
    }
    Productos {
        int id_producto PK
        int id_persona FK
        int id_tipo_producto FK
        int id_estado_producto FK
        timestamp fecha_alta
    }
    Cuentas_Bancarias {
        int id_cuenta PK
        int id_producto FK "UNIQUE"
        varchar cbu UK
        varchar alias UK
        varchar moneda "ARS | USD"
        decimal saldo
    }
    Transacciones {
        int id PK
        varchar tx_id UK
        varchar cbu_origen
        varchar cbu_destino
        decimal importe
        varchar estado
        text motivo_rechazo
        int bank_code_origen
        int bank_code_destino
        jsonb persona_origen
        jsonb persona_destino
        text descripcion
        varchar tipo
        timestamptz created_at
    }
    Prestamos {
        int id_prestamo PK
        int id_producto FK "UNIQUE"
        decimal monto
        int plazo_meses
        decimal tna
        decimal cft
        decimal cuota_monto
        varchar estado
        timestamp fecha_alta
        timestamp fecha_cancelacion
    }
    Cuotas {
        int id_cuota PK
        int id_prestamo FK
        int numero_cuota
        decimal capital
        decimal interes
        decimal monto
        date fecha_vencimiento
        varchar estado
        timestamp fecha_pago
    }
    Reservas {
        int id_reserva PK
        int id_producto FK "UNIQUE"
        varchar tipo "FIJO_MESES | FIJO_DIAS | FRASCO"
        varchar nombre
        decimal saldo
        decimal tna
        int plazo_dias
        int plazo_meses
        timestamp fecha_alta
        date fecha_vencimiento
        date fecha_ultimo_interes
        varchar estado
        decimal interes_pagado
    }
    Tarjetas_Credito {
        int id_tarjeta PK
        int id_producto FK "UNIQUE"
        varchar numero_tarjeta UK
        varchar marca
        date fecha_vencimiento
        decimal limite_compra
        int dia_cierre
        varchar cvv
        varchar nombre_titular
        decimal deuda
        decimal saldo_financiado
        date fecha_ultimo_interes
    }
    Tarjetas_Debito {
        int id_tarjeta PK
        int id_producto FK "UNIQUE"
        int id_cuenta FK
        varchar numero_tarjeta UK
        varchar marca
        varchar nombre_titular
        date fecha_vencimiento
        varchar cvv
    }
    Consumos_Tarjeta {
        int id_movimiento PK
        int id_producto FK
        varchar tipo "COMPRA | PAGO | INTERES"
        varchar comercio
        decimal monto
        int cuotas
        decimal monto_cuota
        decimal total
        decimal tna
        timestamptz created_at
    }
    Dispositivos_Conocidos {
        int id PK
        int id_persona FK
        varchar device_id
        varchar descripcion
        timestamp primer_login
        timestamp ultimo_login
    }
    Notificaciones {
        int id_notificacion PK
        int id_persona FK
        varchar tipo
        varchar titulo
        text mensaje
        boolean leida
        timestamptz created_at
    }
    Qr_Lecturas {
        int id PK
        int id_persona FK
        varchar cbu
        varchar jti
        int banco_lector
        varchar nombre_lector
        timestamptz created_at
    }
    Asistente_Uso {
        int id_persona FK
        date fecha
        int cantidad
    }
    Tipos_Producto {
        int id_tipo_producto PK
        varchar nombre UK
    }
    Estados_Producto {
        int id_estado_producto PK
        varchar nombre UK
    }
    Roles {
        int id_rol PK
        varchar nombre_rol
        varchar descripcion
        boolean activo
    }
```

## Notas sobre el diseño

- **`Productos` es la tabla central**: cada producto bancario de una persona (caja de ahorro, tarjeta, préstamo, reserva) es primero una fila en `Productos` con un tipo (`Tipos_Producto`) y un estado (`Estados_Producto`), y recién después la tabla específica (`Cuentas_Bancarias`, `Tarjetas_Credito`, etc.) se cuelga de ese `id_producto` en una relación 1 a 1. Esto permite bloquear/cerrar cualquier producto cambiando solo `Estados_Producto`, sin tocar la tabla específica.
- **`Transacciones` es un historial unificado**, no una tabla por tipo de movimiento. Un mismo movimiento de dinero (transferencia, depósito, préstamo, tarjeta, cambio de divisa, reserva) cae ahí con un `tipo` distinto y, en los casos donde no hay una cuenta bancaria real de origen/destino, un **sentinel** en `cbu_origen`/`cbu_destino` (`'DEPOSITO'`, `'PRESTAMO'`, `'RESERVA'`, `'TARJETA'`). *A confirmar: estos sentinels no están documentados como constantes en un solo lugar — aparecen repetidos literal en cada controller.*
- **`Cuotas.capital`/`Cuotas.interes` se guardan por separado** (no solo el total) específicamente para poder calcular el capital pendiente real al momento de una cancelación anticipada de préstamo, sin cobrar intereses futuros no devengados.
- **El CVV de tarjetas se persiste** (`Tarjetas_Credito.cvv`, `Tarjetas_Debito.cvv`) pero el backend nunca lo devuelve salvo en la respuesta de alta (`POST /api/tarjetas/emitir`) — ver [seguridad.md](seguridad.md).
- No hay `ON DELETE CASCADE` en la mayoría de las foreign keys nuevas (sí en `Roles_x_Personas`), así que borrar una fila de `Personas` a mano requiere borrar antes, en orden, sus filas en `Productos` y todas las tablas hijas — no hay una ruta de la API que borre una persona.
