# ARQUITECTURA — Maderable ERP

> **Fuente de verdad** del estado, el modelo objetivo y el roadmap de integración.
> Reemplaza a los `LOTE*_REPORT.md` (históricos, desactualizados).
> Las reglas operativas (Git, SQL, runtime, convenciones) viven en `CLAUDE.md`.
>
> Estado del documento: **borrador para validar con JP**. Las decisiones marcadas
> `[PROPUESTO]` necesitan tu OK antes de tratarse como cerradas.
> Última revisión: jun-2026.

---

## 1. Visión

Maderable nació como **piezas separadas** que JP fue construyendo (fichaje de
operarios, costos, despachos, herramientas, jornales, cortes). Hoy el objetivo es
**integrarlas y homogeneizarlas** en un sistema único, serio y mantenible.

Este documento define **el estado final al que todas las partes convergen**, para
no quedar estancados en el punto más peligroso: la mitad de la integración, donde
conviven dos formas de hacer cada cosa.

**Norte:** un pipeline de producción único, un modelo de datos canónico, un modelo
de auth común, y una capa de dominio testeable donde las partes se absorben.

---

## 2. El ecosistema (inventario de partes)

| Parte | Qué hace | Hoy | Base de datos | Destino | Estado |
|-------|----------|-----|---------------|---------|--------|
| **Core maderable** | proyectos, tiempos, costos, materiales, facturación, reportería | repo `maderable-produccion` | MBLE-INT (service key) | **centro de convergencia** | producción |
| **ctrl-despachos** | despacho del mueble | repo aparte | proyecto Supabase `CTRL DESPACHOS` | integrar como etapa final del pipeline | **integración EN CURSO** (otra sesión) |
| **herramientas** | operario marca retiro/devolución | repo aparte (login + lista propios) | tablas en MBLE-INT (anon directo) | **absorber dentro del login del operario** (más adelante) | activo |
| **jornales** | pago por jornal (tarifas taller/obra, monto por proyecto) | **proyecto BIG SUR** (repo no en esta máquina) | tablas `jornales_*` **mal ubicadas** en MBLE-INT (anon directo) | **FUERA de alcance** — relocalizar a base BIG Sur algún día | vivo (últ. 2026-06-19) |
| **cortes** | manejar la máquina de corte/CNC | repo aparte | esquema `corte.*` en MBLE-INT | integrar en paralelo (acople flojo) | prototipo |
| **BIG Sur (gastos)** | — | repo aparte | proyecto `BIG-SUR-GASTOS` | **FUERA de alcance** | aparte |

---

## 3. Modelo objetivo

### 3.1 Pipeline de producción
La columna vertebral: un proyecto/mueble que avanza por etapas hasta despacho.

```
recepción → materiales → [centros: corte/CNC, armado, lustre, …] → ARMADO → DESPACHO
                                  ▲
                            cortes (máquina) — acople flojo, en paralelo
```

`ctrl-despachos` no es una app suelta: es **la última etapa** de este flujo. Integrarlo
significa que el estado "despachado" sea parte del ciclo de vida del mueble en el core.

### 3.2 Modelo de datos canónico  `[PROPUESTO]`
Unificar las divergencias heredadas de construir por partes:

| Hoy (duplicado) | Canónico |
|-----------------|----------|
| `proyectos_cache` | `proyectos` |
| `cliente` / `cliente_nombre` | `cliente` (una sola forma) |
| `items` / `muebles` | `muebles` (item local `mf_n` dentro del proyecto) |

Entidades núcleo: **Proyecto** → **Mueble** (`mf_n`) → registros de trabajo / costos /
materiales / despacho. Una definición de cada una en `lib/models`.

### 3.3 Modelo de auth / acceso común  `[PROPUESTO]`
Hoy conviven dos posturas: el core va por backend con **service role key** (RLS no lo
afecta); las apps vecinas (herramientas, jornales) pegan con el **anon key directo** y
policies abiertas (`anon_all_*`). Destino:

