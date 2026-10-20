"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Pages where a floating "Chat" button would be in the way or beside the point. */
const HIDDEN_ON = ["/chat", "/close"];

/**
 * The way back to the conversation, from any other signed-in page. Fixed to the
 * bottom right, where a thumb or a cursor expects a "chat with us" button to be.
 *
 * Hidden on the chat itself (it is already there, and its own Send button lives
 * in that corner) and on the closing screen (someone mid-way through ending a
 * conversation has "Not yet" and "Go back" right in front of them, and a stray
 * navigation away would be the wrong thing to invite).
 */
export function ChatLauncher() {
  const pathname = usePathname();
  const hidden = HIDDEN_ON.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  // While the button is showing, leave room under the page content for it (see
  // the html[data-chat-launcher] rule in globals.css), so it never sits on the
  // last line of text.
  useEffect(() => {
    if (hidden) return;
    document.documentElement.setAttribute("data-chat-launcher", "");
    return () => document.documentElement.removeAttribute("data-chat-launcher");
  }, [hidden]);

  if (hidden) return null;

  return (
    <Link
      href="/chat"
      aria-label="Open your conversation"
      className="fixed z-40 flex h-14 items-center gap-2 rounded-full bg-accent px-5 text-base font-medium text-on-accent shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{
        right: "max(1rem, env(safe-area-inset-right))",
        bottom: "max(1rem, env(safe-area-inset-bottom))",
      }}
    >
      <ChatIcon />
      Chat
    </Link>
  );
}

function ChatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4.5h16v12H9l-4.5 4V4.5Z" />
      <path d="M8 9.5h8M8 13h5" />
    </svg>
  );
}
