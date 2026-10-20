import type { Metadata } from "next";
import CoinDetail from "@/components/CoinDetail";

export const metadata: Metadata = { title: "Coin" };

export default async function CoinPage({ params }: PageProps<"/coin/[token]">) {
  const { token } = await params;
  return <CoinDetail token={token} />;
}
