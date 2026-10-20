export function Blob({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <path
        d="M20 3c9 0 17 6 17 16 0 6-3 8-3 12 0 3-3 6-7 6H13c-4 0-7-3-7-6 0-4-3-6-3-12C3 9 11 3 20 3Z"
        fill="#836ef9"
      />
      <ellipse cx="14" cy="18" rx="3" ry="4" fill="#0b0a10" />
      <ellipse cx="26" cy="18" rx="3" ry="4" fill="#0b0a10" />
      <circle cx="15" cy="16.5" r="1.1" fill="#fff" />
      <circle cx="27" cy="16.5" r="1.1" fill="#fff" />
      <path d="M15 26c2.5 2.2 7.5 2.2 10 0" stroke="#0b0a10" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <Blob />
      <span className="font-display text-2xl font-bold lowercase tracking-tight text-text">
        floor<span className="text-brand">vault</span>
      </span>
    </span>
  );
}
