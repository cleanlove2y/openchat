import { getChatById, getStreamIdsByChatId } from "@/lib/db/queries";
import { auth } from "@/lib/server/auth/core";
import { getStreamContext } from "../../route";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user?.id) {
    return new Response(null, { status: 204 });
  }

  const { id } = await context.params;
  const chat = await getChatById({ id });

  if (!chat || chat.userId !== session.user.id) {
    return new Response(null, { status: 204 });
  }

  if (!process.env.REDIS_URL) {
    return new Response(null, { status: 204 });
  }

  const streamContext = getStreamContext();

  if (!streamContext) {
    return new Response(null, { status: 204 });
  }

  const streamIds = await getStreamIdsByChatId({ chatId: id });
  const latestStreamId = streamIds.at(-1);

  if (!latestStreamId) {
    return new Response(null, { status: 204 });
  }

  const resumeAt = new URL(request.url).searchParams.get("resumeAt");
  const stream = await streamContext.resumeExistingStream(
    latestStreamId,
    resumeAt ? Number.parseInt(resumeAt, 10) : undefined
  );

  if (!stream) {
    return new Response(null, { status: 204 });
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}
