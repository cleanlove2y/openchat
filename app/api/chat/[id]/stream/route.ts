import { createApiRoute } from "@/lib/logging/route-factory";

export const GET = createApiRoute({
  route: "/api/chat/[id]/stream",
  method: "GET",
  handler: async () => new Response(null, { status: 204 }),
});
