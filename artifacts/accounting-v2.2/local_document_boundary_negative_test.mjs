#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = new URL("../../", import.meta.url).pathname;
const serverDir = new URL("../../server/", import.meta.url).pathname;
const localSupabaseUrl = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const port = Number(process.env.ACCOUNTING_V22_DOCUMENT_TEST_PORT || 4020);
const actorUserId = "e93f3438-ae73-4c55-b2ab-a370d096bde0";
const orgAId = randomUUID();
const orgBId = randomUUID();
const orgAMembershipId = randomUUID();
const orgBMembershipId = randomUUID();
const orgBClientId = randomUUID();
const orgBSiteId = randomUUID();
const orgBDocumentId = randomUUID();
const orgBDrawingId = randomUUID();
const orgBDrawingVersionId = randomUUID();
const keySuffix = orgAId.replaceAll("-", "").slice(0, 12);

let serverProcess = null;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await sleep(300);
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  }
});

async function main() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || readLocalServiceRoleKey();
  await prepareFixture();
  serverProcess = startServer(serviceRoleKey);
  await waitForHealth();

  const cases = [
    {
      name: "site_documents_foreign_site",
      expectedStatus: 404,
      request: () => get(`/api/v1/sites/${orgBSiteId}/documents`),
      expectedError: "Site not found",
    },
    {
      name: "site_drawings_foreign_site",
      expectedStatus: 404,
      request: () => get(`/api/v1/sites/${orgBSiteId}/drawings`),
      expectedError: "Site not found",
    },
  ];

  const negativeResults = [];
  for (const testCase of cases) {
    const response = await testCase.request();
    negativeResults.push({
      name: testCase.name,
      expected_status: testCase.expectedStatus,
      status: response.status,
      error: response.body?.error || null,
    });
    assert(response.status === testCase.expectedStatus, `${testCase.name}: expected ${testCase.expectedStatus}, got ${response.status}`);
    assert(response.body?.error === testCase.expectedError, `${testCase.name}: expected ${testCase.expectedError}, got ${JSON.stringify(response.body)}`);
  }

  const counts = await fetchCounts();
  assert(counts.org_a_documents === 0, `Expected no org A documents, got ${counts.org_a_documents}`);
  assert(counts.org_a_drawing_versions === 0, `Expected no org A drawing versions, got ${counts.org_a_drawing_versions}`);
  assert(counts.org_b_documents === 1, `Expected one org B document, got ${counts.org_b_documents}`);
  assert(counts.org_b_drawing_versions === 1, `Expected one org B drawing version, got ${counts.org_b_drawing_versions}`);
  assert(counts.org_b_document_paths_prefixed === 1, `Expected org B document path prefix, got ${counts.org_b_document_paths_prefixed}`);
  assert(counts.org_b_drawing_paths_prefixed === 1, `Expected org B drawing path prefix, got ${counts.org_b_drawing_paths_prefixed}`);

  console.log(JSON.stringify({
    fixture: {
      active_org_id: orgAId,
      foreign_org_id: orgBId,
      actor_user_id: actorUserId,
      active_membership_id: orgAMembershipId,
      foreign_membership_id: orgBMembershipId,
      foreign_site_id: orgBSiteId,
      foreign_document_id: orgBDocumentId,
      foreign_drawing_id: orgBDrawingId,
      foreign_drawing_version_id: orgBDrawingVersionId,
    },
    negative_results: negativeResults,
    row_counts: counts,
    assertions: {
      active_org_foreign_site_document_routes_hidden_as_404: true,
      active_org_foreign_site_drawing_routes_hidden_as_404: true,
      foreign_document_and_drawing_paths_are_org_prefixed: true,
      no_active_org_document_rows_from_foreign_ids: true,
    },
  }, null, 2));
}

