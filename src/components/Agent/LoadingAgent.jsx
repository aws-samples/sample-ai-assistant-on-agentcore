import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

function InputSkeleton({ style }) {
  return (
    <div
      style={{
        borderRadius: 24,
        border: "1px solid hsl(var(--border))",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "hsl(var(--background))",
        ...style,
      }}
    >
      <Skeleton className="h-5 w-48 rounded-md" />
      <Skeleton className="h-5 w-32 rounded-md" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-7 w-7 rounded-full" />
        </div>
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </div>
  );
}

function NewChatSkeleton() {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 780,
        margin: "0 auto",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 24px",
      }}
    >
      {/* Greeting */}
      <div style={{ marginBottom: 24 }}>
        <Skeleton className="h-7 w-32 mb-3 rounded-lg" />
        <Skeleton className="h-8 w-72 rounded-lg" />
      </div>

      <InputSkeleton />
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 780,
        margin: "0 auto",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: "32px 24px 16px",
        gap: 28,
        overflow: "hidden",
      }}
    >
      {/* User message */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Skeleton className="h-9 w-56 rounded-2xl" />
      </div>

      {/* Assistant response */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "75%" }}>
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-5/6 rounded-md" />
        <Skeleton className="h-4 w-4/6 rounded-md" />
      </div>

      {/* User message */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Skeleton className="h-9 w-72 rounded-2xl" />
      </div>

      {/* Assistant response */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "75%" }}>
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-5/6 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-3/4 rounded-md" />
        <Skeleton className="h-4 w-5/6 rounded-md" />
        <Skeleton className="h-4 w-1/2 rounded-md" />
      </div>

      {/* User message */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Skeleton className="h-9 w-48 rounded-2xl" />
      </div>

      {/* Assistant response (partial, fades out) */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "75%", opacity: 0.5 }}
      >
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-2/3 rounded-md" />
      </div>

      {/* Spacer pushes input to bottom */}
      <div style={{ flex: 1 }} />

      <InputSkeleton style={{ flexShrink: 0 }} />
    </div>
  );
}

const AgentLoader = ({ isNewChat }) => {
  return isNewChat ? <NewChatSkeleton /> : <HistorySkeleton />;
};

export default AgentLoader;
