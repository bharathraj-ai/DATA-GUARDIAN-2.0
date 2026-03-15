import { signOnlyOfficeToken } from './jwt';

/**
 * ONLYOFFICE Editor Configuration Builder
 *
 * Builds the JSON structure that ONLYOFFICE Document Server expects.
 * See: https://api.onlyoffice.com/docs/docs-api/usage-api/config/
 *
 * SECURITY: The entire config is signed with JWT so ONLYOFFICE can verify
 * the request originated from our trusted backend.
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface OnlyOfficeUser {
  id: string;
  name: string;
}

export interface DocumentInfo {
  fileId: string;
  fileName: string;
  fileType: string; // Extension without dot: "docx", "xlsx", etc.
  documentKey: string; // Unique key — changes when document changes
}

export interface EditorConfigOptions {
  document: DocumentInfo;
  user: OnlyOfficeUser;
  baseUrl: string; // e.g. http://localhost:3000
  mode?: 'edit' | 'view';
  lang?: string;
}

export interface OnlyOfficeConfig {
  document: {
    fileType: string;
    key: string;
    title: string;
    url: string;
    permissions: {
      download: boolean;
      edit: boolean;
      print: boolean;
      review: boolean;
    };
  };
  documentType: string;
  editorConfig: {
    callbackUrl: string;
    lang: string;
    mode: string;
    user: {
      id: string;
      name: string;
    };
    customization: {
      autosave: boolean;
      forcesave: boolean;
      chat: boolean;
      comments: boolean;
      compactHeader: boolean;
      feedback: boolean;
      help: boolean;
    };
  };
  token: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Map file extension to ONLYOFFICE document type.
 *
 * "word"  → Documents (docx, doc, odt, rtf, txt)
 * "cell"  → Spreadsheets (xlsx, xls, ods, csv)
 * "slide" → Presentations (pptx, ppt, odp)
 */
function getDocumentType(extension: string): string {
  const ext = extension.toLowerCase();

  const wordTypes = ['docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'epub', 'pdf'];
  const cellTypes = ['xlsx', 'xls', 'ods', 'csv'];
  const slideTypes = ['pptx', 'ppt', 'odp'];

  if (wordTypes.includes(ext)) return 'word';
  if (cellTypes.includes(ext)) return 'cell';
  if (slideTypes.includes(ext)) return 'slide';

  return 'word'; // Default fallback
}

// ─── Config Builder ─────────────────────────────────────────────────

/**
 * Build the full ONLYOFFICE editor configuration with embedded JWT token.
 *
 * The `url` field points to our secure file API — ONLYOFFICE will fetch
 * the file from here using the JWT for authentication.
 */
export function buildEditorConfig(options: EditorConfigOptions): OnlyOfficeConfig {
  const { document, user, baseUrl, mode = 'edit', lang = 'en' } = options;

  const isEditable = mode === 'edit';

  // Build the config payload (without token — token signs this payload)
  const payload = {
    document: {
      fileType: document.fileType,
      key: document.documentKey,
      title: document.fileName,
      url: `${baseUrl}/api/files/${document.fileId}`,
      permissions: {
        download: true,
        edit: isEditable,
        print: true,
        review: isEditable,
      },
    },
    documentType: getDocumentType(document.fileType),
    editorConfig: {
      callbackUrl: `${baseUrl}/api/onlyoffice/callback`,
      lang,
      mode: isEditable ? 'edit' : 'view',
      user: {
        id: user.id,
        name: user.name,
      },
      customization: {
        autosave: true,
        forcesave: true,
        chat: false, // Disabled for security
        comments: isEditable,
        compactHeader: false,
        feedback: false,
        help: false,
      },
    },
  };

  // Sign the full payload so ONLYOFFICE can verify authenticity
  const token = signOnlyOfficeToken(payload);

  return {
    ...payload,
    token,
  };
}

/**
 * Get the ONLYOFFICE Document Server URL.
 * This is the URL where ONLYOFFICE JS API is served from.
 */
export function getOnlyOfficeServerUrl(): string {
  return process.env.ONLYOFFICE_SERVER_URL || 'http://localhost:8080';
}
