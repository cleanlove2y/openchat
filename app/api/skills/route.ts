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
    const commands = skills.map((skill) => ({
      id: skill.name, // Use the skill name as the unique id
      title: skill.name,
      description: skill.description || "No description provided.",
      type: "skill",
    }));

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

