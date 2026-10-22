import { signUp } from "@/app/(auth)/actions";
import { localSignIn } from "@/app/(auth)/local-actions";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthTabs } from "@/components/auth/AuthTabs";
import { OAuthButtons, OrDivider } from "@/components/auth/OAuthButtons";
import { PoweredBy } from "@/components/PoweredBy";
import { DISCLAIMER } from "@/lib/echo/messages";
import { LOCAL_MODE } from "@/lib/local/mode";

/**
 * Same screen in both modes. In local mode there is no real signUp — any
 * email signs you in, so this submits to localSignIn instead, exactly like
 * the sign-in panel's password form. The password field still renders and
 * still requires 8 characters, purely for visual parity; it's ignored.
 */
export default function SignUpPage() {
  return (
    <AuthForm
      title="Start a conversation"
      subtitle="A private space to hear your own thinking."
      action={LOCAL_MODE ? localSignIn : signUp}
      submitLabel="Create account"
      fields={["email", "password"]}
      passwordLabel="Password (at least 8 characters)"
      passwordAutoComplete="new-password"
      above={
        <div className="flex flex-col gap-5">
          <AuthTabs active="signup" />
          <OAuthButtons />
          <OrDivider label="or sign up with email" />
        </div>
      }
      footer={
        // The disclaimer appears at signup as well as persistently in chat.
        <>
          <p className="text-center text-xs leading-relaxed">{DISCLAIMER}</p>
          <PoweredBy className="mt-3" />
        </>
      }
    />
  );
}
