# Diferencias entre el Swagger y la DB

Este documento registra cada divergencia encontrada entre el contrato de la API
(definido en [`swagger.yaml`](swagger.yaml)) y el schema real de la DB en
Supabase. Para cada item: qué dice el spec, qué dice la DB, y cómo lo
resolvemos en el código.

> Mantener al día: cada vez que aparezca una nueva diferencia, agregar una
> entrada nueva con fecha al final.

---

## 1. Identificadores: `uuid` vs `integer`

- **Spec:** todos los `id` son `string` con `format: uuid`.
- **DB:** los PKs son `integer` (auto-increment en la mayoría, manual en otros).
- **Resolución:** los controllers convierten a string en el response
  (`String(cliente.identificador)`). Sin pérdida de funcionalidad, pero quien
  consuma la API recibirá `"1"`, `"42"`, etc., no UUIDs reales.

## 2. Auto-increment NO está en todas las tablas

- **Auto-increment (SERIAL):** `sectores`, `personas`, `clientes_acceso`,
  `subastas`, `catalogos`, `items_catalogo`, `productos`, `pujos`,
  `medios_pago`, etc.
- **NO auto-increment** (hay que proveer el id explícito):
  - `paises.numero` — tabla de referencia (usamos ISO 3166 numeric, ej. AR=32).
  - `empleados.identificador` — al crear el primer admin tuvimos que calcular
    `MAX(id)+1`.
  - `clientes.identificador` — es a la vez PK **y** FK a `personas`, así que
    siempre se pasa el mismo valor que `personas.identificador`.
  - `duenios.identificador` — idem clientes, FK a `personas`.
  - `subastadores.identificador` — idem.
  - Todas las tablas `*_extension` cuyo PK es el FK a la tabla principal.
- **Resolución:** `models/base.js` `create()` intenta primero sin id; si la DB
  devuelve `null value in column "identificador"`, recalcula `MAX(pk)+1` y
  reintenta. Para los casos donde el id debe coincidir con otro FK (clientes,
  duenios, etc.), el controller lo pasa explícito.

## 3. Nombre + apellido

- **Spec:** `UsuarioResumen.nombre` y `UsuarioResumen.apellido` por separado.
- **DB:** `personas.nombre VARCHAR(150)` único.
- **Resolución:** [`lib/usuario-shape.js`](lib/usuario-shape.js)
  - `joinNombre(nombre, apellido)` al escribir.
  - `splitNombre(full)` al leer — splitea por el primer espacio.
  - **Limitación:** apellidos compuestos sin partícula podrían leerse mal
    (ej. "Maria Lopez Perez" → nombre="Maria", apellido="Lopez Perez").

## 4. `personas.documento` tiene VARCHAR(20)

- **Spec:** no especifica longitud.
- **DB:** `VARCHAR(20)`.
- **Resolución:** en `/registro/etapa1` generamos placeholders del tipo
  `PENDING-<12 hex>` (exactamente 20 chars). El seed usa documentos
  cortos como `"99999999"`.

## 5. `personas.estado` tiene CHECK constraint `chk_estado`

- **Spec:** no expone el estado de `personas`.
- **DB:** `VARCHAR(15)` con CHECK que rechaza `"pendiente"`. Acepta `"activo"`.
  (No tenemos lista completa de valores válidos todavía.)
- **Resolución:** siempre insertamos con `estado: "activo"` en `personas`.
  Si necesitamos otros estados, hay que probar contra el CHECK o pedir el DDL
  del constraint.

## 6. `clientes.admitido` (2 chars) vs `usuario.estado` (enum spec)

- **Spec:** `UsuarioResumen.estado` enum
  `pendiente_aprobacion | aprobado | bloqueado_multa | bloqueado_judicial`.
- **DB:** `clientes.admitido VARCHAR(2)` con valores `'si'` o `'no'`. No hay
  columnas para bloqueos.
