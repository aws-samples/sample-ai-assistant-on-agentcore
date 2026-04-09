import React, { createContext, useContext, useMemo } from "react";

const ThemeContext = createContext();

export const ThemeProvider = ({ children, colorMode, effectiveTheme, setThemeMode }) => {
  const value = useMemo(
    () => ({
      colorMode, // "system", "light", or "dark"
      effectiveTheme, // The actual theme being used ("light" or "dark")
      setThemeMode, // Function to change the theme
      isDark: effectiveTheme === "dark", // Convenience boolean
    }),
    [colorMode, effectiveTheme, setThemeMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// Custom hook for using the theme
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    // Return a default context instead of throwing
    // This allows components to work outside ThemeProvider
    return {
      colorMode: "system",
      effectiveTheme: "light",
      setThemeMode: () => {},
      isDark: false,
    };
  }
  return context;
};
