window.SUPABASE_URL = 'https://xhfeurinovvsbgobkidy.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoZmV1cmlub3Z2c2Jnb2JraWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3ODM3MjksImV4cCI6MjA4OTM1OTcyOX0.iGYICZQxSAPV_XyahHygmAxyvaEUDA-fGNjpiO9WdRA';

window.sbFetch = async function(path) {
  const st = window.AUTH?.getSessionToken() || '';
  const res = await fetch('/api/tiempos?action=sb-read&st=' + encodeURIComponent(st) + '&path=' + encodeURIComponent(path));
  if (!res.ok) throw new Error(`sbFetch ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Error sbFetch');
  return data.rows;
};
