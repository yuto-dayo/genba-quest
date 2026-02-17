import dotenv from "dotenv";
import path from "path";

// Load environment variables FIRST
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { createClient } from "@supabase/supabase-js";
import { generateMonsterImage } from "../services/monsterService";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function measurePerformance() {
    console.log("⏱ Starting performance measurement...");

    // 1. Get a test site
    const { data: site } = await supabaseAdmin
        .from("sites")
        .select("*")
        .limit(1)
        .single();

    if (!site) {
        console.error("No site found for testing");
        return;
    }

    console.log(`🏗 Test Site: ${site.name} (${site.id})`);
    console.log(`📋 Work Types: ${JSON.stringify(site.work_types)}`);

    const start = Date.now();

    try {
        const result = await generateMonsterImage(site);

        const end = Date.now();
        const duration = (end - start) / 1000;

        console.log("----------------------------------------");
        console.log(`✅ Generation completed in ${duration.toFixed(2)}s`);
        console.log(`👾 Monster: ${result.monsterName}`);
        console.log(`🎨 Archetype: ${result.archetypeName}`);
        console.log(`📝 Prompt Length: ${result.promptUsed.length}`);
        console.log("----------------------------------------");
    } catch (error) {
        console.error("❌ Generation failed:", error);
    }
}

measurePerformance();
