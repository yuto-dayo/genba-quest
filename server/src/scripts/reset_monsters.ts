import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetMonsters() {
    console.log("Resetting monsters...");

    // 1. Clear site columns
    // We update all sites to remove monster data so they will be regenerated
    const { error: sitesError, count } = await supabase
        .from("sites")
        .update({
            monster_name: null,
            monster_image_url: null,
            monster_attributes: null,
            monster_archetype: null
        })
        .neq("id", "00000000-0000-0000-0000-000000000000"); // condition to match all rows safely if needed, or just remove .neq if allowed

    if (sitesError) {
        console.error("Error updating sites:", sitesError);
    } else {
        console.log(`Cleared monster columns for sites.`);
    }

    // 2. Delete monster images
    const { error: imagesError } = await supabase
        .from("monster_images")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000"); // Match all

    if (imagesError) {
        console.error("Error deleting monster images:", imagesError);
    } else {
        console.log("Deleted monster images from cache.");
    }

    console.log("Monster reset complete.");
}

resetMonsters();