function readLocalServiceRoleKey() {
  const status = spawnSync("supabase", ["status"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (status.status !== 0) {
    throw new Error(`supabase status failed: ${status.stderr || status.stdout}`);
  }

  const match = status.stdout.match(/Secret\s*│\s*([^\s│]+)/);
  if (!match?.[1]) {
    throw new Error("Could not parse local Supabase secret key from supabase status");
  }
  return match[1];
}

async function prepareFixture() {
  runPsql(`
insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
values (
  '${actorUserId}',
  'authenticated',
  'authenticated',
  'v22-document-boundary-yuto-${keySuffix}@example.test',
  'local-not-used',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false,
  false,
  now(),
  now()
)
on conflict (id) do update
set email = excluded.email,
    email_confirmed_at = excluded.email_confirmed_at,
    updated_at = now();

insert into public.profiles (id, username, full_name, role, updated_at)
values (
  '${actorUserId}',
  'v22-document-boundary-yuto-${keySuffix}',
  'v2.2 Document Boundary Actor',
  'admin',
  now()
)
on conflict (id) do update
set username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    updated_at = now();

insert into public.organizations (id, slug, name, status)
values
  ('${orgAId}', 'v22-doc-a-${keySuffix}', 'v2.2 Document Boundary A', 'active'),
  ('${orgBId}', 'v22-doc-b-${keySuffix}', 'v2.2 Document Boundary B', 'active');

insert into public.org_memberships (
  id,
  org_id,
  user_id,
  role,
  status,
  title,
  approval_limit,
  joined_at
)
values
  ('${orgAMembershipId}', '${orgAId}', '${actorUserId}', 'admin', 'active', 'Owner A', 1000000, now()),
  ('${orgBMembershipId}', '${orgBId}', '${actorUserId}', 'admin', 'active', 'Owner B', 1000000, now());

insert into public.clients (
  id,
  org_id,
  name,
  billing_name,
  billing_address
)
values (
  '${orgBClientId}',
  '${orgBId}',
  'Org B Client',
  'Org B Billing',
  'Tokyo'
);

insert into public.sites (
  id,
  org_id,
  client_id,
  name,
  address,
  status,
  revenue,
  start_date,
  end_date
)
values (
  '${orgBSiteId}',
  '${orgBId}',
  '${orgBClientId}',
  'Org B Site With Documents',
  'Tokyo',
  'active',
  110000,
  date '2026-05-01',
  date '2026-05-09'
);

insert into public.documents (
  id,
  org_id,
  doc_type,
  storage_path,
  original_filename,
  mime_type,
  file_size,
  uploaded_by,
  site_id,
  client_id,
  field_provenance
)
values (
  '${orgBDocumentId}',
  '${orgBId}',
  'other',
  '${orgBId}/sites/${orgBSiteId}/documents/${actorUserId}/foreign.pdf',
  'foreign.pdf',
  'application/pdf',
  10,
  '${actorUserId}',
  '${orgBSiteId}',
  '${orgBClientId}',
  '{}'::jsonb
);

insert into public.site_drawings (
  id,
  org_id,
  site_id,
  title,
  drawing_no,
  discipline,
  status,
  latest_version_no,
  current_version_id,
  created_by
)
values (
  '${orgBDrawingId}',
  '${orgBId}',
  '${orgBSiteId}',
  'Foreign Drawing',
  'D-001',
  'general',
  'active',
  1,
  null,
  '${actorUserId}'
);

insert into public.site_drawing_versions (
  id,
  org_id,
  site_id,
  drawing_id,
  version_no,
  storage_bucket,
  storage_path,
  original_filename,
  mime_type,
  file_size,
  sha256,
  uploaded_by,
  status
)
values (
  '${orgBDrawingVersionId}',
  '${orgBId}',
  '${orgBSiteId}',
  '${orgBDrawingId}',
  1,
  'genba-drawings',
  '${orgBId}/sites/${orgBSiteId}/drawings/${orgBDrawingId}/v1/foreign.pdf',
  'foreign.pdf',
  'application/pdf',
  10,
  repeat('0', 64),
  '${actorUserId}',
  'active'
);

update public.site_drawings
set current_version_id = '${orgBDrawingVersionId}'
where id = '${orgBDrawingId}'
  and org_id = '${orgBId}';
`);
}

function startServer(serviceRoleKey) {
  const child = spawn("npx", ["ts-node", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      DEV_SKIP_AUTH: "true",
      DEV_USER_KEY: "yuto",
      DEFAULT_ORG_ID: orgAId,
      SUPABASE_URL: localSupabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[server:error] ${chunk}`));
  return child;
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the server is ready.
    }
    await sleep(300);
  }
  throw new Error(`Server did not become healthy on port ${port}`);
}

async function get(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "GET",
    headers: {
      "x-dev-user-key": "yuto",
    },
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  let body = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

async function fetchCounts() {
  const sql = `
select jsonb_build_object(
  'org_a_documents', (select count(*) from public.documents where org_id = '${orgAId}'),
  'org_a_drawing_versions', (select count(*) from public.site_drawing_versions where org_id = '${orgAId}'),
  'org_b_documents', (select count(*) from public.documents where org_id = '${orgBId}'),
  'org_b_drawing_versions', (select count(*) from public.site_drawing_versions where org_id = '${orgBId}'),
  'org_b_document_paths_prefixed', (
    select count(*)
    from public.documents
    where org_id = '${orgBId}'
      and storage_path like '${orgBId}/%'
  ),
  'org_b_drawing_paths_prefixed', (
    select count(*)
    from public.site_drawing_versions
    where org_id = '${orgBId}'
      and storage_path like '${orgBId}/%'
  )
)::text;
`;
  const output = runPsql(sql).trim();
  const jsonLine = output.split("\n").find((line) => line.trim().startsWith("{"));
  if (!jsonLine) {
    throw new Error(`Could not parse count JSON from psql output: ${output}`);
  }
  return JSON.parse(jsonLine);
}

function runPsql(sql) {
  const result = spawnSync("docker", [
    "exec",
    "-i",
    "supabase_db_genba-quest",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-t",
    "-A",
  ], {
    input: sql,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
