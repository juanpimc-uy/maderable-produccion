# Migration Report: proyectos → Supabase

**Date:** 2026-04-26  
**Branch:** main  
**Commits:** d183f9d → 862cda1 (7 commits)

## Summary

Removed all `localStorage('proyectos')` reads and writes across the entire codebase. Proyectos are now loaded exclusively from Supabase (`proyectos_cache` table) and written via the `/api/tiempos?action=guardar-proyecto` endpoint.

## Commits

| PASO | Commit | Description |
|------|--------|-------------|
| 1 | d183f9d | feat: shared supabase-config.js with sbFetch helper |
| 2 | 22f2c9a | fix(api): sync-proyecto upsert is no longer lossy |
| 3 | fbecd0c | refactor(admin): proyectos source of truth is Supabase |
| 4 | 2995e20 | refactor(nuevo-proyecto): no localStorage writes for proyectos |
| 5 | eb063f8 | refactor(materiales): no localStorage for proyectos/ocs/recepciones |
| 6 | fcd4aed | refactor(tercerizados): proyectos from Supabase, no localStorage |
| 7 | 862cda1 | refactor(despacho): persist module dispatch to Supabase |

## Changes per file

### `/js/supabase-config.js` (NEW)
- `window.SUPABASE_URL`, `window.SUPABASE_ANON_KEY`, `window.sbFetch` helper
- Imported in all 6 HTML files via `<script src="/js/supabase-config.js"></script>`

### `api/tiempos.js`
- `sync-proyecto` endpoint rewritten to full upsert (was writing only 4 fields; now writes all 16 fields, identical to `guardar-proyecto`)

### `admin.html`
- Removed `SEED_PROYECTOS` hardcoded demo array
- Replaced synchronous localStorage IIFE with async `sbFetch('proyectos_cache?activo=eq.true&order=nombre')` + `mapProyectoFromDB()`
- `mapProyectoFromDB()`: new function that preserves `centros` and `nota` per mueble (old code was losing these)
- `syncProyectoSupabase()`: now sends full 16-field payload to `guardar-proyecto` (not the old 4-field `sync-proyecto`)
- `syncTodosProyectos()`: iterates in-memory `PROYECTOS` (no localStorage read)
- `renderKpis()`: bloqueados count reads from in-memory `PROYECTOS`
- `guardarProyecto()`: removed localStorage read/write block
- `confirmarRecibirInline()`, `toggleCriticoInline()`: mutate `PROYECTOS` directly
- `guardarMueblesLS()`: simplified to just call `syncProyectoSupabase`
- `renderMatTabOCs()`: `window._zohoProyStorage = PROYECTOS`
- `recibirOCCompleta()`, `recibirOCRegistrada()`, `confirmarParcialOCSistema()`, `ejecutarRecibirOCCompleta()`, `ejecutarRecepcionParcial()`: pass `PROYECTOS` directly to `_cruzarItemsConMuebles`; removed localStorage read/write + in-memory sync-back
- `renderMatTabPorProyecto()`: reads `PROYECTOS` directly
- `toggleCriticoMat()`, `recibirMatMueble()`: mutate `PROYECTOS` directly

### `nuevo-proyecto.html`
- `guardar()`: removed `localStorage.getItem/setItem('proyectos')`
- Init block: `_proyectosCache` starts as `[]`, no longer seeded from localStorage

### `materiales.html`
- `PROYECTOS` init: was `JSON.parse(localStorage.getItem('proyectos')||'[]')`, now `[]`
- Background loader: removed `localStorage.setItem('proyectos', ...)`
- `guardarRecepcion()`: removed `localStorage.setItem('proyectos', ...)`

### `tercerizados.html`
- `_PROYECTOS` init: replaced localStorage read with `sbFetch('proyectos_cache?activo=eq.true&order=nombre')`
- Background refresh also uses `sbFetch` instead of `proyectos-completos` + localStorage

### `despacho.html`
- `PROYECTOS` init: was `JSON.parse(localStorage.getItem('proyectos')||'[]')`, now `[]`
- Background loader: removed `localStorage.setItem('proyectos', ...)`
- `guardarDespacho()`: removed `localStorage.setItem('proyectos', ...)`; added `guardar-proyecto` call for the mutated project (module dispatch state)

## Verification

```
grep -rn "localStorage[^(]*'proyectos'" **/*.html **/*.js
→ 0 matches
```

## Notes

- `SUPABASE_ANON_KEY` in `/js/supabase-config.js` is still set to `'__PEGAR_ANON_KEY__'`. Replace with real anon key before deploying.
- `ocs` and `recepciones` in `materiales.html` still use localStorage as secondary cache (acceptable — those were not in scope).
- `ocs_manuales`, `ocs_sistema`, `ocsProcesadas` in `admin.html` still use localStorage (not proyectos — out of scope).
