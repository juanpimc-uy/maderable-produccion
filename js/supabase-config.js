window.SUPABASE_URL = 'https://xhfeurinovvsbgobkidy.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoZmV1cmlub3Z2c2Jnb2JraWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3ODM3MjksImV4cCI6MjA4OTM1OTcyOX0.iGYICZQxSAPV_XyahHygmAxyvaEUDA-fGNjpiO9WdRA';

window.sbFetch = async function(path, opts = {}) {
  const url = `${window.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      apikey: window.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
};
