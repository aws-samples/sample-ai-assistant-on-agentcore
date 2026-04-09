import React from "react";
import { Avatar } from "@/components/ui/avatar";

function getInitials(firstName, surname) {
  return ((firstName?.[0] || "") + (surname?.[0] || "")).toUpperCase();
}

const MessageAvatar = ({ isUser, firstName, surname, loading }) => {
  return isUser ? (
    <Avatar
      size="sm"
      ariaLabel={`${firstName} ${surname}`}
      initials={getInitials(firstName, surname)}
      tooltipText={`${firstName} ${surname}`}
      tooltipSide="right"
    />
  ) : (
    <Avatar
      size="sm"
      ariaLabel="Sparky"
      color="gen-ai"
      iconName="gen-ai"
      tooltipText="Sparky"
      loading={loading}
    />
  );
};

export default MessageAvatar;
