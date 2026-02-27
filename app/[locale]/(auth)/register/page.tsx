"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { useAppTranslation } from "@/lib/i18n/hooks";
import { localizePathFromPathname } from "@/lib/i18n/navigation";
import { type RegisterActionState, register } from "@/lib/server/auth/actions";

export default function Page() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useAppTranslation("auth");

  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    {
      status: "idle",
    }
  );

  const { update: updateSession } = useSession();

  useEffect(() => {
    if (state.status === "user_exists") {
      toast({ type: "error", description: t("toast.accountExists") });
    } else if (state.status === "failed") {
      toast({ type: "error", description: t("toast.createFailed") });
    } else if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: t("toast.invalidSubmission"),
      });
    } else if (state.status === "success") {
      toast({ type: "success", description: t("toast.createSuccess") });

      setIsSuccessful(true);
      updateSession();
      router.refresh();
    }
  }, [state.status, router, t, updateSession]);

  const handleSubmit = (formData: FormData) => {
    setEmail(formData.get("email") as string);
    formAction(formData);
  };

  return (
    <div className="relative flex h-dvh w-screen items-start justify-center bg-background pt-12 md:items-center md:pt-0">
      <div className="flex w-full max-w-md flex-col gap-12 overflow-hidden rounded-2xl">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          <h3 className="font-semibold text-xl dark:text-zinc-50">
            {t("register.title")}
          </h3>
          <p className="text-gray-500 text-sm dark:text-zinc-400">
            {t("register.subtitle")}
          </p>
        </div>
        <AuthForm
          action={handleSubmit}
          defaultEmail={email}
          emailLabel={t("form.emailLabel")}
          emailPlaceholder={t("form.emailPlaceholder")}
          passwordLabel={t("form.passwordLabel")}
        >
          <SubmitButton isSuccessful={isSuccessful}>
            {t("register.submit")}
          </SubmitButton>
          <p className="mt-4 text-center text-gray-600 text-sm dark:text-zinc-400">
            {`${t("register.toLoginPrefix")} `}
            <Link
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200"
              href={localizePathFromPathname(pathname, "/login")}
            >
              {t("register.toLoginLink")}
            </Link>
            {` ${t("register.toLoginSuffix")}`}
          </p>
        </AuthForm>
      </div>
    </div>
  );
}
