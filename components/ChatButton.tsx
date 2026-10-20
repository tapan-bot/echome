import { ChatLauncher } from "@/components/ChatLauncher";
import { currentUser } from "@/lib/auth/current-user";

/**
 * Mounted once in the root layout, like the account icon and the theme toggle.
 * Renders nothing when signed out: there is no conversation to go back to on the
 * sign-in pages. (currentUser() is cached per request, so asking here as well as
 * in the page costs one check, not two.)
 */
export async function ChatButton() {
  const user = await currentUser();
  if (!user) return null;
  return <ChatLauncher />;
}
