/**
 * Monster Generation Service
 * 動的トレイト抽出 + Cartoon スタイルでモンスター画像を生成
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabaseAdmin } from "../lib/supabaseClient";

// ============================================================
// Types
// ============================================================

export interface Site {
    id: string;
    name: string;
    work_types?: string[];
    estimated_hours?: number;
    monster_archetype?: string;
}

export interface MonsterArchetype {
    id: string;
    name: string;
    name_ja: string;
    base_prompt: string;
    work_types: string[];
    default_attributes: string[];
    rarity: string;
}

export interface MonsterGenerationResult {
    imageBase64: string;
    monsterName: string;
    monsterNameJa: string;
    archetypeId: string;
    archetypeName: string;
    attributes: string[];
    promptUsed: string;
}

// 動的トレイト型定義
export interface MonsterTraits {
    personality: 'hungry' | 'happy' | 'grumpy' | 'zen' | 'excited' | 'worried';
    sizeLevel: 'tiny' | 'small' | 'medium' | 'large' | 'giant';
    accessories: string[];
    visualEffects: string[];
    specialFeatures: string[];
}

interface Transaction {
    description?: string;
    vendor_name?: string;
    amount_total?: number;
    kind?: string;
    status?: string;
}

// ============================================================
// Constants
// ============================================================

const NAME_PREFIXES = ["SHADOW", "IRON", "STONE", "DUST", "CHROME", "RUST", "STEEL", "DARK", "ANCIENT", "CURSED"];
const NAME_PREFIXES_JA = ["影の", "鋼鉄の", "石の", "塵の", "銀の", "錆びた", "鉄の", "闇の", "古代の", "呪われし"];

// Cartoon スタイル用カラーパレット
const CARTOON_COLORS = {
    primary: "#FF6B35",    // オレンジ
    secondary: "#FFE66D",  // イエロー
    accent: "#4ECDC4",     // シアン
    highlight: "#FF71CE",  // ホットピンク
    magic: "#9B59B6",      // パープル
    nature: "#7CB342",     // ライムグリーン
};

// 工事キーワード → アクセサリのマッピング
const WORK_ACCESSORIES: Record<string, string[]> = {
    "防水|屋根|ルーフ": ["レインコート", "傘", "水滴エフェクト"],
    "電気|配線|電工": ["稲妻マーク", "ネオン発光エフェクト", "電球アクセサリ"],
    "塗装|ペンキ|コーティング": ["ペンキバケツ", "ブラシ", "カラフルな斑点模様"],
    "解体|撤去|取り壊し": ["ハンマー", "瓦礫エフェクト", "煙雲"],
    "内装|仕上げ|クロス": ["壁紙ロール", "メジャー", "糊バケツ"],
    "配管|水道|給排水": ["パイプ", "蛇口アクセサリ", "水飛沫エフェクト"],
    "足場|外壁|外装": ["安全帯", "足場パイプ", "高所エフェクト"],
    "基礎|コンクリ|土工": ["ミキサー車", "生コン", "地面ひび割れエフェクト"],
};

// ============================================================
// Monster Name Generation
// ============================================================

function generateMonsterName(siteName: string, archetype: MonsterArchetype, workSummary?: string): { name: string; nameJa: string } {
    const prefixIndex = Math.floor(Math.random() * NAME_PREFIXES.length);
    const prefix = NAME_PREFIXES[prefixIndex];
    const prefixJa = NAME_PREFIXES_JA[prefixIndex];

    // サイト名から特徴的な部分を抽出
    const cleanedSiteName = siteName
        .replace(/現場|工事|ビル|マンション|様邸|邸|店|事務所|オフィス/g, "")
        .trim()
        .slice(0, 8);

    // 英語名
    let englishName: string;
    if (/^[a-zA-Z\s]+$/.test(cleanedSiteName)) {
        englishName = `${prefix} ${cleanedSiteName.toUpperCase()}`;
    } else {
        // 日本語サイト名の場合はアーキタイプ名を使用
        englishName = `${prefix} ${archetype.name.replace(/_/g, " ")}`;
    }

    // 日本語名
    const nameJa = `${prefixJa}${archetype.name_ja}`;

    return { name: englishName, nameJa };
}

// ============================================================
// Attribute Generation
// ============================================================

function generateAttributes(archetype: MonsterArchetype, estimatedHours: number): string[] {
    const baseAttributes = [...(archetype.default_attributes || [])];

    // 難易度に応じた追加属性
    if (estimatedHours > 200) {
        baseAttributes.push("LEGENDARY_ENDURANCE");
    } else if (estimatedHours > 100) {
        baseAttributes.push("ELITE_DEFENSE");
    } else if (estimatedHours > 50) {
        baseAttributes.push("TOUGH_HIDE");
    }

    // レアリティに応じた追加属性
    if (archetype.rarity === "legendary") {
        baseAttributes.push("BOSS_AURA", "DIVINE_SHIELD");
    } else if (archetype.rarity === "epic") {
        baseAttributes.push("BOSS_AURA");
    } else if (archetype.rarity === "rare") {
        baseAttributes.push("ENHANCED_STATS");
    }

    // 最大4属性に制限
    return baseAttributes.slice(0, 4);
}

// ============================================================
// Archetype Matching
// ============================================================

export async function findMatchingArchetype(workTypes: string[]): Promise<MonsterArchetype> {
    const { data: archetypes, error } = await supabaseAdmin
        .from("monster_archetypes")
        .select("*");

    if (error || !archetypes || archetypes.length === 0) {
        throw new Error("No monster archetypes found in database");
    }

    // work_typesのオーバーラップでベストマッチを探す
    let bestMatch: MonsterArchetype = archetypes[0];
    let bestScore = 0;

    const normalizedWorkTypes = (workTypes || []).map(wt => wt.toLowerCase());

    for (const archetype of archetypes) {
        const archetypeWorkTypes = (archetype.work_types as string[]).map(wt => wt.toLowerCase());

        let score = 0;
        for (const wt of normalizedWorkTypes) {
            for (const awt of archetypeWorkTypes) {
                if (wt.includes(awt) || awt.includes(wt)) {
                    score += 1;
                }
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = archetype;
        }
    }

    // マッチなしの場合はGENERIC_CONSTRUCTを使用
    if (bestScore === 0) {
        const generic = archetypes.find(a => a.name === "GENERIC_CONSTRUCT");
        if (generic) return generic;
    }

    return bestMatch;
}

// ============================================================
// Dynamic Trait Extraction (取引データから特徴を抽出)
// ============================================================

function extractTraitsFromTransactions(
    transactions: Transaction[],
    estimatedHours: number,
    workSummary: string
): MonsterTraits {
    const totalExpenses = transactions
        .filter(tx => tx.kind === 'expense' || (tx.amount_total || 0) < 0)
        .reduce((sum, tx) => sum + Math.abs(tx.amount_total || 0), 0);

    const totalIncome = transactions
        .filter(tx => tx.kind === 'sale' || tx.kind === 'invoice')
        .reduce((sum, tx) => sum + (tx.amount_total || 0), 0);

    const hasOverdue = transactions.some(tx => tx.status === 'overdue');
    const isBalanced = Math.abs(totalIncome - totalExpenses) < totalIncome * 0.2;
    const isGrowing = totalIncome > totalExpenses * 1.5;
    const isDeclining = totalExpenses > totalIncome * 1.5;

    // 1. 性格判定
    let personality: MonsterTraits['personality'] = 'happy';
    if (hasOverdue) {
        personality = 'grumpy';
    } else if (totalExpenses > 1000000) {
        personality = 'hungry';
    } else if (isBalanced) {
        personality = 'zen';
    } else if (isGrowing) {
        personality = 'excited';
    } else if (isDeclining) {
        personality = 'worried';
    }

    // 2. サイズレベル判定（予定工数ベース）
    let sizeLevel: MonsterTraits['sizeLevel'] = 'medium';
    if (estimatedHours < 20) {
        sizeLevel = 'tiny';
    } else if (estimatedHours < 50) {
        sizeLevel = 'small';
    } else if (estimatedHours < 100) {
        sizeLevel = 'medium';
    } else if (estimatedHours < 200) {
        sizeLevel = 'large';
    } else {
        sizeLevel = 'giant';
    }

    // 3. アクセサリ判定（工事内容ベース）
    const accessories: string[] = [];
    const combinedText = workSummary.toLowerCase();

    for (const [pattern, items] of Object.entries(WORK_ACCESSORIES)) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(combinedText)) {
            accessories.push(...items.slice(0, 2));
        }
    }

    // デフォルトアクセサリ
    if (accessories.length === 0) {
        accessories.push('ヘルメット', 'ハンマー');
    }

    // 4. 視覚エフェクト（金額ベース）
    const visualEffects: string[] = [];
    if (totalIncome > 5000000) {
        visualEffects.push('王冠', '宝石アクセント', '金色のオーラ');
    } else if (totalIncome > 1000000) {
        visualEffects.push('金色の装飾', 'コイン');
    }

    if (hasOverdue) {
        visualEffects.push('汗マーク', '疲れた目');
    }

    if (isGrowing) {
        visualEffects.push('キラキラエフェクト', '上昇矢印');
    }

    // 5. 特殊機能
    const specialFeatures: string[] = [];
    if (estimatedHours > 200) {
        specialFeatures.push('ボスモンスターサイズ', '威圧的なオーラ');
    }
    if (personality === 'excited') {
        specialFeatures.push('ダイナミックなポーズ');
    }

    return {
        personality,
        sizeLevel,
        accessories: [...new Set(accessories)].slice(0, 4),
        visualEffects: [...new Set(visualEffects)].slice(0, 3),
        specialFeatures,
    };
}

// 性格に応じた表情説明
function getPersonalityDescription(personality: MonsterTraits['personality']): string {
    const descriptions: Record<MonsterTraits['personality'], string> = {
        hungry: 'big belly, open mouth showing teeth, drooling slightly, coin accessories',
        happy: 'big cheerful smile, sparkling eyes, upbeat pose, golden accents',
        grumpy: 'furrowed brows, tired droopy eyes, slight frown but still cute, sweat drops',
        zen: 'peaceful serene expression, small content smile, gentle halo glow',
        excited: 'wide energetic eyes, dynamic jumping pose, sparkles and motion lines',
        worried: 'droopy features, concerned eyes, small sweat drops, hunched posture',
    };
    return descriptions[personality];
}

// サイズに応じた体型説明
function getSizeDescription(sizeLevel: MonsterTraits['sizeLevel']): string {
    const descriptions: Record<MonsterTraits['sizeLevel'], string> = {
        tiny: 'very small and cute, pocket-sized, adorable proportions',
        small: 'compact and nimble, cute but capable looking',
        medium: 'standard proportions, balanced build',
        large: 'chunky and imposing, solid build, powerful stance',
        giant: 'massive and intimidating, boss-sized, towering presence',
    };
    return descriptions[sizeLevel];
}

// ============================================================
// Build Cartoon Style Prompt
// ============================================================

// ============================================================
// Style Definitions (AI Engineering Pattern: Expert Presets)
// ============================================================

interface VisualStyle {
    id: string;
    name: string;
    description: string;
    outlines: string;
    rendering: string;
    lighting: string;
    colors: string;
    antiPatterns: string[];
}

const VISUAL_STYLES: Record<string, VisualStyle> = {
    SUPERCELL: {
        id: 'supercell',
        name: 'Modern Mobile 3D',
        description: '"Supercell" style / Clash Royale / Brawl Stars. High-fidelity vector art look with 3D-like volume.',
        outlines: 'BOLD, CONSISTENT black outlines (4px) around silhouette.',
        rendering: 'Smooth, clean gradients. "Plastic" or "Toy-like" sheen. No noise.',
        lighting: 'Soft studio lighting + Rim lighting.',
        colors: 'Vivid, saturated colors against neutral greys.',
        antiPatterns: ['Pixel art', 'Sketchy lines', 'Flat shading', 'Noise']
    },
    RUBBER_HOSE: {
        id: 'rubber_hose',
        name: 'Vintage 1930s',
        description: '1930s Rubber Hose animation style (Cuphead, early Mickey). Old school cartoon.',
        outlines: 'Rough, organic ink blots. Varying line weight. "Boiling" line effect.',
        rendering: 'Flat, simple shading. Retro aesthetic.',
        lighting: 'Flat lighting, vintage film grain feel.',
        colors: 'Muted, limited palette (Cream, Black, Red, faded Blue). Sepia tones.',
        antiPatterns: ['3D gradients', 'Modern digital effects', 'Neon colors', 'Realistic lighting']
    },
    GENNDY: {
        id: 'genndy',
        name: '90s Tartakovsky',
        description: 'Genndy Tartakovsky style (Dexter\'s Lab, Powerpuff Girls, Samurai Jack). Sharp, angular, dynamic.',
        outlines: 'Thick, sharp, colored outlines (or no outlines on some parts). Geometric abstraction.',
        rendering: 'Flat, cel-shaded. Minimal usage of gradients.',
        lighting: 'Hard shadows, dramatic contrast.',
        colors: 'High contrast, pop-art colors. Pastels mixed with intense primaries.',
        antiPatterns: ['Soft round shapes', 'Detailed textures', 'Realistic rendering', 'Gradient mesh']
    },
    CLAY: {
        id: 'clay',
        name: 'Claymation',
        description: 'Stop-motion clay animation style (Aardman, Wallace & Gromit). Handmade feel.',
        outlines: 'No outlines (or very soft edges).',
        rendering: 'Clay texture, fingerprints visible, imperfections. Physical material look.',
        lighting: 'Physical studio lighting, soft shadows.',
        colors: 'Earthy, matte colors. Plasticine look.',
        antiPatterns: ['Vector lines', 'Digital gradients', 'Perfect geometry', 'Glowing effects']
    },
    FLAT_VECTOR: {
        id: 'flat_vector',
        name: 'Corporate Memphis',
        description: 'Modern flat vector illustration (Kurzgesagt, Corporate Memphis). Clean, geometric, minimalist.',
        outlines: 'No outlines. Shape-based definition.',
        rendering: 'Flat colors, subtle texture overlays (grain). No 3D depth.',
        lighting: 'No realistic lighting. Symbolic lighting.',
        colors: 'Pastel palette, harmonious colors. Low contrast.',
        antiPatterns: ['Black outlines', '3D rendering', 'Realistic textures', 'Complex details']
    }
};

function selectStyleForSite(siteId: string): VisualStyle {
    // SiteIDのハッシュに基づいて決定性を保ちつつスタイルを選択
    let hash = 0;
    for (let i = 0; i < siteId.length; i++) {
        hash = ((hash << 5) - hash) + siteId.charCodeAt(i);
        hash |= 0;
    }
    const styles = Object.values(VISUAL_STYLES);
    const index = Math.abs(hash) % styles.length;
    return styles[index];
}

// ============================================================
// Build Prompt
// ============================================================

function buildImagePrompt(
    archetype: MonsterArchetype,
    site: Site,
    monsterName: string,
    workSummary: string,
    traits: MonsterTraits
): string {
    // サイトごとにスタイルを決定
    const style = selectStyleForSite(site.id);

    return `Create a high-quality character asset in the style of [${style.name}].

**Visual Style & Art Direction (${style.name}):**
- **Aesthetic:** ${style.description}
- **Outlines:** ${style.outlines}
- **Rendering:** ${style.rendering}
- **Lighting:** ${style.lighting}
- **Colors:** ${style.colors}

**Character Specification:**
- **Archetype:** ${archetype.name_ja} (${archetype.name})
- **Name:** "${monsterName}"
- **Personality:** ${traits.personality.toUpperCase()} -> ${getPersonalityDescription(traits.personality)}
- **Context:** Construction monster.
- **Size:** ${traits.sizeLevel}

**Specific Details:**
- **Accessories:** ${traits.accessories.join(', ')}.
- **Features:** ${traits.visualEffects.join(', ')}.

**Anti-Patterns (Strictly Prohibited for this style):**
- ${style.antiPatterns.join('\n- ')}
- Text, Watermarks, UI elements.

Output: Single character, centered, full body.`;
}

// ============================================================
// Image Generation with Gemini
// ============================================================

async function generateImageWithGemini(prompt: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not set");
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Gemini 画像生成モデル
    const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash-exp-image-generation",
        generationConfig: {
            responseModalities: ["image", "text"],
        } as any,
    });

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;

        // レスポンスから画像データを抽出
        for (const candidate of response.candidates || []) {
            for (const part of candidate.content?.parts || []) {
                if ((part as any).inlineData) {
                    return (part as any).inlineData.data;
                }
            }
        }

        throw new Error("No image data in response");
    } catch (error: any) {
        console.error("Gemini image generation error:", error);
        throw new Error(`Image generation failed: ${error.message}`);
    }
}

// ============================================================
// Main Generation Function
// ============================================================

export async function generateMonsterImage(site: Site): Promise<MonsterGenerationResult> {
    const totalStart = Date.now();
    console.log(`[MonsterGen] Starting generation for site: ${site.name}`);

    // 0. 工事内容（取引データ）を取得してサマリーを作成
    const t0 = Date.now();
    const { data: transactions } = await supabaseAdmin
        .from("accounting_transactions")
        .select("description, vendor_name, amount_total, kind, status")
        .eq("site_id", site.id)
        .limit(10);
    console.log(`[MonsterGen] Fetch transactions: ${Date.now() - t0}ms`);

    const workSummary = (transactions || [])
        .map(tx => tx.description || tx.vendor_name)
        .filter(Boolean)
        .join(", ");

    // 1. マッチするアーキタイプを探す
    const t1 = Date.now();
    const archetype = await findMatchingArchetype(site.work_types || []);
    console.log(`[MonsterGen] Find archetype: ${Date.now() - t1}ms`);

    // 2. モンスター名を生成
    const { name: monsterName, nameJa: monsterNameJa } = generateMonsterName(site.name, archetype, workSummary);

    // 3. 属性を生成
    const attributes = generateAttributes(archetype, site.estimated_hours || 100);

    // 4. トレイトを抽出（取引データから動的に生成）
    const t2 = Date.now();
    const traits = extractTraitsFromTransactions(
        (transactions || []) as Transaction[],
        site.estimated_hours || 100,
        workSummary
    );
    console.log(`[MonsterGen] Extract traits: ${Date.now() - t2}ms`);

    // 5. Cartoonスタイルプロンプトを構築
    const prompt = buildImagePrompt(archetype, site, monsterName, workSummary, traits);
    console.log(`[MonsterGen] Prompt built (${prompt.length} chars)`);

    // 6. 画像を生成
    const t3 = Date.now();
    console.log("[MonsterGen] Requesting image from Gemini...");
    const imageBase64 = await generateImageWithGemini(prompt);
    console.log(`[MonsterGen] Gemini generation: ${Date.now() - t3}ms`);

    console.log(`[MonsterGen] Total duration: ${Date.now() - totalStart}ms`);

    return {
        imageBase64,
        monsterName,
        monsterNameJa,
        archetypeId: archetype.id,
        archetypeName: archetype.name,
        attributes,
        promptUsed: prompt,
    };
}

// ============================================================
// Get Archetype by ID
// ============================================================

export async function getArchetypeById(id: string): Promise<MonsterArchetype | null> {
    const { data, error } = await supabaseAdmin
        .from("monster_archetypes")
        .select("*")
        .eq("id", id)
        .single();

    if (error) return null;
    return data;
}

// ============================================================
// Get All Archetypes
// ============================================================

export async function getAllArchetypes(): Promise<MonsterArchetype[]> {
    const { data, error } = await supabaseAdmin
        .from("monster_archetypes")
        .select("*")
        .order("name");

    if (error) throw error;
    return data || [];
}
