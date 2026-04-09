import { ScrollButton } from "./ScrollButton";
import React, { memo } from "react";

/**
 * ScrollToBottomButton Component
 *
 * Wrapper component that positions the scroll button.
 * When clicked, triggers smooth scroll to bottom.
 */
const ScrollToBottomButton = memo(function ScrollToBottomButton({ scroll }) {
  return (
    <div className="scroll-view">
      <ScrollButton onClick={scroll} direction="bottom" />
    </div>
  );
});

export default ScrollToBottomButton;
