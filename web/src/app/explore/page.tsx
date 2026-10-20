import type { Metadata } from "next";
import ExploreView from "@/components/ExploreView";
import { PageHeader, ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  return (
    <>
      <PageHeader
        title="Explore coins"
        intro="Every coin here has a collection to feed. Pick one and watch its budget grow."
        action={<ButtonLink href="/launch">Launch a coin</ButtonLink>}
      />
      <ExploreView />
    </>
  );
}
