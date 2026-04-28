# LOTE 3 — PWA + Wheel Picker · Reporte

## Resumen de cambios

| Paso | Archivo(s) | Qué hace |
|------|-----------|----------|
| 1 | `scripts/generate-icons.js`, `icons/*.png` | Genera 4 íconos PWA desde `icon-source.png` vía sharp |
| 2 | `manifest.json` | Web App Manifest para instalación como PWA |
| 3 | `sw.js` | Service worker mínimo: cache-first estáticos, network-first HTML y API |
| 4 | `planta2.html` `<head>` + `</body>` | Tags de manifest, tema, Apple y registro del SW |
| 5 | `planta2.html` | Reemplazo de inputs numéricos de placa CNC por ruleta vertical iOS-style |

---

## Cómo probar la PWA

### Chrome Android (target principal)
1. Abrir Chrome en la tablet de planta → navegar a `/planta2.html`
2. Menú ⋮ → **"Instalar app"** o **"Agregar a pantalla de inicio"**
3. Confirmar. Aparece ícono **"Planta MBLE"** con fondo negro y M amarilla
4. Tocar el ícono → abre fullscreen sin barra del navegador ni controles del OS
5. Verificar que `theme-color` es amarillo `#FFD600` en la barra de estado

### Safari iOS
1. Abrir en Safari → tocar botón Compartir → **"Agregar a pantalla de inicio"**
2. Nombre pre-llenado: "Planta MBLE"
3. Al abrir desde home: fullscreen, sin chrome de Safari
4. Status bar: `black-translucent` (superpuesta sobre contenido oscuro)

### Verificar service worker
1. Chrome DevTools → Application → Service Workers → ver `sw.js` activo
2. Application → Cache Storage → `planta-mble-v1` → debe listar los ASSETS
3. Simular offline (DevTools Network → Offline) → planta2.html sigue sirviendo desde cache

---

## Cómo probar el slider de placa

### Flujo principal (inicio de corte)
1. Login en planta2 → seleccionar proyecto → seleccionar ítem → elegir centro CNC
2. Aparece la pantalla "¿DESDE QUÉ PLACA ARRANCÁS?" con la ruleta vertical
3. La ruleta arranca en **0** (amarillo grande en el centro)
4. Tirar con el dedo hacia arriba para bajar el número, hacia abajo para subir
5. Llevar hasta 12 → ver "12" grande en amarillo, números adyacentes en gris
6. Tocar **▶ INICIAR CORTE** → tarea CNC comienza con `cncPlacaNum = 12`

### Flujo tiempo muerto (idle)
1. Registrar una placa (✓ OK o → SALTAR) → aparece la pantalla de tiempo muerto
2. La ruleta de "PRÓXIMA PLACA" aparece pre-posicionada en el número siguiente
3. Ajustar si es necesario, luego **▶ INICIAR PLACA #X**

### Flujo saltar placa
1. Desde corte activo → **→ SALTAR PLACA** → abre modal "¿CUÁL ES LA PRÓXIMA PLACA?"
2. La ruleta del modal aparece posicionada en `placa actual + 1`
3. Ajustar y confirmar

### Interacción alternativa (desktop testing)
- Scroll con rueda del mouse sobre el picker
- Click directo en cualquier número visible → hace scroll hacia ese número
- El número central siempre es el valor activo (borde amarillo tenue arriba y abajo)

---

## Regenerar íconos

Si el logo fuente cambia:

```bash
node scripts/generate-icons.js
```

Requiere `sharp` instalado (`npm install` ya lo incluye como devDependency).

---

## Deudas técnicas conocidas

| Deuda | Estado | Lote objetivo |
|-------|--------|---------------|
| **BLOCKER login planta2**: `e.pin` undefined porque GET empleados ya no devuelve PIN — todos los logins de planta están rotos en prod | Abierto | **Lote 3.5** |
| **RLS Supabase**: tablas sin Row Level Security, cualquier anon key tiene acceso directo | Abierto | Lote 1 (pendiente) |
| **PIN plain text**: PINs almacenados sin hash en columna `pin` | Abierto | Lote 2 (pendiente) |
| **GET empleados PIN**: removido del SELECT (fix aplicado), pero planta2 login aún no migrado a endpoint server-side | Blocker activo | Lote 3.5 |
