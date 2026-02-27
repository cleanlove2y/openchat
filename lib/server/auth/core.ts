import { compare } from "bcrypt-ts";
import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { DUMMY_PASSWORD } from "@/lib/constants";
import { createGuestUser, getUser } from "@/lib/db/queries";
import { hashForLog, writeAuditLog } from "@/lib/logging";
import { authConfig } from "./config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
    } & DefaultSession["user"];
  }

  interface User {
    id?: string;
    email?: string | null;
    type: UserType;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {},
      async authorize({ email, password }: any) {
        const emailHash =
          typeof email === "string" ? hashForLog(email.toLowerCase()) : null;
        const users = await getUser(email);

        if (users.length === 0) {
          await compare(password, DUMMY_PASSWORD);
          writeAuditLog({
            action: "auth.login",
            resourceType: "session",
            outcome: "failure",
            statusCode: 401,
            reason: "user_not_found",
            metadata: {
              provider: "credentials",
              emailHash,
            },
          });
          return null;
        }

        const [user] = users;

        if (!user.password) {
          await compare(password, DUMMY_PASSWORD);
          writeAuditLog({
            action: "auth.login",
            resourceType: "session",
            outcome: "failure",
            statusCode: 401,
            reason: "password_not_set",
            metadata: {
              provider: "credentials",
              emailHash,
            },
          });
          return null;
        }

        const passwordsMatch = await compare(password, user.password);

        if (!passwordsMatch) {
          writeAuditLog({
            action: "auth.login",
            resourceType: "session",
            outcome: "failure",
            statusCode: 401,
            reason: "password_mismatch",
            metadata: {
              provider: "credentials",
              emailHash,
            },
          });
          return null;
        }

        writeAuditLog({
          action: "auth.login",
          resourceType: "session",
          outcome: "success",
          statusCode: 200,
          actorId: user.id,
          actorType: "regular",
          metadata: {
            provider: "credentials",
            emailHash,
          },
        });

        return { ...user, type: "regular" };
      },
    }),
    Credentials({
      id: "guest",
      credentials: {},
      async authorize() {
        const [guestUser] = await createGuestUser();
        writeAuditLog({
          action: "auth.guest_create",
          resourceType: "user",
          resourceId: guestUser.id,
          outcome: "success",
          statusCode: 201,
          actorId: guestUser.id,
          actorType: "guest",
        });
        return { ...guestUser, type: "guest" };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
      }

      return session;
    },
  },
});