- Todo acceso a datos pasa por **endpoints backend con service key**.
- Se elimina el acceso anónimo directo y las policies permisivas.
- Auth de usuarios homogénea (roles `admin`/`oficina`/`operario`), PINs en **bcrypt**,
  rate limiting en login.

### 3.4 Estructura de código objetivo
```
api/        # serverless DELGADO: rutea + valida, llama a lib/
lib/        # el corazón (testeable sin servidor)
  models/   # Proyecto, Mueble, Jornada, Empleado — 1 definición c/u
  domain/   # reglas de negocio (cálculo horas/costos/etapas)
  auth/     # sessions, PINs (bcrypt), middleware
  db/       # cliente + queries por entidad
db/migrations/  # numeradas, con runner (hoy: 45 .sql sueltos a mano)
web/        # frontend componentizado de a poco
tests/      # empezar por domain/
```

`lib/` es **el sustrato donde convergen las partes**: cada app que se integra aterriza
acá con el modelo de datos y de auth común.

---

## 4. Estrategia de migración (strangler)

No hay big-bang. Se estrangula el monolito (`tiempos.js`, 5.133 líneas / 114 actions)
extrayendo un dominio por vez. **Regla: no se agrega al monolito; solo se extrae.
Features nuevas nacen en `lib/`.**

### Orden propuesto  `[PROPUESTO]`
0. **Fundaciones** — `CLAUDE.md` ✓, `ARQUITECTURA.md` ✓, migration runner ✓
   (`db/migrate.mjs` + `db/migrations/`), `lib/db/client.js` ✓. **Pendiente** (toca
   `tiempos.js`, esperar a que aterrice despachos): primer test de cálculo de horas,
   que fija de paso los bugs de `jornada_segmentos`.
1. **Jornadas** — extraer las ~15 actions de jornada; consolidar `entrada`/`entrada-v2`;
   arreglar bugs bloqueantes de datos.
2. **Auth/Seguridad** — PINs→bcrypt, rate limiting, `checkSession` fail-closed.
3. **ctrl-despachos** — etapa final del pipeline. **EN CURSO en otra sesión** — ver
   ⚠️ coordinación abajo.
4. **Costos / Proyectos** — incluye Lote 6 (costos directos), ya sobre la estructura nueva.
5. **herramientas** — absorber dentro del login del operario (hoy login + lista aparte);
   unificar al modelo de auth común.
6. **cortes** — acople flojo, en paralelo, sin bloquear (es prototipo).

*(jornales NO entra: es de BIG Sur, fuera de alcance — ver ADR-5.)*

### ⚠️ Coordinación — dos sesiones sobre el mismo repo
ctrl-despachos se está integrando AHORA en otra sesión, que muy probablemente toca
`api/tiempos.js` (acciones de despacho) y/o `api/despachos.js`. Para evitar conflictos
de merge sobre el monolito de 5.133 líneas: **el paso 0 (Fundación) arranca por lo que
NO toca `tiempos.js`** — migration runner, scaffolding de `lib/db`, primer test — y la
extracción de Jornadas espera a que la integración de despachos aterrice y se commitee.

---

## 5. Decisiones de arquitectura (ADRs)  `[todos PROPUESTOS — validar]`

- **ADR-1 — Base unificada:** MBLE-INT es la base única del ecosistema maderable;
  cortes y herramientas se quedan y se gobierna el esquema compartido. BIG-SUR-GASTOS
  (y jornales) quedan fuera.
- **ADR-0 — Repo único:** todo converge en `maderable-produccion`; no se arma monorepo.
  `lib/` es organización interna. *(ratificado por JP, jun-2026)*
- **ADR-2 — Auth común / sin anon directo:** se deprecia el acceso anónimo de las apps
  vecinas; todo pasa por backend con service key. Migrar herramientas y jornales antes
  de cerrar las policies `anon_all_*`.
