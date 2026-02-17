
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function updateArchetypes() {
    console.log("🔄 Updating monster archetypes...");

    const archetypes = [
        {
            name: 'RUBBLE_GOLEM',
            name_ja: '瓦礫ゴーレム',
            base_prompt: 'A massive stone golem made of construction rubble and concrete debris, glowing red eyes, dust particles floating around, cracked stone armor, standing in a demolished building site, dark fantasy art style, dramatic lighting, 4K detailed, menacing pose',
            work_types: ['demolition', 'removal', '解体', '撤去', '斫り', '産廃'],
            default_attributes: ['HARD_ARMOR', 'DUST_ATTACK', 'HEAVY_STRIKE'],
            rarity: 'common'
        },
        {
            name: 'INTERIOR_PHANTOM',
            name_ja: '内装ファントム',
            base_prompt: 'A ghostly spectral figure emerging from unfinished walls and ceiling tiles, translucent ethereal body with exposed wiring and cables flowing through it, glowing blue energy, floating above a half-renovated room, dark fantasy art style, dramatic lighting, 4K detailed',
            work_types: ['interior', 'finishing', 'renovation', '内装', '仕上げ', 'リフォーム', '床', 'クロス', 'ボード', '畳', 'カーペット', '壁修繕', 'クリーニング'],
            default_attributes: ['PHASE_SHIFT', 'WIRE_TRAP', 'CEILING_DROP'],
            rarity: 'common'
        },
        {
            name: 'SCAFFOLD_SPIDER',
            name_ja: '足場スパイダー',
            base_prompt: 'A gigantic mechanical spider made of scaffolding pipes and metal joints, eight legs of steel tubes, multiple glowing yellow eyes, welding sparks flying, climbing on a building exterior, dark fantasy art style, dramatic lighting, 4K detailed',
            work_types: ['scaffolding', 'exterior', 'facade', '足場', '外壁', '外装', '養生'],
            default_attributes: ['WEB_BARRIER', 'HEIGHT_ADVANTAGE', 'METAL_STRIKE'],
            rarity: 'rare'
        },
        {
            name: 'PAINT_SLIME',
            name_ja: '塗装スライム',
            base_prompt: 'A large amorphous creature made of dripping paint in multiple vibrant colors, iridescent surface reflecting rainbow hues, paint buckets and brushes embedded in its body, leaving colorful trails, dark fantasy art style, dramatic lighting, 4K detailed',
            work_types: ['painting', 'coating', 'finishing', '塗装', 'コーティング', '防水', 'シーリング'],
            default_attributes: ['COLOR_BLIND', 'STICKY_TRAP', 'TOXIC_FUMES'],
            rarity: 'common'
        },
        {
            name: 'FOUNDATION_TITAN',
            name_ja: '基礎タイタン',
            base_prompt: 'An enormous titan emerging from the earth, body made of concrete foundations and rebar skeleton visible, dirt and rocks falling from its form, standing in an excavation pit, towering height, dark fantasy art style, dramatic lighting, 4K detailed',
            work_types: ['foundation', 'concrete', 'earthwork', 'excavation', '基礎', 'コンクリート', '土工', '左官', '杭工事'],
            default_attributes: ['EARTHQUAKE', 'IRON_GRIP', 'UNSTOPPABLE'],
            rarity: 'epic'
        },
        {
            name: 'ELECTRICAL_WRAITH',
            name_ja: '電気レイス',
            base_prompt: 'A crackling wraith made of electrical wires and sparking conduits, lightning arcing from its spectral form, glowing circuit patterns on its body, floating above electrical panels, dark fantasy art style, dramatic lighting, 4K detailed',
            work_types: ['electrical', 'wiring', 'power', '電気', '配線', '電気工事', '通信', '防災'],
            default_attributes: ['SHOCK_WAVE', 'SHORT_CIRCUIT', 'POWER_SURGE'],
            rarity: 'rare'
        },
        {
            name: 'PLUMBING_HYDRA',
            name_ja: '配管ヒドラ',
            base_prompt: 'A multi-headed serpent creature with three heads made of copper and PVC pipes, water spraying from joints and valves, coiled around bathroom fixtures, rusty scales of pipe fittings, dark fantasy art style, dramatic lighting, 4K detailed',
            work_types: ['plumbing', 'piping', 'water', '配管', '給排水', '水道', '衛生', '空調'],
            default_attributes: ['WATER_BLAST', 'FLOOD_ZONE', 'CORROSION'],
            rarity: 'rare'
        },
        {
            name: 'GENERIC_CONSTRUCT',
            name_ja: '工事コンストラクト',
            base_prompt: 'A humanoid construct made of various construction materials including wood planks, metal beams, and concrete blocks, tools embedded in its body like a hammer hand and saw blade shoulder, hard hat head, standing on a construction site, dark fantasy art style, dramatic lighting, 4K detailed',
            work_types: ['general', 'other', 'mixed', '一般', 'その他', '複合'],
            default_attributes: ['ADAPT', 'TOOL_SWING', 'MATERIAL_SHIFT'],
            rarity: 'common'
        }
    ];

    const { error } = await supabaseAdmin
        .from('monster_archetypes')
        .upsert(archetypes, { onConflict: 'name' });

    if (error) {
        console.error("❌ Failed to update archetypes:", error);
    } else {
        console.log("✅ Archetypes updated successfully!");
    }
}

updateArchetypes();
