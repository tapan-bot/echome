import { signOut } from "@/app/(auth)/actions";
import { localSignOut } from "@/app/(auth)/local-actions";
import { ProfileMenu } from "@/components/ProfileMenu";
import { currentUser } from "@/lib/auth/current-user";
import { entitlementFor } from "@/lib/billing/entitlements";
import { TIERS } from "@/lib/config/pricing";
import { LOCAL_MODE } from "@/lib/local/mode";
import { xtiles } from "@/lib/xtiles/factory";

/**
 * The account icon, fixed to the top-right corner of every page — the mirror
 * image of ThemeToggle's spot on the top-left. Mounted once in the root
 * layout so it sits in the same place everywhere, rather than each signed-in
 * page remembering to build its own header for it.
 *
 * Renders nothing when signed out: currentUser() covers both real and local
 * mode, so this needs no mode-specific branching of its own beyond which sign
 * out action to hand the menu.
 */
export async function AccountMenu() {
  const user = await currentUser();
  if (!user) return null;

  const [entitlement, xtilesConnected] = await Promise.all([
    entitlementFor(user.id),
    (await xtiles()).isConnected(user.id).catch(() => false),
  ]);
  const planLabel = entitlement.tier === "none" ? "Free" : TIERS[entitlement.tier].name;
  // Paying now: a plan that is active, or one whose card is being retried. Anything else can upgrade.
  const paying = entitlement.tier !== "none" && (entitlement.status === "active" || entitlement.status === "past_due");

  return (
    <div
      className="fixed top-3 z-40"
      style={{ right: "max(0.75rem, env(safe-area-inset-right))" }}
    >
      <ProfileMenu
        email={user.email}
        planLabel={planLabel}
        tier={paying ? entitlement.tier : "none"}
        xtilesConnected={xtilesConnected}
        signOutAction={LOCAL_MODE ? localSignOut : signOut}
      />
    </div>
  );
}
