import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vufzhxjbngdqdhmorcpr.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1ZnpoeGpibmdkcWRobW9yY3ByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NTkxODQsImV4cCI6MjA5NTEzNTE4NH0.l_gnnwpdJpDGfznjexbj_RNCT_b6Th8sp7n7Fy1XUp8'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
