"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useNftImage } from "@/lib/hooks";
import { cx } from "./ui";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PALETTES = [
  ["#836ef9", "#2a1f6b"],
  ["#ff9ecb", "#5a1f45"],
  ["#6ee7b7", "#14493a"],
  ["#ffd166", "#5a4210"],
  ["#7dd3fc", "#14405a"],
  ["#c4b5fd", "#3b2a7a"],
];

/** Deterministic little blob character, used when there is no real image. */
export function GeneratedArt({ seed, className }: { seed: string; className?: string }) {
  const h = hash(seed);
  const [fg, bg] = PALETTES[h % PALETTES.length];
  const eye = 3 + (h >>> 3) % 3;
  const mouth = (h >>> 5) % 3;
  const mouthPath = ["M15 27c2.500 2.500 7.500 2.500 10 0", "M16 28h8", "M15 26c3 -3 7 -3 10 0"][mouth];
  return (
    <svg viewBox="0 0 40 40" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Generated artwork" className={cx("size-full", className)}>
      <rect width="40" height="40" fill={bg} />
      <circle cx={8 + (h % 24)} cy={6 + ((h >>> 8) % 12)} r="9" fill={fg} opacity="0.18" />
      <path
        d="M20 7c8 0 14 5 14 14 0 5-2.500 7-2.500 10.500 0 2.500-2.500 5-6 5h-11c-3.500 0-6-2.500-6-5C8.500 28 6 26 6 21 6 12 12 7 20 7Z"
        fill={fg}
      />
      <ellipse cx="14.500" cy="20" rx="2.500" ry={eye} fill="#0b0a10" />
      <ellipse cx="25.500" cy="20" rx="2.500" ry={eye} fill="#0b0a10" />
      <path d={mouthPath} stroke="#0b0a10" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function RemoteImage({
  src,
  alt,
  fallback,
  className,
}: {
  src?: string | null;
  alt: string;
  fallback: React.ReactNode;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      className={cx("size-full object-cover", className)}
    />
  );
}

export function CoinAvatar({
  image,
  seed,
  name,
  className = "size-14",
}: {
  image?: string;
  seed: string;
  name: string;
  className?: string;
}) {
  return (
    <div className={cx("shrink-0 overflow-hidden rounded-2xl bg-card-2", className)}>
      <RemoteImage src={image} alt={`${name} logo`} fallback={<GeneratedArt seed={seed} />} />
    </div>
  );
}

export function NftArt({
  collection,
  tokenId,
  alt,
  className,
}: {
  collection: Address;
  tokenId: bigint;
  alt: string;
  className?: string;
}) {
  const { data } = useNftImage(collection, tokenId);
  return (
    <div className={cx("aspect-square w-full overflow-hidden bg-card-2", className)}>
      <RemoteImage
        src={data}
        alt={alt}
        fallback={<GeneratedArt seed={`${collection.toLowerCase()}:${tokenId}`} />}
      />
    </div>
  );
}
