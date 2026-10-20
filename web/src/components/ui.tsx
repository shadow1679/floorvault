import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Blob } from "./Wordmark";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-center font-display text-base font-semibold transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100";
const variants: Record<Variant, string> = {
  primary: "bg-brand text-ink hover:bg-brand-soft",
  secondary: "border-2 border-line bg-card-2 text-text hover:border-brand",
  ghost: "text-brand-soft hover:bg-card-2",
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={cx(base, variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(base, variants[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-3xl border border-line bg-card", className)} {...props} />;
}

export function Badge({
  tone = "brand",
  children,
}: {
  tone?: "brand" | "mint" | "pink" | "lemon" | "muted";
  children: ReactNode;
}) {
  const tones = {
    brand: "bg-brand/15 text-brand-soft",
    mint: "bg-mint/15 text-mint",
    pink: "bg-pink/15 text-pink",
    lemon: "bg-lemon/15 text-lemon",
    muted: "bg-card-2 text-muted",
  };
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold", tones[tone])}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cx("min-w-0 rounded-2xl bg-card-2", compact ? "px-3 py-2.5" : "p-4")}>
      <dt className="text-xs font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd
        className={cx(
          "mt-1 break-words font-display font-semibold text-text",
          compact ? "text-lg" : "text-xl sm:text-2xl",
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({ title, intro, action }: { title: string; intro?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">{title}</h1>
        {intro ? <p className="mt-2 max-w-2xl text-lg text-muted">{intro}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("fv-pulse rounded-2xl bg-card-2", className)} />;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <Blob className="fv-bob mb-4 size-14" />
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-muted">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}

export function ErrorState({ title = "Could not load data", body, onRetry }: { title?: string; body?: ReactNode; onRetry?: () => void }) {
  return (
    <Card role="alert" className="border-danger/40 px-6 py-10 text-center">
      <h2 className="font-display text-2xl font-semibold text-danger">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-muted">
        {body ?? "The Monad RPC did not answer. It may be busy. Try again in a moment."}
      </p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className="mt-5">
          Try again
        </Button>
      ) : null}
    </Card>
  );
}

/** Shown while the server is still reading old chain history: the lists below are complete up to `scannedTo` only. */
export function IndexingNote({ scannedTo }: { scannedTo: bigint }) {
  return (
    <p role="status" className="mb-4 rounded-2xl border border-line bg-card-2 px-4 py-3 text-sm text-muted">
      Still reading the chain history (up to block {scannedTo.toString()}). More will appear here as it is found.
    </p>
  );
}

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-72" />
      ))}
    </div>
  );
}
