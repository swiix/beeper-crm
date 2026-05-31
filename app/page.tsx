import { Suspense } from "react";
import { AppLayout } from "@/components/AppLayout";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <AppLayout />
    </Suspense>
  );
}
