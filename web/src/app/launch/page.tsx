import type { Metadata } from "next";
import { Suspense } from "react";
import LaunchForm from "@/components/LaunchForm";
import { PageHeader, Skeleton } from "@/components/ui";

export const metadata: Metadata = { title: "Launch" };

export default function LaunchPage() {
  return (
    <>
      <PageHeader
        title="Launch a coin"
        intro="Name it, pick the fee, pick the collection. Every trade after that sends a slice to the vault."
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <LaunchForm />
      </Suspense>
    </>
  );
}
