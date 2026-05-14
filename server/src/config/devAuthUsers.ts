export type DevAuthUserKey = "yuto" | "jay" | "teru" | "daito";
export type DevAuthRole = "admin" | "member";

export interface DevAuthUser {
  key: DevAuthUserKey;
  id: string;
  name: string;
  email: string;
  role: DevAuthRole;
}

export const DEV_AUTH_USERS: DevAuthUser[] = [
  {
    key: "yuto",
    id: "e93f3438-ae73-4c55-b2ab-a370d096bde0",
    name: "ユウト",
    email: "yuto@genba-quest.test",
    role: "admin",
  },
  {
    key: "jay",
    id: "22222222-2222-4222-8222-0000000000a2",
    name: "ジェイ",
    email: "jay@genba-quest.test",
    role: "member",
  },
  {
    key: "teru",
    id: "33333333-3333-4333-8333-0000000000a3",
    name: "テル",
    email: "teru@genba-quest.test",
    role: "member",
  },
  {
    key: "daito",
    id: "44444444-4444-4444-8444-0000000000a4",
    name: "ダイト",
    email: "daito@genba-quest.test",
    role: "member",
  },
];

const DEFAULT_PATH_DEV_ORG_ID = "1920a92b-d091-46a9-90c9-9d3a6bcab6a0";

export function isDevAuthMode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEV_SKIP_AUTH === "true";
}

export function isHostedSupabaseUrl(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export function assertDevAuthRemoteSafety(): void {
  if (!isDevAuthMode() || !isHostedSupabaseUrl(process.env.SUPABASE_URL)) {
    return;
  }

  throw new Error(
    "Unsafe dev auth configuration: DEV_SKIP_AUTH=true cannot be used with hosted Supabase. Use local Supabase (http://127.0.0.1:54321) for development auth."
  );
}

export function getDevDefaultOrgId(): string {
  return process.env.DEFAULT_ORG_ID || process.env.PATH_DEV_ORG_ID || DEFAULT_PATH_DEV_ORG_ID;
}

export function getDevAuthUserByKey(value: unknown): DevAuthUser | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return DEV_AUTH_USERS.find((user) => user.key === normalized) ?? null;
}

export function getDevAuthUserById(userId: string): DevAuthUser | null {
  return DEV_AUTH_USERS.find((user) => user.id === userId) ?? null;
}

export function getDefaultDevAuthUser(): DevAuthUser {
  return getDevAuthUserByKey(process.env.DEV_USER_KEY) ?? DEV_AUTH_USERS[0];
}
