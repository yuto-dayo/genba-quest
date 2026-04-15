export const DEFAULT_ORG_ID =
    process.env.DEFAULT_ORG_ID || "00000000-0000-0000-0000-000000000001";

export function resolveOrgId(orgId?: string): string {
    return orgId || DEFAULT_ORG_ID;
}