- **Resolución:**
  [`lib/usuario-shape.js::deriveEstado()`](lib/usuario-shape.js):
  - `admitido='no'` → `pendiente_aprobacion`
  - `admitido='si'` + sin multa activa → `aprobado`
  - `admitido='si'` + multa activa → `bloqueado_multa`
  - `bloqueado_judicial` **queda fuera de scope** (no hay tabla para ello).

## 7. Multas: sin FK directa cliente → multa

- **Spec:** `usuario.estado=bloqueado_multa`.
- **DB:** `multas.registro` apunta a `registro_de_subasta`, no a `clientes`.
  Hay que derivar via `registro_de_subasta.cliente` para saber si un cliente
  tiene multas.
- **Resolución:** [`lib/multas-helper.js::tieneMultaActiva()`](lib/multas-helper.js)
  hace JOIN manual: busca `registro_de_subasta.cliente=X` y cuenta
  `multas.estado='pendiente'` dentro de esos registros. Se usa en
  `buildLoginResponse` ([`controllers/auth.controller.js`](controllers/auth.controller.js))
  y en `GET /perfil` ([`controllers/perfil.controller.js`](controllers/perfil.controller.js)).

## 8. `subastas.estado`: CHECK solo permite `'abierta'` / `'cerrada'`

- **Spec:** `SubastaResumen.estado` enum
  `programada | en_vivo | finalizada`.
- **DB:** CHECK `chk_es` solo acepta `'abierta'` y `'cerrada'`.
- **Resolución:** [`lib/subasta-shape.js`](lib/subasta-shape.js):
  - `estadoApi(subasta)`: DB → API
    - `cerrada` → `finalizada`
    - `abierta` + `fecha === today` → `en_vivo`
    - `abierta` + `fecha > today` → `programada`
  - `estadoApiToDb(apiEstado)`: API → DB (para filtros `?estado=`)
    - `finalizada` → `cerrada`
    - `en_vivo` o `programada` → `abierta`
- **Limitación:** No podemos distinguir realmente `en_vivo` de `programada`
  porque `subastas.fecha` no puede ser `today` (ver siguiente diff). En `/sala`
  aceptamos cualquier subasta `abierta` como "en vivo".

## 9. `subastas.fecha`: CHECK `chk_fecha` exige fecha lejana

- **Spec:** no especifica restricción.
- **DB:** CHECK rechaza `today` y dates "demasiado cercanas". En las pruebas:
  - `2026-05-13` (mañana, contra system date 2026-05-12) → rechazado.
  - `2026-06-01` (+20 días) → aceptado.
  - Aplica también en UPDATE, no solo INSERT.
- **Resolución:** el seed usa `today + 30 días`. Para tests futuros de
  "finalizada", no hay forma vía API de marcar una subasta como pasada (la DB
  bloquea cambiar la fecha a `today`).

## 10. `subastas.titulo` no existe en la DB

- **Spec:** `SubastaResumen.titulo` (ej. `"Arte Moderno #47"`).
- **DB:** sin campo.
- **Resolución:** [`lib/subasta-shape.js::tituloSubasta()`](lib/subasta-shape.js):
  - Si `subastas_extension.es_coleccion='si'` → usa `nombre_coleccion`.
  - Si no → `"Subasta #{identificador}"`.

## 11. `subastas.fecha` (DATE) + `subastas.hora` (TIME) → un solo timestamp en la API

- **Spec:** `SubastaResumen.fecha` con `format: date-time` (timestamp único).
- **DB:** dos columnas separadas (`DATE` + `TIME WITHOUT TIME ZONE`).
- **Resolución:**
  [`lib/subasta-shape.js::fechaTimestamp()`](lib/subasta-shape.js) concatena
  con `new Date(`${fecha}T${hora}`).toISOString()`.

## 12. Fotos como `bytea` vs URLs en el Swagger

- **Spec:** `imagenPrincipal` y `imagenes` son `string` con `format: uri`. Para
  `dniFrente`/`dniDorso` el spec dice `format: binary` (multipart típico).
- **DB:** todas las fotos son `bytea` inline (`personas.foto`,
  `productos.fotos.foto`, `fotos_documento.foto_frente/foto_dorso`).
