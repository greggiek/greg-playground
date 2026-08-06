function env(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}.`); return value; }

async function supabaseRest(path, options = {}) {
  return supabaseRestWith("SUPABASE_URL", "SUPABASE_SECRET_KEY", path, options);
}

async function gmailSupabaseRest(path, options = {}) {
  return supabaseRestWith("GMAIL_SUPABASE_URL", "GMAIL_SUPABASE_SECRET_KEY", path, options);
}

async function supabaseRestWith(urlName, keyName, path, options = {}) {
  const key = env(keyName);
  const authorization = key.split(".").length === 3 ? { Authorization: `Bearer ${key}` } : {};
  const response = await fetch(`${env(urlName)}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      ...authorization,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.hint || `Supabase returned ${response.status}.`);
  return body;
}

module.exports = { supabaseRest, gmailSupabaseRest };