- **ADR-3 — Capa `lib/` + strangler:** la lógica de negocio sale de `api/` a `lib/`,
  extrayendo `tiempos.js` por dominio.
- **ADR-4 — Modelo canónico:** `proyectos_cache`→`proyectos`, unificar `cliente` e `items/muebles`.
- **ADR-5 — jornales = BIG Sur, fuera de alcance:** sus tablas `jornales_*` están mal
  ubicadas en MBLE-INT (deberían vivir en la base BIG-SUR-GASTOS). No se integran ni se
  tocan; sus policies `anon_all_*` quedan como están (las usa la app de BIG Sur). Tarea
  futura aparte: relocalizar esas tablas a su base. Confirmar que efectivamente es BIG Sur.

---

## 6. Backlog fusionado

> Nota: el doc viejo cortaba en Lote 6/7. Varias cosas ya están construidas en el
> monolito (costos directos, grupos, biller). Manda este backlog, no los LOTE reports.

### Bugs bloqueantes (integridad de datos — antes que features)
- `jornada_segmentos`: `_entradaImpl` pisa la entrada de la mañana al re-entrar (24+ jornadas).
- `cron-cierre.js` fabrica `fin = 18:00` (viola "no fabricar datos").
- `Operarios > Estado Real` muestra "undefined undefined" en CENTRO.
- Import `factura_lineas` Zoho: 4 bugs detectados en auditoría.

### En curso / próximo
- Lote 6 — costos directos (parcialmente en el monolito; completar UX + tipo de cambio).
- Lote 7 — paridad UX carga de materiales dentro del proyecto.
- ctrl-despachos + `despachos_muebles` — integración (etapa final pipeline).
- TV planta operarios (`tv-planta.html`) — frontend sin construir.
- Lean dashboard TV2 — backend diseñado, frontend pendiente.
- Import nesting SWOOD (`nesting_swood`).
- Roadmap largo: Lote 8.2, U1, 6.5, 9, 10, biller frontend, madera maciza (MAD-1→4).

### Deudas técnicas
- Seguridad (ver `sql/seguridad-fix.sql` y `CLAUDE.md`): RLS está ON; agujeros en apps
  vecinas (verificar_operario brute-force, anon_all en jornales_*/herramientas, bucket
  `uploads`, vista `corte.cortes_listado`).
- Migration runner + schema source-of-truth (45 `.sql` a mano).
- Renombres canónicos (ADR-4). PINs→bcrypt. Rate limiting. `checkSession` fail-closed.
- Race condition al sumar `descanso_minutos` (teórica). `tiempo-activo` leak menor.
- Sin tests.

### UX pendiente (nuevo-proyecto.html paso 3 Muebles)
- Columna DIF → TAMAÑO con S/M/L/XL.
- Campo Nombre: palabras MAYÚSCULAS del item ODF; si no hay, primeras 3 palabras.
- Código default C00, C01… salvo que la ODF traiga el suyo.

---

## 7. Decisiones tomadas (jun-2026)

- **Destino físico → repo único `maderable-produccion`** (NO monorepo). Recomendación
  ratificada por JP. Razón: ya está todo acá, sin build step, equipo chico; un monorepo
  sumaría tooling sin beneficio. Las partes (herramientas, cortes) se absorben *dentro*
  de este repo; la estructura `lib/` es organización interna, no paquetes separados.
- **herramientas → dentro del login del operario.** Hoy tiene login y lista aparte; el
  objetivo es que viva en la sesión del operario. Diferido ("más adelante").
- **ctrl-despachos → integración EN CURSO** en otra sesión (ver §4 coordinación).
- **jornales → fuera de alcance** (BIG Sur, ADR-5).

### Preguntas que quedan abiertas
- cortes/herramientas: confirmar que se quedan en MBLE-INT gobernado (asumido sí).
- ctrl-despachos: ¿datos migrados al core o consumidos vía tabla puente? (lo define la
  sesión que lo está integrando ahora).
- jornales: confirmar que es BIG Sur y decidir si se relocalizan sus tablas.