- **Resolución:**
  - En **input**: aceptamos base64 en JSON y convertimos a hex (`\x...`).
    Helper `base64ToBytea()` en controllers de registro y solicitudes-venta.
  - En **output piezas**: `imagenPrincipal` = `/v1/piezas/:itemId/fotos/0`;
    `imagenes` = array de URLs `/v1/piezas/:itemId/fotos/:n` (n = 0..count-1).
    El endpoint sirve los bytes con `Content-Type` detectado por magic bytes
    (JPEG/PNG/GIF/WebP). Handler en
    [`controllers/fotos.controller.js`](controllers/fotos.controller.js).
  - En **output solicitudes**: `imagenes` = array de URLs
    `/v1/solicitudes-venta/:id/fotos/:n`. Requiere auth + ownership.
  - `dniFrente`/`dniDorso` (fotos_documento) quedan fuera de scope del
    cliente — son para el flujo admin de verificación.

## 13. `cantidadMediosPago` del usuario

- **Spec:** propiedad de `UsuarioResumen`.
- **DB:** no es columna, hay que contar `medios_pago WHERE cliente = X`.
- **Resolución:** [`controllers/auth.controller.js::buildLoginResponse()`](controllers/auth.controller.js)
  hace un `count()` antes de armar la respuesta.

## 14. `categoria` del cliente: enum vs varchar libre

- **Spec:** `CategoriaUsuario` enum
  `comun | especial | plata | oro | platino`.
- **DB:** `clientes.categoria VARCHAR(10)` sin CHECK observado (acepta lo que
  pongamos). El seed y registro siempre crean con `'comun'`.
- **Resolución:** el código respeta el enum, pero la DB no lo enforce — si
  alguien hace un UPDATE manual a `'foo'`, la API lo va a devolver tal cual.

## 15. Sin "verificador" automático

- **Spec:** no menciona el verificador.
- **DB:** `clientes.verificador` (FK a `empleados`) es **NOT NULL**.
- **Resolución:** `/registro/etapa1` toma el id del empleado admin desde
  `process.env.ADMIN_EMPLEADO_ID`. El seed lo crea y avisa qué valor poner en
  el `.env`.

## 16. `pujos` (sic, sin "a") y `pujos_extension`

- **Spec:** habla de "pujas" (con A).
- **DB:** la tabla se llama `pujos` y la extension `pujos_extension`.
- **Resolución:** los nombres de URL y campos del API siguen el spec
  (`/pujas`, `PujaResponse`), pero los models internos respetan el nombre real
  de la tabla (`models/pujos.js`).

## 17. `pujos_extension.timestamp` vive aparte

- **Spec:** `PujaResumen.timestamp` es un campo plano.
- **DB:** `pujos` no tiene timestamp; está en `pujos_extension.timestamp`.
- **Resolución:** cuando creamos una puja insertamos ambos rows (uno en
  `pujos`, otro en `pujos_extension`) y al leerlas hacemos JOIN manual.

## 18. RLS está activo

- **Spec:** no aplica (es config de Supabase).
- **DB:** Row Level Security activado, la `anon` key no puede escribir.
- **Resolución:** el backend usa la `service_role` key
  ([`supabase-client.js`](supabase-client.js)). **Nunca exponer al cliente.**

## 19. `medios_pago.tipo` — CHECK matches spec ✓

- **Spec:** enum `cuenta_nacional | cuenta_exterior | tarjeta_credito | cheque_certificado`.
- **DB:** CHECK `chk_tipo_medio` acepta exactamente esos cuatro valores.
- **Resolución:** ninguna, alineado al spec.

## 20. `medios_pago.verificado` es `varchar(2)` 'si'/'no', no boolean

- **Spec:** `MedioPago.verificado: boolean`.
- **DB:** `VARCHAR(2)` con CHECK `chk_verificado` que solo acepta `'si'` o
  `'no'` (case-sensitive, lowercase).
