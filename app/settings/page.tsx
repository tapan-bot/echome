import { redirect } from "next/navigation";

import { signOut } from "@/app/(auth)/actions";
import { localSignOut } from "@/app/(auth)/local-actions";
import { PoweredBy } from "@/components/PoweredBy";
import { currentUser } from "@/lib/auth/current-user";
import { LOCAL_MODE } from "@/lib/local/mode";

/**
 * Deliberately small. There isn't much to configure yet — this exists so the
 * profile menu has somewhere real to send "Settings", not a placeholder for
 * features that don't exist. Add sections here as real settings arrive.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/settings");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-7 px-5 py-14">
      <h1 className="text-2xl font-medium tracking-tight">Settings</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Signed in as</h2>
        <p className="text-ink-soft">{user.email ?? user.id}</p>
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Appearance</h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          EchoMe follows your device&rsquo;s light or dark mode by default. To choose one yourself,
          use the sun/moon button at the top-left of any page.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Plan &amp; workspace</h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          Billing and your xTiles connection live on your account page.
        </p>
        <a href="/account" className="self-start rounded-lg border border-line px-4 py-2.5 text-ink-soft">
          Go to account
        </a>
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Session</h2>
        <form action={LOCAL_MODE ? localSignOut : signOut}>
          <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-ink-soft">
            Sign out
          </button>
        </form>
      </section>

      <PoweredBy />
    </main>
  );
}
