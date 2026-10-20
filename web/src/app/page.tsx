import { IS_MAINNET, NETWORK } from "@/lib/constants";
import FeaturedChog from "@/components/FeaturedChog";
import { Blob } from "@/components/Wordmark";
import { ButtonLink, Card } from "@/components/ui";

const STEPS = [
  {
    n: "1",
    title: "Launch a coin",
    body: IS_MAINNET
      ? "Name it and pair it with Chog Genesis, with a 1% creator fee. One transaction."
      : "Name it, choose a 1%, 3% or 5% creator fee, and pair it with an NFT collection. One transaction.",
  },
  {
    n: "2",
    title: "Trades make fees",
    body: "Every buy and sell on the coin sends a slice of the volume to the vault as creator fees.",
  },
  {
    n: "3",
    title: "Split 80 / 20",
    body: "The keeper harvests automatically once nad.fun settles fees. 80% becomes the coin's NFT budget, 10% goes to the coin's creator and 10% to the floorvault treasury.",
  },
  {
    n: "4",
    title: "The vault buys",
    body: IS_MAINNET
      ? "When the budget covers the cheapest OpenSea listing, the vault's keeper buys it. The NFT is raffled to the coin's holders."
      : "When the budget covers the cheapest listing, the keeper buys it. The NFT is raffled to the coin's holders.",
  },
];

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 pt-4 md:grid-cols-[1.3fr_1fr] md:pt-10">
        <div>
          <p className="mb-3 inline-block rounded-full bg-brand/15 px-3 py-1 text-sm font-bold text-brand-soft">
            {NETWORK.name} &middot; CHOG NFT hackathon
          </p>
          <h1 className="font-display text-5xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl">
            Coins that <span className="text-brand">eat the floor.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted sm:text-xl">
            Launch a memecoin and pair it with an NFT collection. Its creator fees pile up in a vault that does exactly
            one thing: buy that collection&apos;s cheapest NFT.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/launch">Launch a coin</ButtonLink>
            <ButtonLink href="/explore" variant="secondary">
              Explore coins
            </ButtonLink>
          </div>
        </div>
        <div aria-hidden className="relative mx-auto hidden w-64 md:block">
          <Blob className="fv-bob size-64 drop-shadow-[0_20px_60px_rgba(131,110,249,0.45)]" />
        </div>
      </section>

      <section aria-labelledby="how-h">
        <h2 id="how-h" className="font-display text-3xl font-bold sm:text-4xl">
          How it works
        </h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n}>
              <Card className="h-full p-5">
                <span className="grid size-10 place-items-center rounded-full bg-brand font-display text-xl font-bold text-ink">
                  {s.n}
                </span>
                <h3 className="mt-4 font-display text-xl font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-muted">{s.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="chog-h">
        <h2 id="chog-h" className="mb-8 font-display text-3xl font-bold sm:text-4xl">
          Start with CHOG
        </h2>
        <FeaturedChog />
      </section>

      <section aria-labelledby="rules-h" className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 id="rules-h" className="font-display text-3xl font-bold sm:text-4xl">
            The vault has rules
          </h2>
          <p className="mt-3 text-lg text-muted">
            Creator fees can only go three places: the treasury, the coin&apos;s NFT budget, or an NFT from its paired
            collection. Nobody can redirect them, not even the creator.
          </p>
        </div>
        <Card className="p-5">
          <ul className="space-y-3 text-lg">
            <li><span className="font-bold text-brand-soft">Harvest:</span> automatic, fixed 80/10/10 split.</li>
            <li>
              <span className="font-bold text-brand-soft">Buy:</span>{" "}
              {IS_MAINNET ? "keeper only (it picks the OpenSea listing)" : "keeper only"}, only the paired collection, only at or under budget.
            </li>
            <li><span className="font-bold text-brand-soft">NFTs:</span> raffled to the coin&apos;s holders; with no taker they go to the wallet that launched the coin.</li>
          </ul>
          <ButtonLink href="/docs" variant="ghost" className="mt-3 px-0">
            Read the docs
          </ButtonLink>
        </Card>
      </section>
    </div>
  );
}