- **Resolución:**
  [`lib/medio-pago-shape.js::medioPagoShape()`](lib/medio-pago-shape.js)
  mapea `verificado === 'si'` → `true`. Al insertar siempre usamos `'no'`
  (los medios nacen sin verificar).

## 21. `medios_pago.moneda` es `varchar(3)` sin CHECK

- **Spec:** enum `ARS | USD` en `MedioPago`, `USD | EUR | GBP` en
  `CrearCuentaExteriorRequest`, `ARS | USD` en `CrearChequeRequest`.
- **DB:** `VARCHAR(3)` **sin CHECK**. Acepta cualquier código de 3 chars.
- **Resolución:** la validación de moneda se hace en el controller según el
  endpoint (`agregarCuentaExterior` exige `USD/EUR/GBP`, `agregarCheque`
  exige `ARS/USD`). DB no enforce nada.

## 22. `medios_pago.tipo_cuenta` — CHECK matches spec ✓

- **Spec:** enum `caja_ahorro | cuenta_corriente`.
- **DB:** CHECK `chk_tipo_cuenta` acepta exactamente esos dos valores.
- **Resolución:** ninguna, alineado al spec.

## 23. Tarjeta: número completo y CVV no se persisten; `vencimiento` sí

- **Spec:** `CrearTarjetaRequest` exige `numero`, `codigoSeguridad`,
  `vencimiento`. Pero `MedioPago` solo expone `ultimosDigitos`.
- **DB:** no hay columnas para `numero` completo ni `CVV` (correcto por PCI).
  Se agregó columna `medios_pago.vencimiento VARCHAR(7)` (modificable).
- **Resolución:** validamos Luhn + vencimiento en el controller; guardamos
  `ultimos_digitos` (slice -4) y `vencimiento` (formato "MM/YY"). CVV nunca
  se persiste. El campo `vencimiento` se devuelve en `MedioPago`.

## 24. `medios_pago.cliente` y ownership

- **Spec:** "mis medios de pago" implícito por el JWT.
- **DB:** `medios_pago.cliente` (FK a clientes, NOT NULL). No hay RLS por
  cliente (RLS está deshabilitado a nivel de policy específico — se trabaja
  desde el backend con service_role).
- **Resolución:** los handlers filtran por `cliente: req.user.sub` en toda
  query y verifican ownership en `findOwn()` antes de devolver detalle o
  borrar.

## 25. `solicitudes_venta.estado` — CHECK matches spec ✓

- **Spec:** enum `borrador | enviada | en_revision | aceptada | rechazada | en_subasta | vendida | no_vendida`.
- **DB:** CHECK `chk_estado_solicitud` acepta exactamente esos 8 valores.
- **Resolución:** ninguna, alineado al spec.

## 26. `solicitudes_venta.tipo` — CHECK matches spec ✓

- **Spec:** enum `arte | antiguedad | joya | vehiculo | mueble | otro`.
- **DB:** CHECK `chk_tipo_solicitud` con exactamente esos valores.
- **Resolución:** ninguna.

## 27. `solicitudes_venta.declaracion_propiedad` es `varchar(2)` 'si'/'no'

- **Spec:** `declaracionPropiedad: boolean`.
- **DB:** `VARCHAR(2)` (sin CHECK observable, pero solo aceptamos 'si'/'no'
  por convención del resto del schema).
- **Resolución:**
  [`lib/solicitud-venta-shape.js`](lib/solicitud-venta-shape.js)
  mapea boolean ↔ 'si'/'no'. La validación de "declaró sí" se hace en el
  controller (`declaracionPropiedad !== true` ⇒ 400).

## 28. `solicitudes_venta.cuenta_cobro_tipo` — CHECK ✓

- **Spec:** `CuentaCobroRequest.tipo` enum `nacional | exterior`.
- **DB:** CHECK `chk_cuenta_tipo` con esos dos valores.
- **Resolución:** ninguna.

## 29. Fotos de solicitud: misma situación que registro/etapa1

