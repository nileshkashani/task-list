import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL and Anon Key must be defined in your .env file')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
console.log(supabase)