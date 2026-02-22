import { NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { discoverSkillsFromEnvironment } from "@/lib/ai/skills";
import { OpenChatError } from "@/lib/errors";

export const maxDuration = 60;

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user) {
      return new OpenChatError("unauthorized:api").toResponse();
    }

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
    console.error("Failed to fetch skills for slash commands:", error);
    return new OpenChatError("bad_request:api").toResponse();
  }
}