- **Spec:** `imagenes: array<binary>`, mínimo 6.
- **DB:** tabla aparte `fotos_solicitud_venta(solicitud, foto bytea)`.
- **Resolución:** aceptamos array de base64 en JSON. Se valida `length >= 6`
  en el controller y se insertan una por una con
  `base64ToBytea()` (`\x` hex). Las imágenes en el response están vacías por
  ahora — falta endpoint para servirlas.

## 30. `seguros.nro_poliza` es PK (varchar), no auto-increment

- **Spec:** `PolizaSeguro.id` con `format: uuid` y `numeroPoliza` separado.
- **DB:** `seguros.nro_poliza VARCHAR PRIMARY KEY` (no hay `id`).
- **Resolución:**
  [`lib/solicitud-venta-shape.js::polizaShape()`](lib/solicitud-venta-shape.js)
  devuelve `id = numeroPoliza`. El admin (cuando exista el flujo) tiene que
  asignar a mano el `nro_poliza` al crear el seguro.

## 31. Datos de contacto de la aseguradora: en `seguros_extension`

- **Spec:** `ContactoAseguradora` tiene `telefono`, `email`, `web`, además del
  `numeroPoliza` y `nombre` (de `seguros.compania`).
- **DB:** `seguros` tiene `compania, importe, poliza_combinada`. Los datos de
  contacto están en `seguros_extension(nro_poliza, telefono, email, web)`.
- **Resolución:** los endpoints `/poliza` y `/contactar-aseguradora` hacen
  JOIN manual con `seguros_extension`.

## 32. Solicitud sin `producto`/`artista` al crear

- **Spec:** `CrearSolicitudVentaRequest` acepta `nombreArtista`, `fechaObra`,
  `historia` (especialmente para `tipo=arte`).
- **DB:** `solicitudes_venta.historia` existe (text); pero `nombre_artista` y
  `fecha_obra` están en `artistas_piezas`, que requiere un `producto`. Como
  el producto se crea recién cuando un empleado acepta la solicitud, esos
  datos no tienen dónde guardarse en `solicitudes_venta`.
- **Resolución:** se agregaron las columnas `nombre_artista VARCHAR(200)` y
  `fecha_obra VARCHAR(50)` a `solicitudes_venta` (tabla modificable).
  Se persisten en `POST /solicitudes-venta` y se devuelven como campos
  separados `nombreArtista` / `fechaObra` en el shape. Cuando el flujo admin
  cree el producto, puede leer esas columnas y poblar `artistas_piezas`.

## 33. `cuentaCobro` request vs columnas de solicitudes_venta

- **Spec:** `CuentaCobroRequest` tiene un objeto anidado con
  `tipo / cbu / banco / titular / swift / iban / pais / moneda`.
- **DB:** se flattenea en `solicitudes_venta`. Se agregaron columnas
  `cuenta_cobro_banco VARCHAR(150)` y `cuenta_cobro_titular VARCHAR(150)`
  (tabla modificable) para completar el set.
- **Resolución:** todos los campos del spec se persisten y se devuelven como
  objeto estructurado `{ tipo, banco, titular, cbu? / swift, iban, pais, moneda? }`
  en `cuentaCobro` dentro de `SolicitudVentaDetalle`.

## 34. Compra = `registro_de_subasta` (no hay tabla "compras")

- **Spec:** `CompraDetalle` con `id`, `piezaId`, `medioPagoId`, `metodoEntrega`,
  `direccionEnvio`, `estado`, etc.
- **DB:** la compra es un row de `registro_de_subasta` (subasta, duenio,
  producto, cliente, importe, comision) + `registro_subasta_extension`
  (metodo_entrega, direccion_envio, costo_envio, estado_pago).
- **Resolución:** `/compras/:id` mapea desde ambas tablas. `medioPagoId`
  se persiste en `registro_subasta_extension.medio_pago` (columna agregada
  via `ALTER TABLE`). Se guarda en `POST /compras/:id/pagar` y se devuelve
  en el shape de la compra.

## 35. Estados de la compra: `estado_pago` vs spec enum

