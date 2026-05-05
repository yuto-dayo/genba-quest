const mockGenerateText = jest.fn();
const mockGetAIProvider = jest.fn(() => ({
  generateText: mockGenerateText,
}));
const mockGetAvailableProviders = jest.fn();
const mockGetDefaultProviderName = jest.fn(() => "gemini");

jest.mock("../../services/aiClient", () => ({
  getAIProvider: mockGetAIProvider,
  getAvailableProviders: mockGetAvailableProviders,
  getDefaultProviderName: mockGetDefaultProviderName,
}));

import { PathRewardAnalysisService } from "../../services/PathRewardAnalysisService";
import type { PathRewardQaResponse } from "../../services/PathGovernedModuleService";

describe("PathRewardAnalysisService", () => {
  const evidenceRef = {
    kind: "section" as const,
    label: "金額の理由",
    anchor: "reward-reasons",
  };
  const bundle = {
    context: {
      estimated_amount: 160000,
      delta_amount: 10000,
      site_breakdown: [
        {
          label: "渋谷マンション",
          amount: 80000,
          reflected_ratio: 0.6,
          correction_state: "あり" as const,
          reason_summary: "自分の寄与だけの説明",
          own_contribution: {
            floor_amount: 45000,
            result_amount: 30000,
            correction_amount: 5000,
            credited_units: 12,
            reason_lines: ["稼働ユニットが反映されています。"],
          },
          anonymous_relative_position: {
            participant_count: 4,
            self_band: "top" as const,
          },
          evidence_keys: ["ev_1"],
        },
      ],
      corrections: {
        total_amount: 5000,
        applied_amount: 5000,
        count: 1,
        has_corrections: true,
        items: [
          {
            status: "executed",
            reason: "late_quality_fix",
            amount: 5000,
            correction_month: "2026-05",
            target_month: "2026-04",
            mode: "adjustment" as const,
            evidence_keys: ["ev_1"],
          },
        ],
      },
      rule_version: "path_v31",
      evidence_refs: [
        {
          evidence_key: "ev_1",
          kind: "section" as const,
          label: "金額の理由",
          anchor: "reward-reasons",
        },
      ],
    },
    evidenceMap: new Map([["ev_1", evidenceRef]]),
  };
  const fallbackAnswer: PathRewardQaResponse = {
    conclusion: "fallback",
    amount_breakdown: [
      {
        label: "今月の見込み",
        amount: 160000,
        detail: "fallback detail",
        evidence_refs: [evidenceRef],
      },
    ],
    why_changed: ["fallback reason"],
    adjustments: [],
    evidence_refs: [evidenceRef],
    next_action: null,
    confidence: "low",
  };
  const fallback = jest.fn(() => fallbackAnswer);

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDefaultProviderName.mockReturnValue("gemini");
    mockGetAvailableProviders.mockReturnValue(["gemini"]);
    mockGenerateText.mockResolvedValue(
      JSON.stringify({
        conclusion: "今月の見込みは160000円です。",
        amount_breakdown: [
          {
            label: "今月の見込み",
            amount: 160000,
            detail: "contextの見込み額です。",
            evidence_keys: ["ev_1"],
          },
        ],
        why_changed: ["稼働ユニットが反映されています。"],
        adjustments: [
          {
            label: "来月調整",
            amount: 5000,
            detail: "反映済みの補正です。",
            evidence_keys: ["ev_1"],
          },
        ],
        evidence_keys: ["ev_1"],
        next_action: null,
        confidence: "medium",
      }),
    );
  });

  it("falls back when the configured provider has no API key", async () => {
    mockGetAvailableProviders.mockReturnValue([]);

    const result = await new PathRewardAnalysisService().analyzeRewardConfirmation(
      bundle,
      "金額の理由は？",
      fallback,
    );

    expect(result).toBe(fallbackAnswer);
    expect(mockGetAIProvider).not.toHaveBeenCalled();
  });

  it("falls back when the provider call fails", async () => {
    mockGenerateText.mockRejectedValue(new Error("provider down"));

    const result = await new PathRewardAnalysisService().analyzeRewardConfirmation(
      bundle,
      "金額の理由は？",
      fallback,
    );

    expect(result).toBe(fallbackAnswer);
  });

  it.each([
    ["invalid json", "not json"],
    [
      "missing required fields",
      JSON.stringify({
        conclusion: "金額です。",
        evidence_keys: ["ev_1"],
      }),
    ],
    [
      "unknown evidence key",
      JSON.stringify({
        conclusion: "金額です。",
        amount_breakdown: [
          {
            label: "今月の見込み",
            amount: 160000,
            detail: "contextの見込み額です。",
            evidence_keys: ["ev_missing"],
          },
        ],
        why_changed: ["理由があります。"],
        adjustments: [],
        evidence_keys: ["ev_missing"],
        next_action: null,
        confidence: "medium",
      }),
    ],
    [
      "no evidence",
      JSON.stringify({
        conclusion: "金額です。",
        amount_breakdown: [
          {
            label: "今月の見込み",
            amount: 160000,
            detail: "contextの見込み額です。",
            evidence_keys: [],
          },
        ],
        why_changed: ["理由があります。"],
        adjustments: [],
        evidence_keys: [],
        next_action: null,
        confidence: "medium",
      }),
    ],
    [
      "invented amount",
      JSON.stringify({
        conclusion: "金額です。",
        amount_breakdown: [
          {
            label: "謎の金額",
            amount: 123456,
            detail: "contextにない金額です。",
            evidence_keys: ["ev_1"],
          },
        ],
        why_changed: ["理由があります。"],
        adjustments: [],
        evidence_keys: ["ev_1"],
        next_action: null,
        confidence: "medium",
      }),
    ],
  ])("falls back on invalid LLM output: %s", async (_label, rawResponse) => {
    mockGenerateText.mockResolvedValue(rawResponse);

    const result = await new PathRewardAnalysisService().analyzeRewardConfirmation(
      bundle,
      "金額の理由は？",
      fallback,
    );

    expect(result).toBe(fallbackAnswer);
  });

  it("returns validated schema output and restores server-side evidence refs", async () => {
    const result = await new PathRewardAnalysisService().analyzeRewardConfirmation(
      bundle,
      "金額の理由は？",
      fallback,
    );

    expect(result).toEqual(
      expect.objectContaining({
        conclusion: "今月の見込みは160000円です。",
        amount_breakdown: [
          expect.objectContaining({
            amount: 160000,
            evidence_refs: [evidenceRef],
          }),
        ],
        adjustments: [
          expect.objectContaining({
            amount: 5000,
            evidence_refs: [evidenceRef],
          }),
        ],
        evidence_refs: [evidenceRef],
        confidence: "medium",
      }),
    );
    expect(fallback).not.toHaveBeenCalled();
  });
});
