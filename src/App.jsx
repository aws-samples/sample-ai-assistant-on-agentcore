import { useEffect, useState, useCallback } from "react";
import AppLayoutMFE from "./components/AppLayoutMFE/AppLayoutMFE";
import LoginPageInternal from "./pages/Landingpage/Landingpage";
import { getUser } from "./services/Auth/auth";
import { ChatSessionProvider } from "./components/Agent/ChatContext";
import { ThemeProvider } from "./components/ThemeContext";
import AppRefreshManager from "./AppRefreshManager";
import { SidebarProvider, SidebarInset } from "./components/ui/sidebar";
import { AppSidebar } from "./components/Sidebar";
import { Spinner } from "./components/ui/spinner";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";

const App = () => {
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState(null);

  const [colorMode, setColorMode] = useState(() => {
    const savedMode = localStorage.getItem("colorMode");
    return savedMode || "system";
  });

  // Make effectiveTheme a state variable
  const [effectiveTheme, setEffectiveTheme] = useState(() => {
    const getSystemTheme = () => {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    const getEffectiveTheme = (mode) => {
      if (mode === "system") {
        return getSystemTheme();
      }
      return mode;
    };
    return getEffectiveTheme(colorMode);
  });

  const getSystemTheme = () => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const getEffectiveTheme = (mode) => {
    if (mode === "system") {
      return getSystemTheme();
    }
    return mode;
  };

  const setThemeMode = (mode) => {
    const validModes = ["SYSTEM", "LIGHT", "DARK"];
    const normalizedMode = mode.toUpperCase();

    if (validModes.includes(normalizedMode)) {
      setColorMode(normalizedMode.toLowerCase());
    } else {
      console.warn(`Invalid theme mode: ${mode}. Valid options are: SYSTEM, LIGHT, DARK`);
    }
  };

  useEffect(() => {
    checkAuthState();
  }, []);

  useEffect(() => {
    const newEffectiveTheme = getEffectiveTheme(colorMode);
    setEffectiveTheme(newEffectiveTheme);
    localStorage.setItem("colorMode", colorMode);

    // Apply dark class to document for Tailwind dark mode
    if (newEffectiveTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleSystemThemeChange = () => {
      if (colorMode === "system") {
        const updatedEffectiveTheme = getEffectiveTheme(colorMode);
        setEffectiveTheme(updatedEffectiveTheme);

        // Update dark class for Tailwind dark mode
        if (updatedEffectiveTheme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      }
    };

    if (colorMode === "system") {
      mediaQuery.addEventListener("change", handleSystemThemeChange);
    }

    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, [colorMode]);

  // Handle new chat - navigation is handled by the sidebar
  const handleNewChat = useCallback(() => {
    // Navigate to root will be handled by the sidebar
  }, []);

  // Handle chat history updates from NavChats
  const handleHistoryUpdate = useCallback((history) => {
    // Can be used for any app-level state updates if needed
  }, []);

  const checkAuthState = async () => {
    setLoading(true);
    try {
      const user = await getUser();
      setAuthUser(user);
    } catch (error) {
      console.log(error);
      setAuthUser(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <ErrorBoundary
        fallback={({ reset }) => (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100vh",
              gap: "16px",
            }}
          >
            <p style={{ fontSize: "16px", color: "#666" }}>Something went wrong.</p>
            <button
              onClick={() => {
                reset();
                window.location.reload();
              }}
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                border: "1px solid #ddd",
                background: "#f5f5f5",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Reload
            </button>
          </div>
        )}
      >
        <ThemeProvider
          colorMode={colorMode}
          effectiveTheme={effectiveTheme}
          setThemeMode={setThemeMode}
        >
          {loading ? (
            <div className="flex items-center justify-center mt-5">
              <Spinner size="lg" />
            </div>
          ) : authUser ? (
            <AppRefreshManager>
              <ChatSessionProvider>
                <SidebarProvider defaultOpen={false}>
                  <AppSidebar
                    user={authUser}
                    colorMode={colorMode}
                    effectiveTheme={effectiveTheme}
                    setThemeMode={setThemeMode}
                    setAuthUser={checkAuthState}
                    onNewChat={handleNewChat}
                    onHistoryUpdate={handleHistoryUpdate}
                  />
                  <SidebarInset>
                    <AppLayoutMFE
                      user={authUser}
                      colorMode={colorMode}
                      setThemeMode={setThemeMode}
                    />
                  </SidebarInset>
                </SidebarProvider>
              </ChatSessionProvider>
            </AppRefreshManager>
          ) : (
            <LoginPageInternal setAuthUser={checkAuthState} />
          )}
          <Toaster />
        </ThemeProvider>
      </ErrorBoundary>
    </div>
  );
};

export default App;