- **Spec:** `CompraDetalle.estado` enum `pendiente_pago | pagada | fondos_insuficientes`.
- **DB:** `registro_subasta_extension.estado_pago VARCHAR`. Sin
  registro_subasta_extension creado, lo derivamos como `pendiente_pago`.
- **Resolución:** controller mapea según `ext.estado_pago`. Cuando no hay
  extension row → `pendiente_pago`. Valores que usamos: `pagada`,
  `fondos_insuficientes`. (No probamos CHECK constraint — si lo hay,
  habrá que ajustar.)

## 36. Fondos insuficientes: lógica de negocio inventada para TP

- **Spec:** define el error 402 `COMPRA_FONDOS_INSUFICIENTES` con creación
  de multa del 10% pero no detalla en qué casos dispara.
- **DB:** no hay forma de simular "fondos reales" de una cuenta — solo el
  `monto_cheque` para cheques certificados.
- **Resolución:** en el controller solo declaramos fondos insuficientes si
  el medio elegido es `cheque_certificado` Y su `monto_cheque <
  importe + comision`. Para los otros tipos, asumimos OK. En producción
  habría que integrar con pasarela de pago.

## 37. `multas` sin FK a cliente directo

- **Spec:** `Multa.compraId`. La lista "mis multas" está implícita por JWT.
- **DB:** `multas.registro` → `registro_de_subasta.cliente`.
- **Resolución:**
  [`controllers/multas.controller.js`](controllers/multas.controller.js)
  hace JOIN manual: primero busca todos los `registro_de_subasta.cliente=user`,
  después filtra `multas` por `registro IN (...)`. Costoso en N requests
  pero sirve para el TP.

## 38. Multa: plazo vencido se evalúa en runtime

- **Spec:** estado `derivada_justicia` cuando pasaron las 72hs.
- **DB:** estado es un campo libre, no hay trigger que mueva pendientes a
  derivadas al pasar el plazo.
- **Resolución:** cada vez que se intenta `POST /multas/:id/pagar`, si la
  multa está pendiente y `fecha_limite < now`, el handler hace `UPDATE`
  + responde 410 `MULTA_PLAZO_VENCIDO`. **Limitación:** una multa vencida
  no se mueve a `derivada_justicia` hasta que el cliente intente pagarla.

## 39. Notificaciones: `leida` y `tiene_mensajes` son `varchar(2)` 'si'/'no'

- **Spec:** `Notificacion.leida: boolean`, `tieneMensajes: boolean`.
- **DB:** ambos `VARCHAR` 'si'/'no'.
- **Resolución:** mapeo en
  [`controllers/notificaciones.controller.js`](controllers/notificaciones.controller.js).
  Al abrir una notificación (`GET /:id`) se hace `UPDATE leida='si'`
  automáticamente. Al enviar un mensaje, marcamos `tiene_mensajes='si'`.

## 40. `mensajes.emisor` — CHECK matches spec ✓

- **Spec:** enum `sistema | usuario`.
- **DB:** `mensajes.emisor VARCHAR` aceptó `'usuario'` sin error (no probamos
  exhaustivamente, pero el spec coincide).
- **Resolución:** los mensajes que crea el endpoint POST siempre tienen
  `emisor='usuario'`. Los de `sistema` los inserta el backend en otros flujos
  (cuando se mande p.ej. una notif de puja superada).

## 41. Notificaciones automáticas

- **Spec:** las notificaciones de tipo `aprobacion_registro`,
  `resultado_subasta`, `puja_superada`, etc. son generadas por el sistema.
- **DB:** `chk_tipo_noti` acepta exactamente:
  `aprobacion_registro | resultado_subasta | puja_superada | solicitud_venta | multa | pago | general`.
  Campos NOT NULL: `cliente`, `titulo`, `mensaje`, `tipo`, `leida`, `tiene_mensajes`, `fecha`.
