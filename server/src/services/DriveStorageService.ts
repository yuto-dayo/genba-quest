import { Readable } from "stream";
import { google, drive_v3, Auth } from "googleapis";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

export interface DriveUploadResult {
  fileId: string;
  url: string;
  folderId: string;
}

export interface DriveDownloadResult {
  buffer: Buffer;
  mimeType: string;
}

interface DriveServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function decodeJsonCandidate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }

  try {
    return Buffer.from(trimmed, "base64").toString("utf-8");
  } catch {
    return trimmed;
  }
}

function loadServiceAccountCredentials(): DriveServiceAccountCredentials | null {
  const rawJson =
    normalizeString(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) ||
    normalizeString(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  if (rawJson) {
    try {
      const parsed = JSON.parse(decodeJsonCandidate(rawJson)) as Partial<DriveServiceAccountCredentials>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      // ignore and try split env vars below
    }
  }

  const clientEmail =
    normalizeString(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL) ||
    normalizeString(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const privateKey =
    normalizeString(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY) ||
    normalizeString(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

function buildDriveAuth(): Auth.GoogleAuth | Auth.OAuth2Client {
  // サービスアカウント優先
  const sa = loadServiceAccountCredentials();
  if (sa) {
    return new google.auth.GoogleAuth({
      credentials: sa,
      scopes: DRIVE_SCOPES,
    });
  }

  // OAuth2 フォールバック（Gmail と同じ認証情報を流用）
  const clientId = normalizeString(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = normalizeString(process.env.GOOGLE_CLIENT_SECRET);
  const refreshToken = normalizeString(process.env.GOOGLE_DRIVE_REFRESH_TOKEN)
    || normalizeString(process.env.GOOGLE_REFRESH_TOKEN);

  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  throw new Error(
    "Google Drive credentials are missing. Set either GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON " +
    "or (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_DRIVE_REFRESH_TOKEN)."
  );
}

function ensureFileId(response: drive_v3.Schema$File | undefined): string {
  const fileId = response?.id;
  if (!fileId) {
    throw new Error("Google Drive API returned empty file id");
  }
  return fileId;
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.length === 0) {
    return `attachment-${Date.now()}`;
  }
  return trimmed.replace(/[\\/:*?"<>|]/g, "_");
}

function toDrivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view?usp=drive_link`;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => resolve());
    stream.on("error", (err) => reject(err));
  });
  return Buffer.concat(chunks);
}

export class DriveStorageService {
  private readonly drive: drive_v3.Drive;
  private readonly rootFolderId: string;
  private readonly folderCache = new Map<string, string>();

  constructor(rootFolderId: string) {
    const normalizedRoot = normalizeString(rootFolderId);
    if (!normalizedRoot) {
      throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID is required");
    }

    this.rootFolderId = normalizedRoot;
    const auth = buildDriveAuth();
    this.drive = google.drive({ version: "v3", auth });
    this.folderCache.set("root", this.rootFolderId);
  }

  async uploadAttachmentToDrive(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    siteId: string | null
  ): Promise<DriveUploadResult> {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error("uploadAttachmentToDrive requires a non-empty buffer");
    }

    const folderId = await this.resolveInboxFolderId(siteId);
    const resolvedMimeType = normalizeString(mimeType) || "application/octet-stream";
    const safeFilename = sanitizeFilename(filename);

    const response = await this.drive.files.create({
      requestBody: {
        name: safeFilename,
        parents: [folderId],
      },
      media: {
        mimeType: resolvedMimeType,
        body: Readable.from(buffer),
      },
      fields: "id",
      supportsAllDrives: true,
    });

    const fileId = ensureFileId(response.data);
    return {
      fileId,
      url: toDrivePreviewUrl(fileId),
      folderId,
    };
  }

  async downloadAttachmentFromDrive(fileId: string): Promise<DriveDownloadResult> {
    const normalizedFileId = normalizeString(fileId);
    if (!normalizedFileId) {
      throw new Error("downloadAttachmentFromDrive requires fileId");
    }

    const metadata = await this.drive.files.get({
      fileId: normalizedFileId,
      fields: "id,mimeType",
      supportsAllDrives: true,
    });

    const res = await this.drive.files.get(
      {
        fileId: normalizedFileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "stream" }
    );

    const stream = res.data as unknown as Readable;
    const buffer = await streamToBuffer(stream);

    return {
      buffer,
      mimeType: metadata.data.mimeType || "application/octet-stream",
    };
  }

  async moveFileToSiteInbox(fileId: string, siteId: string, currentFolderId?: string): Promise<string> {
    const normalizedFileId = normalizeString(fileId);
    const normalizedSiteId = normalizeString(siteId);
    if (!normalizedFileId || !normalizedSiteId) {
      throw new Error("moveFileToSiteInbox requires fileId and siteId");
    }

    const destinationFolderId = await this.resolveInboxFolderId(normalizedSiteId);
    const removeParents = normalizeString(currentFolderId) || (await this.getCurrentParentIds(normalizedFileId));

    await this.drive.files.update({
      fileId: normalizedFileId,
      addParents: destinationFolderId,
      removeParents,
      fields: "id,parents",
      supportsAllDrives: true,
    });

    return destinationFolderId;
  }

  private async getCurrentParentIds(fileId: string): Promise<string> {
    const res = await this.drive.files.get({
      fileId,
      fields: "parents",
      supportsAllDrives: true,
    });

    const parents = res.data.parents || [];
    return parents.join(",");
  }

  private async resolveInboxFolderId(siteId: string | null): Promise<string> {
    const normalizedSiteId = normalizeString(siteId);
    if (!normalizedSiteId) {
      return this.ensureFolderPath(["inbox"]);
    }
    return this.ensureFolderPath(["sites", normalizedSiteId, "inbox"]);
  }

  private async ensureFolderPath(path: string[]): Promise<string> {
    let parentId = this.rootFolderId;
    const keyParts: string[] = [];

    for (const segment of path) {
      keyParts.push(segment);
      const cacheKey = keyParts.join("/");
      const cached = this.folderCache.get(cacheKey);
      if (cached) {
        parentId = cached;
        continue;
      }

      const folderId = await this.findOrCreateFolder(parentId, segment);
      this.folderCache.set(cacheKey, folderId);
      parentId = folderId;
    }

    return parentId;
  }

  private async findOrCreateFolder(parentId: string, name: string): Promise<string> {
    const escapedName = escapeDriveQuery(name);
    const escapedParentId = escapeDriveQuery(parentId);
    const query =
      `'${escapedParentId}' in parents and name = '${escapedName}' and ` +
      `mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and trashed = false`;

    const list = await this.drive.files.list({
      q: query,
      fields: "files(id,name)",
      pageSize: 1,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    const existing = list.data.files?.[0];
    if (existing?.id) {
      return existing.id;
    }

    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: [parentId],
      },
      fields: "id",
      supportsAllDrives: true,
    });

    return ensureFileId(created.data);
  }
}

let driveStorageService: DriveStorageService | null = null;

export function getDriveStorageService(): DriveStorageService {
  if (!driveStorageService) {
    driveStorageService = new DriveStorageService(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "");
  }
  return driveStorageService;
}
