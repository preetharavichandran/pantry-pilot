import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { sendProblem } from "./errors.js";

export type AuthUser = {
  sub: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function createAuthVerifier(config: AppConfig) {
  if (config.auth.mode === "Google") {
    if (!config.auth.googleAudience) {
      throw new Error("AUTH_GOOGLE_AUDIENCE is required when AUTH_MODE=Google");
    }
    const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

    return async (token: string): Promise<AuthUser> => {
      const { payload } = await jwtVerify(token, googleJwks, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: config.auth.googleAudience,
      });
      return requireSub(payload);
    };
  }

  const key = new TextEncoder().encode(config.auth.devSigningKey);
  return async (token: string): Promise<AuthUser> => {
    const { payload } = await jwtVerify(token, key, {
      issuer: config.auth.devIssuer,
      audience: config.auth.devAudience,
      algorithms: ["HS256"],
    });
    return requireSub(payload);
  };
}

function requireSub(payload: JWTPayload): AuthUser {
  const sub = payload.sub;
  if (!sub) {
    throw new Error("Token missing sub");
  }
  return { sub };
}

export function authHook(verify: (token: string) => Promise<AuthUser>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return sendProblem(reply, {
        status: 401,
        title: "Unauthorized",
        detail: "Missing or invalid Authorization Bearer token",
        type: "https://lifeatlas.local/problems/unauthorized",
      });
    }
    const token = header.slice("Bearer ".length).trim();
    try {
      request.user = await verify(token);
    } catch {
      return sendProblem(reply, {
        status: 401,
        title: "Unauthorized",
        detail: "Token validation failed",
        type: "https://lifeatlas.local/problems/unauthorized",
      });
    }
  };
}