- **Resolución:**
  [`lib/notificaciones-helper.js`](lib/notificaciones-helper.js) expone
  `crearNotificacion(clienteId, { tipo, titulo, mensaje, accionUrl })`.
  Implementado en los siguientes flujos:
  - `puja_superada` → [`controllers/subastas.controller.js::realizarPuja`](controllers/subastas.controller.js)
    (notifica al postor cuya oferta fue superada)
  - `multa` → [`controllers/compras.controller.js::pagar`](controllers/compras.controller.js)
    (al crear multa por fondos insuficientes)
  - `pago` → [`controllers/compras.controller.js::pagar`](controllers/compras.controller.js)
    (al confirmar el pago de una compra)
  - `multa` → [`controllers/multas.controller.js::pagar`](controllers/multas.controller.js)
    (al pagar multa exitosamente y al derivarla a la justicia)
  - `solicitud_venta` → [`controllers/solicitudes-venta.controller.js::aceptarCondiciones`](controllers/solicitudes-venta.controller.js)
    (al aceptar condiciones de venta)
- **Pendiente (requiere flujo admin):**
  - `aprobacion_registro` — cuando el admin aprueba el registro (cambia `clientes.admitido` a `'si'`)
  - `resultado_subasta` — cuando una subasta cierra y se asignan ganadores

## 45. `cantidadPiezas` en subastas: no es columna, se computa

- **Spec:** `SubastaResumen.cantidadPiezas` — entero.
- **DB:** no hay columna, hay que recorrer `catalogos → items_catalogo`.
- **Resolución:** [`lib/subastas-helper.js::cantidadPiezasDeSubasta()`](lib/subastas-helper.js)
  hace el JOIN. Lo usa `subastas.controller.js` (en listar/detalle) y
  `solicitudes-venta.controller.js::buildSubastaAsignada()`. Antes esta última
  hardcodeaba `0`; ahora usa el helper compartido.

## 42. Historial: "Participación" = `asistentes`, no tabla aparte

- **Spec:** `Participacion` con `id`, `subastaId`, `cantidadPujas`, `gano`,
  `montoMaximoPujado`.
- **DB:** se infiere agrupando: una fila `asistentes` por (cliente, subasta).
- **Resolución:** `id` de la API = `asistentes.identificador`. Los cálculos
  (cantidadPujas, montoMaximo, gano) se computan en runtime con queries a
  `pujos`. Costoso para usuarios con mucho historial; un día convendría una
  vista materializada o columnas calculadas.

## 43. `HistorialPuja.numero` es el id, no un orden

- **Spec:** `numero` es un integer (sin más definición).
- **DB:** no hay un "número de orden" explícito; usamos `pujos.identificador`
  como número. Como las pujas se crean monotónicamente, sirve como orden.

## 44. Métricas: cálculos en runtime

- **Spec:** `Metricas` con totales, porcentajes y participaciones por
  categoría.
- **DB:** sin agregados pre-calculados — todo se computa en
  `GET /historial/metricas`.
- **Resolución:** múltiples queries por request. Para producción habría que
  cachear o usar una vista materializada por usuario.

---

## Pendientes de chequear cuando se haga el flujo admin

- [ ] `productos.disponible`, `productos_extension.es_obra_de_arte`,
  `subastas_extension.es_coleccion`, `seguros_extension.*` — ¿qué valores
  aceptan?
- [ ] `items_catalogo_estado.estado` — confirmamos que acepta `'en_subasta'`
  y `'pendiente'`, pero no probamos `'vendida'`.
- [ ] `registro_subasta_extension.estado_pago` — ¿enum?
- [ ] `multas.estado` — ¿enum?
- [ ] `notificaciones.tipo` — ¿CHECK estricto?
- [ ] Sequence sync — si llegamos a tener problemas con duplicate keys porque
  las tablas con SERIAL tienen filas insertadas a mano fuera del seq.
- [x] **Generación automática de notificaciones** — implementado para
  `puja_superada`, `multa` (creada/pagada/derivada), `pago` confirmado,
  `solicitud_venta` aceptada. Pendiente: `aprobacion_registro` y
  `resultado_subasta` (requieren flujo admin).
