import React from "react";
import { FileText, Image as ImageIcon, File } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ALLOWED_IMAGE_TYPES } from "./attachments";

/**
 * Format file size in human-readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
const formatFileSize = (bytes) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/**
 * Get the appropriate icon for a file type
 * @param {string} mimeType - The MIME type of the file
 * @returns {React.Component} The icon component
 */
const getFileIcon = (mimeType) => {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    return ImageIcon;
  }
  if (mimeType === "application/pdf") {
    return FileText;
  }
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    return FileText;
  }
  return File;
};

/**
 * AttachmentDisplay component for rendering attachments in chat history
 *
 * @param {Object} props
 * @param {Array} props.attachments - Array of attachment objects
 * @param {string} props.attachments[].name - File name
 * @param {string} props.attachments[].type - MIME type
 * @param {number} props.attachments[].size - File size in bytes
 * @param {string} [props.attachments[].data] - Base64 encoded data (for images)
 * @param {boolean} [props.showTooltip=true] - Whether to show tooltip on hover
 */
const AttachmentDisplay = React.memo(({ attachments, showTooltip = true }) => {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const renderAttachment = (attachment, index) => {
    const isImage = ALLOWED_IMAGE_TYPES.includes(attachment.type);
    const IconComponent = getFileIcon(attachment.type);

    return (
      <div key={`${attachment.name}-${index}`} className="attachment-display-item">
        {isImage && attachment.data ? (
          // Render image thumbnail
          <div className="attachment-thumbnail">
            <img
              src={`data:${attachment.type};base64,${attachment.data}`}
              alt={attachment.name}
              className="attachment-image"
            />
          </div>
        ) : (
          // Render document with icon and name
          <div className="attachment-document">
            <IconComponent size={16} className="attachment-icon" />
            <span className="attachment-name">{attachment.name}</span>
          </div>
        )}
      </div>
    );
  };

  // If tooltip is disabled, render without tooltip wrapper
  if (!showTooltip) {
    return <div className="attachment-display-container">{attachments.map(renderAttachment)}</div>;
  }

  return (
    <TooltipProvider>
      <div className="attachment-display-container">
        {attachments.map((attachment, index) => {
          const isImage = ALLOWED_IMAGE_TYPES.includes(attachment.type);
          const IconComponent = getFileIcon(attachment.type);
          // Handle case where size might not be present (e.g., from history)
          const tooltipContent = attachment.size
            ? `${attachment.name} (${formatFileSize(attachment.size)})`
            : attachment.name;

          return (
            <Tooltip key={`${attachment.name}-${index}`}>
              <TooltipTrigger asChild>
                <div className="attachment-display-item">
                  {isImage && attachment.data ? (
                    // Render image thumbnail
                    <div className="attachment-thumbnail">
                      <img
                        src={`data:${attachment.type};base64,${attachment.data}`}
                        alt={attachment.name}
                        className="attachment-image"
                      />
                    </div>
                  ) : (
                    // Render document with icon and name
                    <div className="attachment-document">
                      <IconComponent size={16} className="attachment-icon" />
                      <span className="attachment-name">{attachment.name}</span>
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              {/* Tooltip with file name and size */}
              <TooltipContent side="top">
                <p>{tooltipContent}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
});

AttachmentDisplay.displayName = "AttachmentDisplay";

export default AttachmentDisplay;
