/**
 * The maker's credit. Quiet on purpose: it sits under the disclaimer, or at the
 * foot of a page, and is never in the way of the conversation.
 */
export function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-ink-soft ${className}`}>
      Powered by{" "}
      <a
        href="https://creativemechanix.com"
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4 hover:text-ink"
      >
        Creative Mechanix
      </a>
    </p>
  );
}
