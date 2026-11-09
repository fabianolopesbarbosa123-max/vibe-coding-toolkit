import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { BudgetBanner } from "@/components/budget/budget-banner";
import { ConnectionBanner } from "@/components/connection-banner";
import { OfficeProvider } from "@/components/office-provider";
import { Toasts } from "@/components/toasts";

export default function OfficeLayout({ children }: { children: ReactNode }) {
  return (
    <OfficeProvider>
      <AppNav />
      <ConnectionBanner />
      <BudgetBanner />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      <Toasts />
    </OfficeProvider>
  );
}
