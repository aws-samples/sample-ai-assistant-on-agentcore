import React, { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Renders images retrieved from the Code Interpreter session.
 * Displays all images in a horizontal scrollable slider with a zoom modal.
 */
const RetrievedImages = React.memo(({ imageContent }) => {
  const [zoomIndex, setZoomIndex] = useState(null);

  if (!Array.isArray(imageContent) || imageContent.length === 0) return null;

  const imagePairs = [];
  for (let i = 0; i < imageContent.length; i++) {
    const block = imageContent[i];
    if (block.type === "image" && block.source?.data) {
      const prevBlock = imageContent[i - 1];
      const label = prevBlock?.type === "text" ? prevBlock.text : null;
      imagePairs.push({ label, source: block.source });
    }
  }

  if (imagePairs.length === 0) return null;

  const zoomedPair =
    zoomIndex !== null && zoomIndex >= 0 && zoomIndex < imagePairs.length
      ? imagePairs[zoomIndex]
      : null;

  return (
    <>
      <div className="flex overflow-x-auto overflow-y-hidden gap-3 scroll-smooth w-full image-slider-scroll">
        {imagePairs.map((pair, index) => {
          const src = `data:${pair.source.media_type};base64,${pair.source.data}`;
          return (
            <div
              key={index}
              className="relative flex-shrink-0 group cursor-pointer"
              style={{ height: "275px" }}
              onClick={() => setZoomIndex(index)}
            >
              <img
                src={src}
                alt={pair.label || `Retrieved image ${index + 1}`}
                className="rounded-lg border border-border object-contain h-full w-auto"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomIndex(index);
                }}
                className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                aria-label="Zoom image"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              {pair.label && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-white bg-black/60 px-1.5 py-px rounded-full truncate max-w-[90%]">
                  {pair.label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <Dialog
        open={zoomedPair !== null}
        onOpenChange={(open) => {
          if (!open) setZoomIndex(null);
        }}
      >
        {zoomedPair && (
          <DialogContent
            className="!z-[9999] max-w-fit max-h-[70vh] p-2 flex items-center justify-center shadow-none [&>button]:!p-1 [&>button]:!rounded-md [&>button]:!bg-black/40 [&>button]:!text-white [&>button]:!opacity-100 [&>button]:!ring-0 [&>button]:!ring-offset-0 [&>button]:focus:!ring-0 [&>button]:focus:!ring-offset-0 [&>button:hover]:!bg-black/60"
            style={{ border: "none", backgroundColor: "transparent" }}
          >
            <DialogTitle className="sr-only">{zoomedPair.label || "Image preview"}</DialogTitle>
            <img
              src={`data:${zoomedPair.source.media_type};base64,${zoomedPair.source.data}`}
              alt={zoomedPair.label || `Retrieved image ${zoomIndex + 1}`}
              className="max-w-full max-h-[65vh] object-contain rounded-lg"
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
});

export default RetrievedImages;
