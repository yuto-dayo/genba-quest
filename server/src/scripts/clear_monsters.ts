
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function clearMonsters() {
    console.log("🚫 Clearing monster data...");

    // 1. Delete all records from monster_images
    const { error: deleteError } = await supabaseAdmin
        .from("monster_images")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all

    if (deleteError) {
        console.error("Error deleting monster_images:", deleteError);
    } else {
        console.log("✅ Cleared monster_images table");
    }

    // 2. Clear monster columns in sites table
    const { error: updateError } = await supabaseAdmin
        .from("sites")
        .update({
            monster_name: null,
            monster_image_url: null,
            monster_attributes: null,
            monster_archetype: null,
        })
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Update all

    if (updateError) {
        console.error("Error updating sites table:", updateError);
    } else {
        console.log("✅ Cleared monster data from sites table");
    }

    console.log("🎉 Done!");
}

clearMonsters();
