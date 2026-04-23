jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import {
  PATH_POLICY_BUNDLE_KEY,
  PathPolicyBundleService,
  buildDefaultPathPolicyBundle,
  hashStableRecord,
  stableJsonStringify,
} from "../../services/PathPolicyBundleService";
import { createChain, setupMockFrom } from "../helpers/mockSupabase";
import { supabaseAdmin } from "../../lib/supabaseAdmin";

describe("PathPolicyBundleService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stableJsonStringify sorts object keys deterministically", () => {
    expect(stableJsonStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(hashStableRecord({ b: 2, a: 1 })).toBe(hashStableRecord({ a: 1, b: 2 }));
  });

  it("falls back to default active bundle when no row exists", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      policy_bundle_versions: createChain({ data: [], error: null }),
    });

    const bundle = await new PathPolicyBundleService(
      "00000000-0000-0000-0000-000000000001",
    ).resolveActiveBundle("2026-04");

    expect(bundle.bundle_key).toBe(PATH_POLICY_BUNDLE_KEY);
    expect(bundle.status).toBe("active");
    expect(bundle.fingerprint).toBe(buildDefaultPathPolicyBundle(bundle.org_id).fingerprint);
  });

  it("builds publish payload with fingerprint and defaults", () => {
    const payload = new PathPolicyBundleService(
      "00000000-0000-0000-0000-000000000001",
    ).buildPublishPayload(
      {
        effective_from: "2026-04",
      },
      {
        type: "human",
        id: "11111111-1111-4111-8111-111111111111",
        name: "管理者",
      },
    );

    expect(payload).toEqual(
      expect.objectContaining({
        module: "path",
        bundle_key: PATH_POLICY_BUNDLE_KEY,
        effective_from: "2026-04-01",
      }),
    );
    expect(typeof payload.fingerprint).toBe("string");
    expect(String(payload.fingerprint).length).toBeGreaterThan(10);
  });
});
