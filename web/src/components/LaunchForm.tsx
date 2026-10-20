"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { configResult, normalizeAddress } from "@/lib/config";
import { FAUCET_URL, IS_MAINNET } from "@/lib/constants";
import { useLaunch } from "@/lib/tx";
import {
  CREATE_FEE_MON,
  FEE_TIERS,
  NAME_MAX,
  SYMBOL_MAX,
  hasErrors,
  validateLaunch,
  type LaunchErrors,
  type LaunchForm as LaunchValues,
} from "@/lib/validation";
import { CoinAvatar } from "./art";
import { ConfigGate } from "./ConfigNotice";
import { isBusy, TxButton, TxStatus } from "./tx";
import { Button, Card, cx } from "./ui";
import { IMAGE_TYPES } from "@/lib/nadfun";
import { useCollection } from "@/lib/hooks";

export default function LaunchFormPage() {
  return (
    <ConfigGate>
      <LaunchInner />
    </ConfigGate>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
  extra,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-display text-lg font-semibold">
          {label}
        </label>
        {extra}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mb-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const inputClass = (invalid: boolean) =>
  cx(
    "min-h-12 w-full rounded-2xl border-2 bg-card-2 px-4 py-2.5 text-base text-text placeholder:text-muted/70",
    invalid ? "border-danger" : "border-line hover:border-brand/60",
  );

function LaunchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const uid = useId();
  const { state, launch, reset } = useLaunch();
  const defaultCollection = configResult.ok ? configResult.config.collection : "";

  const [values, setValues] = useState<LaunchValues>({
    name: "",
    symbol: "",
    image: null,
    feeTier: 1,
    // Mainnet supports one collection, so a ?collection= link cannot change it.
    collection: IS_MAINNET ? defaultCollection : (params.get("collection") ?? defaultCollection),
    devBuy: "",
  });
  const [submitted, setSubmitted] = useState(false);

  const errors: LaunchErrors = submitted ? validateLaunch(values) : {};
  const set = <K extends keyof LaunchValues>(key: K, value: LaunchValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (state.phase === "error") reset();
  };

  const collectionAddress = normalizeAddress(values.collection) ?? undefined;
  const collectionInfo = useCollection(collectionAddress);
  // The preview is a local object URL of the chosen file, released when the file changes or the page closes.
  const [previewImage, setPreviewImage] = useState<string | undefined>();
  const previewRef = useRef<string | undefined>(undefined);
  useEffect(() => () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);
  const pickImage = (file: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = file ? URL.createObjectURL(file) : undefined;
    setPreviewImage(previewRef.current);
    set("image", file);
  };
  const busy = isBusy(state);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors(validateLaunch(values))) return;
    const result = await launch(values);
    if (result) router.push(`/coin/${result.token}`);
  }

  const err = (k: keyof LaunchValues) => errors[k];
  const describe = (k: keyof LaunchValues, hint = false) =>
    [hint ? `${uid}-${k}-hint` : null, err(k) ? `${uid}-${k}-error` : null].filter(Boolean).join(" ") || undefined;
  // Field ids need the same prefix as describedby ids.
  const id = (k: string) => `${uid}-${k}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <Card className="space-y-6 p-5 sm:p-7">
          <h2 className="font-display text-2xl font-semibold">Your coin</h2>
          <Field id={id("name")} label="Name" error={err("name")} hint={`Up to ${NAME_MAX} characters.`}>
            <input
              id={id("name")}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={NAME_MAX + 20}
              autoComplete="off"
              placeholder="Chog Floor Fund"
              aria-invalid={!!err("name")}
              aria-describedby={describe("name", true)}
              className={inputClass(!!err("name"))}
            />
          </Field>
          <Field id={id("symbol")} label="Symbol" error={err("symbol")} hint={`Letters and numbers, up to ${SYMBOL_MAX}.`}>
            <input
              id={id("symbol")}
              value={values.symbol}
              onChange={(e) => set("symbol", e.target.value.toUpperCase())}
              maxLength={SYMBOL_MAX + 10}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="CFF"
              aria-invalid={!!err("symbol")}
              aria-describedby={describe("symbol", true)}
              className={cx(inputClass(!!err("symbol")), "uppercase")}
            />
          </Field>
          <Field
            id={id("image")}
            label="Picture"
            error={err("image")}
            hint="PNG, JPEG, WebP or SVG, up to 5 MB. It is uploaded to nad.fun so the coin shows up there too."
          >
            <input
              id={id("image")}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              aria-invalid={!!err("image")}
              aria-describedby={describe("image", true)}
              className={cx(inputClass(!!err("image")), "cursor-pointer file:mr-4 file:rounded-full file:border-0 file:bg-brand/20 file:px-4 file:py-1.5 file:font-bold file:text-brand-soft")}
            />
          </Field>
        </Card>

        <Card className="space-y-6 p-5 sm:p-7">
          <h2 className="font-display text-2xl font-semibold">Where the fees go</h2>

          <fieldset aria-describedby={id("feeTier-hint")}>
            <legend className="font-display text-lg font-semibold">Creator fee</legend>
            <p id={id("feeTier-hint")} className="mb-2 text-sm text-muted">
              The share of every trade that flows to your vault. It cannot be changed after launch.
            </p>
            <div className={cx("grid gap-2 sm:gap-3", FEE_TIERS.length > 1 ? "grid-cols-3" : "grid-cols-1")}>
              {FEE_TIERS.map((tier) => (
                <label
                  key={tier}
                  className={cx(
                    "flex min-h-14 cursor-pointer items-center justify-center rounded-2xl border-2 px-3 py-3 text-center font-display text-xl font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-soft",
                    values.feeTier === tier ? "border-brand bg-brand/20 text-brand-soft" : "border-line bg-card-2 hover:border-brand/60",
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-fee`}
                    value={tier}
                    checked={values.feeTier === tier}
                    onChange={() => set("feeTier", tier)}
                    className="sr-only"
                  />
                  {tier}%
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">
              80% of it buys NFTs, 10% comes back to you as the creator, 10% goes to the floorvault treasury.
              {IS_MAINNET ? " nad.fun allows only a 1% creator fee on mainnet." : ""}
            </p>
          </fieldset>

          {IS_MAINNET ? (
            <div>
              <p className="font-display text-lg font-semibold">NFT collection</p>
              <p className="mb-1.5 text-sm text-muted">Mainnet vaults buy one collection only.</p>
              <div className="rounded-2xl border-2 border-line bg-card-2 px-4 py-3">
                <p className="font-bold">{collectionInfo.data?.name ?? "Chog Genesis"}</p>
                <p className="break-all font-mono text-sm text-muted">{values.collection}</p>
              </div>
            </div>
          ) : (
          <Field
            id={id("collection")}
            label="NFT collection"
            error={err("collection")}
            hint="The ERC-721 contract the vault will buy from."
            extra={
              configResult.ok ? (
                <button
                  type="button"
                  onClick={() => set("collection", configResult.ok ? configResult.config.collection : "")}
                  className="rounded-full px-2 py-1 text-sm font-bold text-brand-soft hover:underline"
                >
                  Use Test CHOG
                </button>
              ) : null
            }
          >
            <input
              id={id("collection")}
              value={values.collection}
              onChange={(e) => set("collection", e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="0x…"
              aria-invalid={!!err("collection")}
              aria-describedby={describe("collection", true)}
              className={cx(inputClass(!!err("collection")), "font-mono text-sm")}
            />
            {collectionAddress && collectionInfo.data ? (
              <p className="mt-1.5 text-sm text-mint">Collection found: {collectionInfo.data.name}</p>
            ) : collectionAddress && collectionInfo.isSuccess ? (
              <p role="status" className="mt-1.5 text-sm font-semibold text-lemon">
                This address doesn&apos;t look like an NFT collection (no name found). Launching is permanent, so
                double-check it.
              </p>
            ) : null}
          </Field>
          )}

          <Field
            id={id("devBuy")}
            label="Dev buy (MON, optional)"
            error={err("devBuy")}
            hint={
              <>
                MON you spend buying your own coin in the same transaction, so you are the first holder. Leave it
                empty to skip. nad.fun&apos;s {CREATE_FEE_MON} MON create fee is added on top, and anything the router
                does not use is refunded.
                {FAUCET_URL ? (
                  <>
                    {" "}
                    Need MON?{" "}
                    <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="font-bold text-brand-soft underline">
                      Testnet faucet
                    </a>
                    .
                  </>
                ) : null}
              </>
            }
          >
            <input
              id={id("devBuy")}
              value={values.devBuy}
              onChange={(e) => set("devBuy", e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              aria-invalid={!!err("devBuy")}
              aria-describedby={describe("devBuy", true)}
              className={inputClass(!!err("devBuy"))}
            />
          </Field>
        </Card>

        {IS_MAINNET ? (
          <Card role="note" className="border-lemon/40 p-4 text-sm text-muted">
            <p className="font-bold text-lemon">This uses real MON on Monad mainnet.</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>Launching is permanent: the collection, creator fee and fee routing cannot be changed.</li>
              <li>The contracts are unaudited. Only use money you can afford to lose.</li>
              <li>
                Budgets fill slowly. nad.fun settles fees in batches (about 100 MON), and a Chog Genesis NFT costs thousands
                of MON, so expect a lot of trading volume before the first buy.
              </li>
            </ul>
          </Card>
        ) : null}

        <div>
          <TxButton type="submit" busy={busy} className="w-full sm:w-auto sm:min-w-56">
            {busy ? "Launching…" : "Launch coin"}
          </TxButton>
          <div className="mt-2">
            <TxStatus state={state} />
          </div>
          {submitted && hasErrors(errors) ? (
            <p role="alert" className="mt-2 text-sm font-semibold text-danger">
              Fix the highlighted fields and try again.
            </p>
          ) : null}
        </div>
      </form>

      <aside aria-label="Preview" className="lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          <div className="aspect-[4/3] bg-card-2">
            <CoinAvatar
              image={previewImage}
              seed={values.symbol || values.name || "floorvault"}
              name={values.name || "Your coin"}
              className="size-full !rounded-none"
            />
          </div>
          <div className="space-y-1 p-5">
            <p className="font-display text-2xl font-semibold">{values.name.trim() || "Your coin"}</p>
            <p className="text-brand-soft">${values.symbol.trim() || "TICKER"}</p>
            <p className="pt-2 text-sm text-muted">
              {values.feeTier}% creator fee &middot; buys{" "}
              <span className="font-bold text-text">
                {collectionInfo.data?.name ?? (collectionAddress ? "this collection" : "your collection")}
              </span>
            </p>
          </div>
        </Card>
        <p className="mt-3 px-1 text-sm text-muted">
          You sign one transaction. After it confirms you land on your coin&apos;s page.
        </p>
        {state.phase === "error" ? (
          <Button variant="ghost" className="mt-2" onClick={reset}>
            Clear message
          </Button>
        ) : null}
      </aside>
    </div>
  );
}
