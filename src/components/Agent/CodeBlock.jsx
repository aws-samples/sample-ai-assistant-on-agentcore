import React from "react";
import { CodeView } from "@/components/ui/code-view";
import { CopyButton } from "@/components/ui/copy-button";

export const CodeBlock = React.memo(({ code, language, width = "95%" }) => {
  return (
    <div className="code-block-container" style={{ width: width }}>
      <CodeView
        content={code}
        language={language || "bash"}
        actions={
          <CopyButton
            text={code}
            variant="icon"
            copyButtonAriaLabel="Copy code"
            copySuccessText="Code copied"
            copyErrorText="Code failed to copy"
          />
        }
      />
    </div>
  );
});
