import { supabaseAdmin } from "./supabaseClient";

export async function ensureProfileRecord(userId: string): Promise<void> {
    const { error } = await supabaseAdmin
        .from("profiles")
        .upsert(
            {
                id: userId,
                updated_at: new Date().toISOString(),
            },
            {
                onConflict: "id",
                ignoreDuplicates: true,
            },
        );

    if (error) {
        throw error;
    }
}
