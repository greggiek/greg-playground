function env(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}.`); return value; }

async function supabaseRest(path, options = {}) {
  const key = env("SUPABASE_SECRET_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase returned ${response.status}.`);
  return body;
}

module.exports = { supabaseRest };
