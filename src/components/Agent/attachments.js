/**
 * Attachment constants, validation, and encoding utilities.
 */
/* global FileReader, XMLHttpRequest */

// ── Constants ──

export const MAX_FILE_SIZE_BYTES = 115343360; // 110MB
export const MAX_SPREADSHEET_SIZE_BYTES = 115343360; // 110MB
export const S3_UPLOAD_THRESHOLD = 4718592; // 4.5MB — files larger than this use S3 presigned upload

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

export function formatFileSize(bytes) {
  if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)}MB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
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
    const limit = formatFileSize(getMaxFileSize(file.type));
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

export function shouldUseS3Upload(file) {
  return isSpreadsheetType(file.type) || file.size > S3_UPLOAD_THRESHOLD;
}

// ── Encoding & Uploading ──

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

export async function requestUploadUrls(files, opts) {
  const { endpoint, token, sessionId } = opts;
  const res = await fetch(`${endpoint}/invocations`, {
    method: "POST",

    body: JSON.stringify({
      input: {
        type: "get_upload_urls",
        files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      },
    }),
    // AgentCore requires session id header
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to request upload URLs");
  }
  const data = await res.json();
  if (data.type === "error") {
    throw new Error(data.message || "Failed to get upload URLs");
  }
  return data.files; // [{ upload_url, s3_key, index }]
}

export function uploadFileToS3(file, url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    // Some platforms may provide an empty `file.type`. Use a safe fallback
    const contentType = file.type || "application/octet-stream";
    try {
      xhr.setRequestHeader("Content-Type", contentType);
    } catch {
      // Some presigned PUT flows don't allow custom headers; ignore if header setting fails
    }

    // Add AWS specific headers sometimes required for pre-signed PUTs, but let's stick to standard first
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed due to network error"));
    xhr.send(file);
  });
}

export async function uploadAttachments(files, opts) {
  const { onProgress } = opts;
  const urlData = await requestUploadUrls(files, opts);
  const urlByIndex = new Map(urlData.map((entry) => [entry.index, entry]));

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const urlEntry = urlByIndex.get(i);
    if (!urlEntry) {
      throw new Error(`Missing upload URL for attachment index ${i}`);
    }
    const { upload_url, s3_key } = urlEntry;
    await uploadFileToS3(file, upload_url, (pct) => {
      if (onProgress) onProgress(i, pct);
    });
    results.push({ name: file.name, type: file.type, size: file.size, s3_key });
  }
  return results;
}
