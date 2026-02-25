import Form from "next/form";

import { auth, signOut } from "@/lib/server/auth/core";
import { writeAuditLog } from "@/lib/logging";

export const SignOutForm = () => {
  return (
    <Form
      action={async () => {
        "use server";

        const session = await auth();
        writeAuditLog({
          action: "auth.logout",
          resourceType: "session",
          outcome: "success",
          actorId: session?.user?.id,
          actorType: session?.user?.type,
        });

        await signOut({
          redirectTo: "/",
        });
      }}
      className="w-full"
    >
      <button
        className="w-full px-1 py-0.5 text-left text-red-500"
        type="submit"
      >
        Sign out
      </button>
    </Form>
  );
};

