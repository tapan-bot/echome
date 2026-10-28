import Link from "next/link";

import { EchoMark } from "@/components/EchoMark";

/**
 * The logo and name, fixed to the top-left beside the theme toggle on every page. Mounted
 * once in the root layout, like the toggle and the account icon, so no page has to remember
 * it. Clicking it goes to the welcome page (which sends someone who is signed out to sign in).
 */
export function SiteBrand() {
  return (
    <Link
      href="/welcome"
      aria-label="EchoMe, go to the welcome page"
      className="fx-brand fixed top-3 z-40 flex h-9 items-center gap-2 rounded-full border border-line bg-raised py-1 pl-1.5 pr-3.5 text-ink shadow-sm"
      // The theme toggle sits at the far left; the brand starts just after it.
      style={{ left: "calc(max(0.75rem, env(safe-area-inset-left)) + 2.75rem)" }}
    >
      <EchoMark size={26} />
      <span className="text-sm font-medium tracking-tight">EchoMe</span>
    </Link>
  );
}
