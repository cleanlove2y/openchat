import { NextResponse } from "next/server";
import { createAuthedApiRoute } from "@/app/api/_shared/authed-route";
import { discoverSkillsFromEnvironment } from "@/lib/ai/skills";
import { OpenChatError } from "@/lib/errors";
import { getAppLogger } from "@/lib/logging";

export const maxDuration = 60;
const appLogger = getAppLogger();

const getHandler = async (_request: Request) => {
  try {
    const skills = await discoverSkillsFromEnvironment();

    // In the future, we can add more slash commands (not just skills)
    // Map them to a standard format for the client
    const MAX_DESCRIPTION_LENGTH = 100;
    const commands = skills.map((skill) => {
      const description = skill.description || "No description provided.";
      return {
        id: skill.id,
        title: skill.name,
        description:
          description.length > MAX_DESCRIPTION_LENGTH
            ? `${description.slice(0, MAX_DESCRIPTION_LENGTH)}…`
            : description,
        type: "skill",
      };
    });

    return NextResponse.json({ commands }, { status: 200 });
  } catch (error) {
    appLogger.error(
      {
        event: "api.skills.fetch_failed",
        error,
      },
      "Failed to fetch skills for slash commands"
    );
    return new OpenChatError("bad_request:api").toResponse();
  }
};

export const GET = createAuthedApiRoute({
  route: "/api/skills",
  method: "GET",
  unauthorizedErrorCode: "unauthorized:api",
  handler: ({ request }) => getHandler(request),
});
