import { createClient } from '@supabase/supabase-js';

// The one Supabase client the API uses. It signs in with the service-role
// key, which bypasses every database rule, so it stays on the server and the
// API code does all the checking.
export const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY // service-role key – never exposed to client
);
