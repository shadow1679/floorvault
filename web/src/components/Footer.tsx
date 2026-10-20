import Link from "next/link";
import Wordmark from "./Wordmark";
import { EXPLORER_URL, FAUCET_URL, IS_MAINNET } from "@/lib/constants";

export default function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-3 text-sm text-muted">
            Coins whose creator fees buy NFTs. Built for the CHOG NFT hackathon. {IS_MAINNET ? "Unaudited hackathon code on Monad mainnet: only use money you can afford to lose." : "Testnet only, unaudited, play money."}
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:grid-cols-3">
          <Link className="py-1 text-muted hover:text-text" href="/explore">Explore</Link>
          <Link className="py-1 text-muted hover:text-text" href="/gallery">Gallery</Link>
          <Link className="py-1 text-muted hover:text-text" href="/launch">Launch</Link>
          <Link className="py-1 text-muted hover:text-text" href="/docs">Docs</Link>
          <a className="py-1 text-muted hover:text-text" href={EXPLORER_URL} target="_blank" rel="noreferrer">
            Explorer
          </a>
          {FAUCET_URL ? (
            <a className="py-1 text-muted hover:text-text" href={FAUCET_URL} target="_blank" rel="noreferrer">
              Testnet faucet
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
