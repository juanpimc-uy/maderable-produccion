# LOTE 2 — Fixes Post-Entrega

Apéndice al reporte principal (`LOTE2_REPORT.md`). Tres correcciones UI/UX aplicadas en la sesión posterior al lote original.

---

## Fix 1 — Sidebar: bloque usuario+logout rediseñado

El bloque de sesión activa del sidebar (`admin.html`) tenía un texto gris plano (`"Cerrar sesión · Juan Martinez"`) y un botón `"← Salir"` sin jerarquía visual, mezclado con los links de planta. Se reemplazó por un componente compacto con: avatar circular 24×24 fondo `#FFD600` con iniciales en negro, nombre del usuario en blanco uppercase 12px, rol_app en gris #888 11px, y botón `"↪ Cerrar sesión"` full-width con border `0.5px solid #2a2a2a` y hover amarillo. El JS de inicialización (`sidebar-user-block`) rellena los tres elementos desde `window.AUTH.usuarioActual()`.

---

## Fix 2 — Modal "Editar Operario": remover Especialidad, agregar Email y Rol de App

El campo `Especialidad` (dropdown con valores CNC/Armado/Revisión/etc.) fue eliminado del modal de edición de operario en `admin.html` porque es un dato de producción que no corresponde al perfil del empleado en el sistema. En su lugar se agregaron dos campos nuevos:

- **Email** (input type=email, opcional para `operario`, obligatorio si `rol_app` es `oficina` o `admin`). Al cambiar el dropdown de rol a `oficina/admin` con email vacío, el foco se mueve automáticamente al input de email. Al guardar, el validador bloquea el submit y muestra error inline en `#mod-op-error` si el email es requerido y falta.
- **Rol de App** (select con opciones `operario / oficina / admin`, pre-llenado con el valor actual del empleado).

Los cambios se propagaron a: `guardarOperario()` (lectura + validación + mutación del objeto), `syncEmpleadoSupabase()` (payload al API), `syncOperarioSupabase()`, `syncTodosOperarios()`, y el mapeo en `cargarTodoDesdeSupabase()`. Las vistas de tarjeta de operario que mostraban `op.especialidad` ahora muestran `op.rol_app`. El array seed `_OPERARIOS_SEED` también fue limpiado.

En `api/tiempos.js`: el endpoint GET `empleados` ahora selecciona también `email,rol_app`. El handler `sync-empleado` persiste `email` y `rol_app` condicionalmente (solo si vienen en el body, para no sobrescribir con null en syncs parciales).

---

## Fix 3 — Verificación de estado final del modal

El modal "Editar Operario" queda con los siguientes campos en orden:
1. Nombre completo + Cédula (fila)
2. Avatar + Email (fila)
3. Rol de App + Categoría (fila; Categoría solo visible para rol `admin`)
4. Centros habilitados (grid 2 columnas)
5. Mensaje de error inline + botones Cancelar / Guardar

El campo `Especialidad` no aparece en ningún lugar del modal.
