/* js/buscador.js — buscador de proyecto/mueble reutilizable MBLE
   montarBuscador(input, dropdown, items, opts) -> { set(items), limpiar() }
   opts: codigo(x), texto(x), sub(x), buscar(x), valor(x), onSelect(x), limite, caret
   Inyecta su propio CSS (colores literales para verse igual en todo el sitio). */
(function(){
  if (window.montarBuscador) return;
  if (!document.getElementById('mble-buscador-css')) {
    var st = document.createElement('style');
    st.id = 'mble-buscador-css';
    st.textContent =
      '.bs-drop{display:none;position:absolute;top:100%;left:0;right:0;z-index:1000;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;max-height:210px;overflow-y:auto;margin-top:3px;box-shadow:0 8px 24px rgba(0,0,0,.5);}'+
      '.bs-row{padding:8px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.03);}'+
      '.bs-row:last-child{border-bottom:none;}'+
      '.bs-row:hover,.bs-row.bs-hi{background:#252525;}'+
      '.bs-line1{display:flex;align-items:baseline;gap:8px;font-size:13px;}'+
      '.bs-cod{color:#FFD600;font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:700;flex:none;min-width:64px;}'+
      '.bs-txt{color:#cfcfcf;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'+
      '.bs-sub{margin:2px 0 0 72px;font-size:10.5px;color:#777;font-family:\'JetBrains Mono\',monospace;letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'+
      '.bs-empty{padding:10px 12px;font-size:12px;color:#777;}'+
      '.bs-caret{position:absolute;right:11px;top:13px;pointer-events:none;color:#666;font-size:10px;}';
    document.head.appendChild(st);
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  window.montarBuscador = function(input, dropdown, items, opts){
    opts = opts || {};
    var codigo   = opts.codigo   || function(){ return ''; };
    var texto    = opts.texto    || function(){ return ''; };
    var subFn    = opts.sub      || function(){ return ''; };
    var buscarFn = opts.buscar   || function(x){ return [codigo(x), texto(x)].join(' '); };
    var valorFn  = opts.valor    || function(x){ return (codigo(x)||'') + ' · ' + (texto(x)||''); };
    var onSelect = opts.onSelect || function(){};
    var limite   = opts.limite   || 8;
    var datos    = items || [];
    var filtrados = [];
    var hi = -1;

    if (input.parentElement){
      if (window.getComputedStyle(input.parentElement).position === 'static')
        input.parentElement.style.position = 'relative';
      if (opts.caret !== false && !input.parentElement.querySelector('.bs-caret')){
        var car = document.createElement('span');
        car.className = 'bs-caret'; car.textContent = '\u25BE';
        input.insertAdjacentElement('afterend', car);
      }
    }

    function render(){
      var q = (input.value||'').toLowerCase().trim();
      filtrados = datos.filter(function(x){ return buscarFn(x).toLowerCase().indexOf(q) !== -1; }).slice(0, limite);
      hi = -1;
      if (!filtrados.length){
        dropdown.innerHTML = '<div class="bs-empty">Sin resultados</div>';
      } else {
        dropdown.innerHTML = filtrados.map(function(x,i){
          var sub = subFn(x);
          return '<div class="bs-row" data-i="'+i+'">'
               +   '<div class="bs-line1"><span class="bs-cod">'+esc(codigo(x))+'</span><span class="bs-txt">'+esc(texto(x))+'</span></div>'
               +   (sub ? '<div class="bs-sub">'+esc(sub)+'</div>' : '')
               + '</div>';
        }).join('');
      }
      dropdown.style.display = 'block';
    }
    function elegir(i){
      var x = filtrados[i]; if (!x) return;
      input.value = valorFn(x);
      dropdown.style.display = 'none';
      onSelect(x);
    }
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('blur', function(){ setTimeout(function(){ dropdown.style.display='none'; }, 150); });
    input.addEventListener('keydown', function(e){
      var rows = dropdown.querySelectorAll('.bs-row');
      if (e.key==='ArrowDown'){ e.preventDefault(); hi=Math.min(hi+1,rows.length-1); }
      else if (e.key==='ArrowUp'){ e.preventDefault(); hi=Math.max(hi-1,0); }
      else if (e.key==='Enter'){ if(hi>=0){ e.preventDefault(); elegir(hi); } return; }
      else return;
      for (var i=0;i<rows.length;i++) rows[i].classList.toggle('bs-hi', i===hi);
      if (rows[hi]) rows[hi].scrollIntoView({block:'nearest'});
    });
    dropdown.addEventListener('mousedown', function(e){
      var row = e.target.closest('.bs-row');
      if (row) elegir(+row.getAttribute('data-i'));
    });

    return {
      set: function(nuevos){ datos = nuevos || []; },
      limpiar: function(){ input.value=''; dropdown.style.display='none'; }
    };
  };
})();
