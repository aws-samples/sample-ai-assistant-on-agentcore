import React from "react";
import { Routes, Route, useParams } from "react-router-dom";
import Agent from "./pages/Agent/Agent";
import { ToolConfigPage } from "./pages/ToolConfig";
import { SkillsPage } from "./pages/Skills";
import { ProjectsPage } from "./pages/Projects";
import { ScheduledTasksPage } from "./pages/ScheduledTasks";

// Wrapper component to handle session ID from URL path
function AgentWrapper({ user }) {
  const { sessionId } = useParams();
  return <Agent user={user} sessionId={sessionId} />;
}

function Main({ user }) {
  return (
    <Routes>
      {/* Main route - Agent interface (new chat) */}
      <Route path="/" element={<Agent user={user} />} />
      {/* Chat route alias (new chat without session) */}
      <Route path="/chat" element={<Agent user={user} />} />
      {/* Tool Configuration route */}
      <Route path="/tools" element={<ToolConfigPage />} />
      {/* Skills Management route */}
      <Route path="/skills" element={<SkillsPage />} />
      {/* Projects route */}
      <Route path="/projects" element={<ProjectsPage />} />
      {/* Scheduled Tasks route */}
      <Route path="/scheduled-tasks" element={<ScheduledTasksPage />} />
      {/* Session route - Agent with session ID for chat persistence */}
      <Route path="/chat/:sessionId" element={<AgentWrapper user={user} />} />
    </Routes>
  );
}

export default Main;
