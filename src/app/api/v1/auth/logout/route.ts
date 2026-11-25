import { logoutSchema } from "@/lib/validation/auth";
import { ok, route } from "@/server/http/route";
import { authService } from "@/server/modules/auth/auth.service";
import {
  appendSetCookies,
  buildClearAuthCookies,
  extractAccessToken,
  extractRefreshToken,
} from "@/server/modules/auth/cookies";
import { verifyAccessToken } from "@/server/modules/auth/crypto";

export const POST = route(async (request: Request) => {
  let allDevices = false;
  try {
    const text = await request.text();
    if (text.trim()) {
      const parsed = logoutSchema.parse(JSON.parse(text));
      allDevices = parsed.allDevices;
    }
  } catch {
    // อนุญาตให้ส่ง body ว่างได้ตอนกด logout
  }

  const access = extractAccessToken(request);
  const verified = access ? verifyAccessToken(access) : null;
  const refreshToken = extractRefreshToken(request);

  await authService.logout({
    userId: verified?.ok ? verified.payload.sub : undefined,
    sessionId: verified?.ok ? verified.payload.sid : undefined,
    refreshToken,
    allDevices,
  });

  return appendSetCookies(ok({ loggedOut: true }), buildClearAuthCookies());
});
