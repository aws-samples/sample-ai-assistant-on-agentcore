/**
 * Attachment constants, validation, and encoding utilities.
 */

// ── Constants ──

export const MAX_FILE_SIZE_BYTES = 4718592; // 4.5MB
export const MAX_SPREADSHEET_SIZE_BYTES = 52428800; // 50MB

export const SPREADSHEET_TYPES = [
  "text/csv",
  "text/yaml",
  "application/x-yaml",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/json",
  "text/yaml",
  "application/x-yaml",
  "text/plain",
  "text/csv",
  "text/html",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES];

// ── Validation ──

export function validateFileType(mimeType) {
  if (!mimeType || typeof mimeType !== "string") return false;
  return ALLOWED_TYPES.includes(mimeType);
}

export function isSpreadsheetType(mimeType) {
  return SPREADSHEET_TYPES.includes(mimeType);
}

export function getMaxFileSize(mimeType) {
  return isSpreadsheetType(mimeType) ? MAX_SPREADSHEET_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
}

export function validateFileSize(sizeInBytes, mimeType) {
  if (typeof sizeInBytes !== "number" || sizeInBytes < 0) return false;
  return sizeInBytes <= getMaxFileSize(mimeType);
}

export function validateAttachment(file) {
  if (!file) return { valid: false, error: "No file provided" };
  if (!validateFileType(file.type)) return { valid: false, error: "unsupported_type", file };
  if (!validateFileSize(file.size, file.type))
    return { valid: false, error: "file_too_large", file };
  return { valid: true, file };
}

export function getValidationErrorMessage(file) {
  if (!file) return "No file provided";
  const result = validateAttachment(file);
  if (result.valid) return "";

  const filename = file.name || "Unknown file";
  if (result.error === "unsupported_type") {
    const exts =
      "JPEG, PNG, GIF, WebP, PDF, JSON, YAML, YML, TXT, CSV, HTML, MD, DOC, DOCX, XLS, XLSX, PPT, PPTX";
    return `File "${filename}": File type not supported. Allowed: ${exts}`;
  }
  if (result.error === "file_too_large") {
    const limit = isSpreadsheetType(file.type) ? "50MB" : "4.5MB";
    return `File "${filename}": File exceeds maximum size of ${limit}`;
  }
  return `File "${filename}": Validation failed`;
}

export function isImageType(mimeType) {
  return ALLOWED_IMAGE_TYPES.includes(mimeType);
}
export function isDocumentType(mimeType) {
  return ALLOWED_DOCUMENT_TYPES.includes(mimeType);
}

// ── Encoding ──

export async function fileToBase64(file) {
  if (!file) throw new Error("No file provided");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        reject(new Error(`Failed to read file: ${file.name}`));
        return;
      }
      const idx = dataUrl.indexOf(",");
      if (idx === -1) {
        reject(new Error(`Failed to encode file: ${file.name}`));
        return;
      }
      resolve(dataUrl.substring(idx + 1));
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function encodeAttachments(files) {
  if (!files || !Array.isArray(files) || files.length === 0) return [];
  return Promise.all(
    files.map(async (file) => {
      const base64Data = await fileToBase64(file);
      return { name: file.name, type: file.type, size: file.size, data: base64Data };
    })
  );
}
