import { redis } from "../lib/redis";
import { SessionState } from "../core/types";

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

const key = (phone: string) => `sess:${phone}`;

export function newSession(phone: string): SessionState {
  return { phone, data: {}, stack: [] };
}

export async function getSession(phone: string): Promise<SessionState | null> {
  const raw = await redis.get(key(phone));
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as SessionState;
    s.data = s.data ?? {};
    s.stack = s.stack ?? [];
    return s;
  } catch {
    return null;
  }
}

export async function saveSession(session: SessionState): Promise<void> {
  await redis.set(key(session.phone), JSON.stringify(session), "EX", TTL_SECONDS);
}

export async function deleteSession(phone: string): Promise<void> {
  await redis.del(key(phone));
}
