import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  Users,
  User,
  Settings,
  ShieldCheck,
  BarChart3,
  Database,
  LogOut,
  ChevronDown,
  ChevronUp,
  Monitor,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    permission: "dashboard.view",
  },
  {
    title: "Claims",
    href: "/claims",
    icon: FileText,
    permission: "claims.view",
  },
  {
    title: "Re-Open Claims",
    href: "/fraud",
    icon: ShieldCheck,
    permission: "fraud.view",
  },

  {
    title: "Reports",
    href: "/reports",
    icon: BarChart3,
    permission: "reports.view",
  },
  {
    title: "Claim Digitization",
    href: "/claim-digitization",
    icon: Monitor,
    permission: "damage.view",
  },
  {
    title: "Invoice History",
    href: "/invoice-history",
    icon: FileText,
    permission: "damage.view",
  },
  {
    title: "Invoice Files Summary",
    href: "/invoice-files-summary",
    icon: FileText,
    permission: "damage.view",
  },
];

type AdminNavItem = {
  label: string;
  href: string;
  icon?: LucideIcon;
  permission?: string;
};

const adminSections: {
  title: string;
  icon: LucideIcon;
  baseMatch: string[];
  items: AdminNavItem[];
}[] = [
    {
      title: "User Management",
      icon: Users,
      baseMatch: ["/users", "/roles", "/roles/permissions"],
      items: [
        { label: "Users", href: "/users", icon: User },
        { label: "Roles", href: "/roles", icon: ShieldCheck },
        { label: "Role Permissions", href: "/roles/permissions", icon: Settings },
      ],
    },
    {
      title: "Master Data",
      icon: Database,
      baseMatch: ["/master-data"],
      items: [
        { label: "Damage Configuration", href: "/master-data?section=damage-types", permission: "damage_config.view" },
        { label: "Claim Configuration", href: "/master-data?section=thresholds", permission: "claim_config.view" },
        { label: "Business Rules", href: "/master-data?section=fraud-rules", permission: "fraud_rules.view" },
        { label: "Price Config", href: "/master-data?section=PriceConfig", permission: "price_config.view" },
      ],
    },
    // {
    //   title: "Settings",
    //   icon: Settings,
    //   baseMatch: ["/settings"],
    //   items: [{ label: "Settings", href: "/settings" }],
    // },
  ];

interface AppSidebarProps {
  open: boolean;
}

export function AppSidebar({ open }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, hasPermission, isAdmin, me } = useAuth();
  const canViewUsers = hasPermission("users.view") || isAdmin();
  const canViewRoles = hasPermission("roles.view") || isAdmin();
  const canViewRolePermissions = hasPermission("role_permissions.view") || isAdmin();
  const canViewMasterData =
    isAdmin() ||
    hasPermission("damage_config.view") ||
    hasPermission("claim_config.view") ||
    hasPermission("fraud_rules.view") ||
    hasPermission("price_config.view");
  const [userMgmtOpen, setUserMgmtOpen] = useState(
    location.pathname.startsWith("/users") ||
    location.pathname.startsWith("/roles"),
  );
  const [masterDataOpen, setMasterDataOpen] = useState(
    location.pathname.startsWith("/master-data"),
  );

  const [settingsOpen, setSettingsOpen] = useState(
    location.pathname.startsWith("/settings"),
  );

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const visibleAdminSections = useMemo(
    () =>
      adminSections.filter((section) => {
        if (section.title === "User Management")
          return canViewUsers || canViewRoles || canViewRolePermissions;
        if (section.title === "Master Data") return canViewMasterData;
        return true;
      }),
    [
      canViewUsers,
      canViewRoles,
      canViewRolePermissions,
      canViewMasterData,
    ],
  );

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border transition-transform duration-300",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">

              <img src="https://cdn.prod.website-files.com/68db19eaa5d5503f49fc8d2b/69b953d74e6ff752239f00fa_bt-logo-inverse.png" alt="Logo" className="h-14" />
            </h1>
            {/* <p className="text-xs text-sidebar-muted">Insurance Platform</p> */}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="space-y-1">
            {navItems
              .filter((item) => {
                // While /core/me/ loads, show links; then require permission (admin/staff get all via AuthContext).
                if (!me) return true;
                return hasPermission(item.permission);
              })
              .map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent"
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.title}
                </NavLink>
              ))}
          </div>

          {/* Administration section (hidden when user has no admin sub-sections) */}
          {visibleAdminSections.length > 0 && (
            <div className="pt-6">
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-muted">
                Administration
              </p>
              <div className="space-y-1">
                {visibleAdminSections.map((section) => {
                  const isMaster = section.title === "Master Data";
                  const isUserMgmt = section.title === "User Management";
                  const isSettings = section.title === "Settings";
                  const open =
                    (isMaster && masterDataOpen) ||
                    (isUserMgmt && userMgmtOpen) ||
                    (isSettings && settingsOpen);

                  const setOpen =
                    isMaster
                      ? setMasterDataOpen
                      : isUserMgmt
                        ? setUserMgmtOpen
                        : setSettingsOpen;

                  const isSectionActive = section.baseMatch.some((prefix) =>
                    location.pathname.startsWith(prefix),
                  );

                  return (
                    <Collapsible
                      key={section.title}
                      open={open}
                      onOpenChange={setOpen}
                      className="space-y-1"
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                            isSectionActive
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent",
                          )}
                        >
                          <span className="flex items-center gap-3">
                            <section.icon className="h-4 w-4" />
                            {section.title}
                          </span>
                          {open ? (
                            <ChevronUp className="h-4 w-4 text-sidebar-muted" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-sidebar-muted" />
                          )}
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-1 space-y-0.5 pl-9">
                          {section.items
                            .filter((item) => {
                              if (section.title === "User Management") {
                                if (item.href === "/users") return canViewUsers;
                                if (item.href === "/roles") return canViewRoles;
                                if (item.href === "/roles/permissions") return canViewRolePermissions;
                                return true;
                              }
                              if (section.title === "Master Data" && item.permission) {
                                return isAdmin() || hasPermission(item.permission);
                              }
                              return true;
                            })
                            .map((item) => {
                              const url = new URL(
                                item.href,
                                window.location.origin,
                              );
                              const isActive =
                                location.pathname === url.pathname &&
                                (isMaster
                                  ? // for master data, also consider section param
                                  (searchParams.get("section") ||
                                    "damage-types") ===
                                  (url.searchParams.get("section") ||
                                    "damage-types")
                                  : true);
                              const ItemIcon = item.icon;

                              return (
                                <NavLink
                                  key={item.href}
                                  to={item.href}
                                  className={() =>
                                    cn(
                                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                                      isActive
                                        ? "bg-sidebar-accent text-sidebar-primary"
                                        : "text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                                    )
                                  }
                                >
                                  {ItemIcon && (
                                    <ItemIcon className="h-3.5 w-3.5 shrink-0" />
                                  )}
                                  {item.label}
                                </NavLink>
                              );
                            })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {/* User section */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-accent text-sm font-medium text-sidebar-foreground">
              {(user?.first_name || user?.last_name || user?.username || "U")
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user
                  ? `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
                  user.username
                  : "Guest"}
              </p>
              <p className="text-xs text-sidebar-muted truncate">
                {user ? (isAdmin() ? "Administrator" : "User") : ""}
              </p>
            </div>
            <button
              type="button"
              aria-label="Log out"
              title="Log out"
              className="p-1.5 rounded-md hover:bg-sidebar-accent transition-colors"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <LogOut className="h-4 w-4 text-sidebar-muted" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
