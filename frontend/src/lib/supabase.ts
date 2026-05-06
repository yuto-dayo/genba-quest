import { createClient } from "@supabase/supabase-js";
import { isDevAuthSessionActive } from "./devAuth";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const getAuthToken = async () => {
    if (isDevAuthSessionActive()) {
        return "dev-auth-token";
    }

    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
};
