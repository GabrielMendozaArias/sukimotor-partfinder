const { createClient } = require('@supabase/supabase-js');

// El backend usa service_role para bypassear RLS desde el servidor confiable
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;
