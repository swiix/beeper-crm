import { Suspense } from "react";
import { AppLayout } from "@/components/AppLayout";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppLayout>{children}</AppLayout>
    </Suspense>
  );
}
