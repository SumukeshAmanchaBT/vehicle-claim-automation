import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { useState } from "react";

interface AppLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export function AppLayout({ children, title, subtitle }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar open={sidebarOpen} />
      <div className={`transition-all duration-300 ${sidebarOpen ? "pl-64" : "pl-0"}`}>
        <AppHeader
          title={title}
          subtitle={subtitle}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />
        <main className="relative z-0 isolate p-6">{children}</main>
      </div>
    </div>
  );
}