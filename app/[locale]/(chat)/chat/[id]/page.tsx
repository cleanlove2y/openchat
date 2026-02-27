import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Chat } from "@/components/chat";
import { DataStreamHandler } from "@/components/data-stream-handler";
import { DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import { isSupportedLocale, withLocalePath } from "@/lib/i18n/routing";
import { auth } from "@/lib/server/auth/core";
import { convertToUIMessages } from "@/lib/utils";

export default function Page(props: {
  params: Promise<{ id: string; locale?: string }>;
}) {
  return (
    <Suspense fallback={<div className="flex h-dvh" />}>
      <ChatPage params={props.params} />
    </Suspense>
  );
}

function localizedPath(locale: string | undefined, path: string): string {
  if (locale && isSupportedLocale(locale)) {
    return withLocalePath(locale, path);
  }

  return path;
}

async function ChatPage({
  params,
}: {
  params: Promise<{ id: string; locale?: string }>;
}) {
  const { id, locale } = await params;
  const chat = await getChatById({ id });

  if (!chat) {
    redirect(localizedPath(locale, "/"));
  }

  const session = await auth();

  if (!session) {
    const redirectUrl = encodeURIComponent(
      localizedPath(locale, `/chat/${id}`)
    );
    redirect(`/api/auth/guest?redirectUrl=${redirectUrl}`);
  }

  if (chat.visibility === "private") {
    if (!session.user) {
      return notFound();
    }

    if (session.user.id !== chat.userId) {
      return notFound();
    }
  }

  const messagesFromDb = await getMessagesByChatId({
    id,
  });

  const uiMessages = convertToUIMessages(messagesFromDb);

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get("chat-model");

  if (!chatModelFromCookie) {
    return (
      <>
        <Chat
          autoResume={true}
          id={chat.id}
          initialChatModel={DEFAULT_CHAT_MODEL}
          initialMessages={uiMessages}
          initialVisibilityType={chat.visibility}
          isReadonly={session?.user?.id !== chat.userId}
        />
        <DataStreamHandler />
      </>
    );
  }

  return (
    <>
      <Chat
        autoResume={true}
        id={chat.id}
        initialChatModel={chatModelFromCookie.value}
        initialMessages={uiMessages}
        initialVisibilityType={chat.visibility}
        isReadonly={session?.user?.id !== chat.userId}
      />
      <DataStreamHandler />
    </>
  );
}
