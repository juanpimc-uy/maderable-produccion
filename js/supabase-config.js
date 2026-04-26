window.SUPABASE_URL = 'https://xhfeurinovvsbgobkidy.supabase.co';
window.SUPABASE_ANON_KEY = '__PEGAR_ANON_KEY__';

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
