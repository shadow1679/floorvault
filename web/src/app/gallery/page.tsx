import type { Metadata } from "next";
import GalleryView from "@/components/GalleryView";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Gallery" };

export default function GalleryPage() {
  return (
    <>
      <PageHeader title="The gallery" intro="Every NFT a coin has bought with its creator fees, newest first." />
      <GalleryView />
    </>
  );
}
