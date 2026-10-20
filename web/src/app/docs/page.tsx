import type { Metadata } from "next";
import ContractList from "@/components/ContractList";
import { CREATE_FEE_MON } from "@/lib/validation";
import { IS_MAINNET, NETWORK } from "@/lib/constants";
import { IMAGE_MAX_MB } from "@/lib/nadfun";
import { Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Docs" };

const SECTIONS = [
  ["overview", "Overview"],
  ["launch", "Launching a coin"],
  ["flow", "Fee flow"],
  ["split", "The 80/10/10 split"],
  ["buying", "How buying works"],
  ["raffle", "The holder raffle"],
  ["coin-page", "The coin page"],
  ["automation", "What runs by itself"],
  ["contracts", "Contracts"],
  ["risks", "Risks"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24">
      <h2 id={`${id}-h`} className="font-display text-3xl font-bold">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-lg text-muted">{children}</div>
    </section>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-text">{children}</strong>;
}

export default function DocsPage() {
  return (
    <>
      <PageHeader
        title="Docs"
        intro="How a coin turns trading fees into NFT purchases, who wins those NFTs, and what to watch out for."
      />
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-full px-3 py-1.5 font-display font-semibold text-muted hover:bg-card-2 hover:text-text">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-12">
          <Section id="overview" title="Overview">
            <p>
              floorvault is a memecoin launcher on Monad. Every coin is launched on nad.fun and paired with an NFT
              collection{IS_MAINNET ? " (Chog Genesis on mainnet)" : ""}. Trading the coin produces creator fees, the fees pile
              up in a vault, and the vault does one thing with them: buy the cheapest NFT of the paired collection. That NFT is
              then raffled to the people who hold the coin.
            </p>
            <ol className="list-decimal space-y-1 pl-6">
              <li><B>Launch</B> a coin and pair it with a collection. One transaction.</li>
              <li><B>Trade.</B> Every buy and sell sends a slice of the volume to the vault as creator fees.</li>
              <li><B>Harvest.</B> The fees are split: 80% NFT budget, 10% creator, 10% treasury.</li>
              <li><B>Buy.</B> When the budget covers the cheapest listing, the vault buys it.</li>
              <li><B>Raffle.</B> Holders of the coin are entered automatically and one of them wins the NFT.</li>
            </ol>
            <p>
              The site has four pages: <B>Explore</B> lists every coin, <B>Gallery</B> shows the NFTs the vaults have bought,{" "}
              <B>Launch</B> creates a coin, and each coin has its own page for trading, odds and the raffle. There is no claims
              page: harvesting, buying and running the raffle all happen automatically, and the only manual step is the
              winner claiming their NFT.
            </p>
          </Section>

          <Section id="launch" title="Launching a coin">
            <p>
              The Launch form takes a name, a symbol and a picture, then you sign <B>one transaction</B> and land on your
              coin&apos;s page.
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <B>Name and symbol:</B> up to 32 characters for the name; letters and numbers, up to 10, for the symbol.
              </li>
              <li>
                <B>Picture:</B> PNG, JPEG, WebP or SVG, up to {IMAGE_MAX_MB} MB. It is uploaded to nad.fun together with the coin&apos;s
                metadata, so the coin also shows up on nad.fun with its image and a chart. The coin&apos;s address is mined
                to end in <code className="font-mono text-text">7777</code> before launch, which takes a moment.
              </li>
              <li>
                <B>Creator fee:</B>{" "}
                {IS_MAINNET
                  ? "1% of trading volume, the only rate nad.fun allows on mainnet."
                  : "1%, 3% or 5% of trading volume on testnet."}{" "}
                nad.fun fixes it per coin, so it cannot be changed after launch. To change it, launch a new coin.
              </li>
              <li>
                <B>NFT collection:</B>{" "}
                {IS_MAINNET
                  ? "Chog Genesis. Mainnet vaults buy this one collection only."
                  : "any ERC-721 contract on testnet (the form offers the Test CHOG collection with one click). The form warns if the address does not look like an NFT collection. Launching is permanent."}
              </li>
              <li>
                <B>Dev buy (optional):</B> MON you spend buying your own coin in the same transaction, so you are the first
                holder. nad.fun&apos;s fixed {CREATE_FEE_MON} MON create fee is added on top, and anything the router does not
                use is refunded. Leave it empty to skip.
              </li>
            </ul>
            <p>
              The wallet that launches is recorded as the coin&apos;s <B>creator</B> (it receives 10% of the fees) and as the
              NFT fallback recipient (see the raffle). The vault registers itself as the coin&apos;s creator-fee recipient, so
              fees are routed to it from the first trade. Nobody can redirect them afterwards, including the creator.
            </p>
          </Section>

          <Section id="flow" title="Fee flow">
            <p>
              Traders buy and sell the coin through nad.fun&apos;s router, priced on its bonding curve. A slice of each trade
              ({IS_MAINNET ? "1%" : "the creator fee you picked"}) accrues as creator fees, held by nad.fun. nad.fun keeps its own
              separate protocol fee.
            </p>
            <ol className="list-decimal space-y-1 pl-6">
              <li>
                nad.fun only <B>settles</B> a coin&apos;s fees to the vault in batches, once about 100 MON have accumulated.
                Until then there is nothing to harvest.
              </li>
              <li>
                Then the <B>harvest</B> runs: the vault claims the settled fees from nad.fun. Anyone can trigger a harvest,
                because the destinations are fixed at launch. In practice the keeper does it.
              </li>
              <li>The vault splits what it claimed 80/10/10 (below) and credits the coin&apos;s budget.</li>
              <li>The <B>buy</B> follows once the budget covers the floor.</li>
            </ol>
            <p>
              Budgets therefore move in steps, not with every trade. The coin page&apos;s <B>Until the next NFT</B> card shows
              the budget against the current floor and roughly how much more trading it takes to close the gap.
            </p>
          </Section>

          <Section id="split" title="The 80/10/10 split">
            <Card className="p-5">
              <div className="flex h-5 overflow-hidden rounded-full bg-ink" aria-hidden>
                <div className="bg-brand" style={{ width: "80%" }} />
                <div className="bg-pink" style={{ width: "10%" }} />
                <div className="bg-brand-soft" style={{ width: "10%" }} />
              </div>
              <ul className="mt-4 space-y-1">
                <li><strong className="text-brand-soft">80%</strong> goes to the coin&apos;s NFT budget. Each coin has its own budget, so one coin can never spend another&apos;s fees.</li>
                <li><strong className="text-pink">10%</strong> goes to the floorvault treasury, which funds the project.</li>
                <li><strong className="text-brand-soft">10%</strong> goes to the creator who launched the coin.</li>
              </ul>
            </Card>
            <p>The split is fixed in the contract. Amounts on this site are shown in MON (WMON is unwrapped when buying).</p>
          </Section>

          <Section id="buying" title="How buying works">
            <p>
              <B>Buy</B> picks the cheapest listing of the coin&apos;s paired collection. If the price fits the coin&apos;s
              budget, the vault pays for it and the NFT goes straight to the raffle contract, which opens a raffle for it. If
              the floor is above the budget, the vault waits and the coin page shows the gap.
            </p>
            <p>
              Only the vault&apos;s <B>keeper</B> can call buy. The keeper chooses the listing off-chain, so the contract cannot
              tell a fair floor from an inflated listing that someone created just for the vault. The keeper can never redirect
              funds: purchases are limited to the paired collection and the coin&apos;s budget, and NFTs always go to the
              raffle. It is, however, trusted to pick a fair listing. The budget is charged what the marketplace actually kept,
              and any unspent MON stays in the budget.
            </p>
            {IS_MAINNET ? (
              <p>
                On mainnet the vault buys <B>Chog Genesis</B> only, through Seaport (OpenSea). The keeper finds the cheapest
                listing on OpenSea and passes its signed order to the vault&apos;s Seaport adapter, which checks that it sells
                one token of the collection and that the NFT arrives at the raffle. The price includes OpenSea&apos;s fee and
                the creator royalty.
              </p>
            ) : (
              <p>
                On testnet there is no Seaport, so NFTs are bought through a simple mock marketplace that holds listings in
                escrow. On mainnet this slot is a Seaport adapter behind the same interface.
              </p>
            )}
          </Section>

          <Section id="raffle" title="The holder raffle">
            <p>
              Every NFT a coin buys is raffled to the holders of <B>that coin</B>. There is nothing to enter and nothing to
              press: holding the coin when the draw happens is enough.
            </p>
            <ol className="list-decimal space-y-1 pl-6">
              <li>
                <B>Wait.</B> The raffle opens when the NFT is bought and the draw runs after a short delay (
                {IS_MAINNET ? "1 day" : "5 minutes on testnet"}).
              </li>
              <li>
                <B>Draw.</B> A random seed is fixed from the block&apos;s <code className="font-mono text-text">prevrandao</code>.
              </li>
              <li>
                <B>Rank.</B> For a settle window ({IS_MAINNET ? "6 hours" : "2 minutes on testnet"}) holders are submitted and
                scored on their <i>current</i> balance. The lowest <code className="font-mono text-text">hash(seed, holder) / balance</code>{" "}
                leads, so a bigger balance wins more often.
              </li>
              <li>
                <B>Winner.</B> The result is locked in. The coin page shows the winner&apos;s wallet and a Claim button that
                only that wallet can use.
              </li>
              <li>
                <B>Claim or re-raffle.</B> The winner has 7 days to claim. If they don&apos;t, the NFT is raffled again
                automatically and the old winner is out of that raffle.
              </li>
            </ol>
            <p>
              The bonding curve and the vault&apos;s own contracts hold coins but are not real holders, so they cannot win. If no
              holder qualifies when a round closes, the NFT goes to the wallet that launched the coin. A graduated coin&apos;s
              DEX pair is not blocked, so it could be picked as a winner; the NFT then waits 7 days until the re-raffle. No
              funds are lost.
            </p>
            <p>
              Randomness comes from <code className="font-mono text-text">prevrandao</code>, which a validator can nudge, and the
              odds only approximate balance weighting.{" "}
              {IS_MAINNET
                ? "That is not manipulation-proof, so treat the raffle as a fun giveaway rather than a fair lottery for high-value prizes."
                : "That is fine for a demo and not for real prizes."}
            </p>
          </Section>

          <Section id="coin-page" title="The coin page">
            <p>Each coin has a page at its token address. From top to bottom:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li><B>Price chart and trade card.</B> Buy or sell the coin on nad.fun with MON, a quote, and a slippage setting (3% by default).</li>
              <li><B>Until the next NFT.</B> The budget against the cheapest listing, as a percentage, with the extra trading volume still needed.</li>
              <li><B>Holders.</B> Balances from the coin&apos;s transfer history. While a raffle is ranking holders, each row shows its place in the draw.</li>
              <li><B>Holder raffle.</B> The live raffle for each NFT, its stage and countdown, the current leader and the winner with their Claim button. Finished giveaways move to a history underneath.</li>
              <li><B>Your winning chance.</B> Your odds per NFT, worked out with the same rule the contract uses, plus a &ldquo;what if I held&hellip;&rdquo; box to see how buying more would change them.</li>
              <li><B>Stats.</B> NFT budget, floor price, NFTs bought and fees claimed.</li>
            </ul>
            <p>
              The <B>Gallery</B> collects every NFT the vaults have bought, with the price paid and the coin that bought it.
            </p>
          </Section>

          <Section id="automation" title="What runs by itself">
            <p>
              A keeper service watches every launched coin and does the chores, so nobody has to press a button except the winner:
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li>harvests creator fees once nad.fun has settled them;</li>
              <li>buys the floor NFT when the budget covers it{IS_MAINNET ? ", fetching the signed OpenSea order" : ""};</li>
              <li>draws each raffle, submits the leading holder, locks in the winner, and re-raffles unclaimed NFTs.</li>
            </ul>
            <p>
              The keeper can never claim an NFT for itself: only the winner can claim. Each step is simulated first and skipped
              if it would fail, and harvest, draw and finalize can be called by anyone if the keeper is down. Only buy is
              restricted to the keeper.
            </p>
          </Section>

          <Section id="contracts" title="Contracts">
            <p>
              All on {NETWORK.name} (chain id {NETWORK.id}).
            </p>
            <ContractList />
          </Section>

          <Section id="risks" title="Risks">
            <ul className="list-disc space-y-1 pl-6">
              {IS_MAINNET ? (
                <li>
                  The contracts are unaudited hackathon code running on mainnet with real funds. Only use money you can afford to
                  lose.
                </li>
              ) : (
                <li>The contracts are unaudited hackathon code. Testnet only. Do not use real funds.</li>
              )}
              {IS_MAINNET ? (
                <li>
                  Budgets grow slowly. The creator fee is 1% of volume and the vault keeps 80% of it as budget, so one Chog Genesis
                  NFT at the current floor needs a very large amount of trading volume on a single coin. Fees also only arrive in
                  steps, once nad.fun settles them.
                </li>
              ) : null}
              <li>Launching is permanent: the collection, the creator fee and the fee routing cannot be changed.</li>
              <li>Thin liquidity: if nothing is listed for a collection, the vault has nothing to buy.</li>
              <li>Fees only exist if people trade the coin. A quiet coin has an empty budget.</li>
              <li>The keeper is trusted to pick a fair listing. The budget cap is the only on-chain price rule, so an oddly priced floor can still be bought.</li>
              <li>The raffle is demo-grade: the seed can be nudged by a validator and the odds follow balance only approximately.</li>
              <li>A winner who does not claim within 7 days loses the NFT to a re-raffle.</li>
              <li>The first page load can be slow while the server catches up on the chain&apos;s history; Explore and Gallery show what exists so far with a note.</li>
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
