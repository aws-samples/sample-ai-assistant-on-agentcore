import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sparkyModelConfig } from "@/config";

const MODEL_OPTIONS = sparkyModelConfig.models;
const DEFAULT_MODEL_ID = sparkyModelConfig.defaultModelId;
const MODEL_STORAGE_KEY = "selectedModelId";

/**
 * NavMain component renders the main navigation items in the sidebar.
 *
 *
 * @param {Object} props
 * @param {Array} props.items - Array of navigation items with title, url, icon, isSearch
 * @param {Function} props.onNewChat - Callback to clear session and start new chat
 * @param {Function} props.onSearchClick - Callback to open search command palette
 * @param {boolean} props.showModelSelector - Whether to show the model selector item
 */
export function NavMain({ items, onNewChat, onSearchClick, showModelSelector }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useSidebar();

  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    return (
      MODEL_OPTIONS.find((m) => m.id === saved) ||
      MODEL_OPTIONS.find((m) => m.id === DEFAULT_MODEL_ID) ||
      MODEL_OPTIONS[0]
    );
  });

  const handleModelSelect = (model) => {
    setSelectedModel(model);
    localStorage.setItem(MODEL_STORAGE_KEY, model.id);
    window.dispatchEvent(new CustomEvent("modelChanged", { detail: { modelId: model.id } }));
  };

  /**
   * Handles navigation item click.
   * For "New Chat" item, clears session and navigates to root.
   * For "Search" item, opens the search command palette.
   */
  const handleNavigation = (item) => {
    // Handle search button click
    if (item.isSearch && onSearchClick) {
      onSearchClick();
      return;
    }

    if (item.title === "New Chat" && onNewChat) {
      onNewChat();
    }
    navigate(item.url);
  };

  /**
   * Determines if a navigation item is active based on current route.
   * For the home route ("/"), only exact match is considered active.
   * For other routes, checks if current path starts with the item's url.
   * Search button is never "active" as it opens a modal.
   */
  const isItemActive = (item) => {
    // Search button doesn't have a URL and is never "active"
    if (item.isSearch || !item.url) {
      return false;
    }
    if (item.url === "/") {
      return location.pathname === "/" || location.pathname === "/chat";
    }
    return location.pathname.startsWith(item.url);
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = isItemActive(item);

            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={
                    item.shortcut
                      ? `${item.title} (${item.shortcut.modifier}${item.shortcut.key})`
                      : item.title
                  }
                  isActive={isActive}
                  onClick={() => handleNavigation(item)}
                >
                  {Icon && <Icon className="size-4" />}
                  <span className="flex-1">{item.title}</span>
                  {item.shortcut && (
                    <span
                      className="pointer-events-none ml-auto select-none text-muted-foreground"
                      style={{ fontFamily: "ui-monospace, monospace" }}
                    >
                      <span style={{ fontSize: "1rem", position: "relative", top: "2px" }}>
                        {item.shortcut.modifier}
                      </span>
                      <span style={{ fontSize: "0.75rem" }}>{item.shortcut.key}</span>
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
          {showModelSelector && (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                    <span className="truncate flex-1">{selectedModel?.label}</span>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-56 rounded-lg"
                  side={isMobile ? "bottom" : "right"}
                  align="start"
                  sideOffset={14}
                >
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Choose model
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {MODEL_OPTIONS.map((model) => (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => handleModelSelect(model)}
                        className="cursor-pointer"
                      >
                        <span>{model.label}</span>
                        {selectedModel?.id === model.id && <Check className="ml-auto size-4" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export default NavMain;
