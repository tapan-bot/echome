import { redirect } from "next/navigation";

import { TurnThePage } from "@/components/turn/TurnThePage";
import { currentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TurnPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/turn");
  return <TurnThePage />;
}
