import { extractSiteDraftFromText } from "../../services/SiteDraftTextService";

describe("SiteDraftTextService", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("extracts a useful site draft from customer text", () => {
    const result = extractSiteDraftFromText(`
現場名: 渋谷オフィス改修工事
元請: 株式会社GENBA御中
住所: 東京都渋谷区渋谷1-2-3 渋谷ビル 4F
工期: 2026年4月20日〜2026年5月10日
作業内容: 軽鉄下地工事 20㎡ 単価 4500円
・ボード張り 20㎡ @ 1800円
注意: 搬入は8時以降、近隣配慮で大きな音は17時まで
平日作業でお願いします
    `);

    expect(result.name).toBe("渋谷オフィス改修工事");
    expect(result.client_name).toBe("株式会社GENBA");
    expect(result.address).toContain("東京都渋谷区");
    expect(result.started_at).toBe("2026-04-20");
    expect(result.expected_completion_at).toBe("2026-05-10");
    expect(result.schedule_mode).toBe("weekdays");
    expect(result.working_weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(result.cautions).toContain("搬入は8時以降");
    expect(result.line_items).toEqual([
      {
        item_name: "軽鉄下地工事 20㎡",
        quantity: 20,
        unit_name: "㎡",
        unit_price: 4500,
      },
      {
        item_name: "ボード張り 20㎡",
        quantity: 20,
        unit_name: "㎡",
        unit_price: 1800,
      },
    ]);
  });

  it("returns partial data when only a subset can be inferred", () => {
    const result = extractSiteDraftFromText(`
来週から新宿マンション内装工事です。
住所は東京都新宿区西新宿2-8-1。
注意事項は駐車場なしです。
    `);

    expect(result.name).toBe("来週から新宿マンション内装工事です。");
    expect(result.address).toContain("東京都新宿区");
    expect(result.cautions).toContain("駐車場なし");
    expect(result.line_items).toEqual([]);
    expect(result.detected_fields).toBeGreaterThanOrEqual(3);
  });

  it("infers yearless date ranges without logging strict parser warnings", () => {
    const result = extractSiteDraftFromText(`
4/20から5/10で渋谷のオフィス改修お願いします。
住所: 東京都渋谷区渋谷1-2-3
    `);

    expect(result.started_at).toBe("2026-04-20");
    expect(result.expected_completion_at).toBe("2026-05-10");
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("extracts only the caution segment from single-line notes", () => {
    const result = extractSiteDraftFromText(`
現場名: 渋谷オフィス改修工事 住所: 東京都渋谷区渋谷1-2-3 注意: 搬入は8時以降でお願いします
    `);

    expect(result.name).toBe("渋谷オフィス改修工事");
    expect(result.address).toBe("東京都渋谷区渋谷1-2-3");
    expect(result.cautions).toBe("搬入は8時以降でお願いします");
  });

  it("segments single-line labeled fields before mapping them", () => {
    const result = extractSiteDraftFromText(`
現場名: 渋谷オフィス改修工事 元請: 株式会社GENBA 住所: 東京都渋谷区渋谷1-2-3 作業内容: ボード張り 20㎡ @ 1800円 注意: 搬入は8時以降
    `);

    expect(result.name).toBe("渋谷オフィス改修工事");
    expect(result.client_name).toBe("株式会社GENBA");
    expect(result.address).toBe("東京都渋谷区渋谷1-2-3");
    expect(result.cautions).toBe("搬入は8時以降");
    expect(result.line_items).toEqual([
      {
        item_name: "ボード張り 20㎡",
        quantity: 20,
        unit_name: "㎡",
        unit_price: 1800,
      },
    ]);
  });

  it("extracts useful fields from a customer message without labels", () => {
    const result = extractSiteDraftFromText(`
吉野様
お世話になります。
アースリフォーム武藤です。7.8.9日に約80平米天井壁クロス張り替えお願いします。大泉町6-27-18矢崎邸、1階リビングキッチンのみ、在宅ですが荷物は無い状態、キッチンは新しいものに変えてからの張り替えです。駐車場はあります。
    `);

    expect(result.name).toBe("矢崎邸");
    expect(result.address).toBe("大泉町6-27-18");
    expect(result.client_name).toBe("吉野");
    expect(result.cautions).toContain("在宅ですが荷物は無い状態");
    expect(result.cautions).toContain("駐車場はあります");
    expect(result.line_items).toEqual([
      {
        item_name: "約80平米天井壁クロス張り替え",
        quantity: 80,
        unit_name: "平米",
        unit_price: null,
      },
    ]);
  });
});
