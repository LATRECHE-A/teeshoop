/**
 * A bound on how often one address may write to R2 through an OPEN route.
 *
 * WHY. `POST /api/design` and `POST /api/ar` take no credentials, because the
 * customer is the author of their own artwork and cannot authenticate. Container
 * validation (`containers.ts`) and the size and count caps make them SAFE: what
 * lands in the bucket is a real PNG, a real GLB, a real USDZ, bounded. Nothing
 * made them CHEAP. One request can write up to forty megabytes across
 * forty-three objects, R2 charges for storage and for class A operations, and
 * the `design/` prefix deliberately has no lifecycle rule because only the shop
 * knows which artwork is still owed against an order.
 *
 * THIS IS A MITIGATION, NOT A GATE, AND THAT DISTINCTION DECIDES THE FAILURE
 * MODE. The project's rule is that an unset secret denies everything: an
 * authorisation check that cannot run must refuse. A rate limiter is not an
 * authorisation check. If the binding is missing, refusing would take the shop
 * off the air for a reason that has nothing to do with whether the caller is
 * allowed, and the route would still be safe, merely uncapped in volume. So a
 * missing binding ALLOWS, and says so where `wrangler tail` will show it. The
 * inversion the project forbids (`if (!token) return null`) is forbidden because
 * a token IS the gate; here the gates are elsewhere and still stand.
 *
 * KEYED BY ADDRESS, with the consequence stated. `CF-Connecting-IP` groups
 * everyone behind one carrier NAT or one office, so the limits below are set
 * generously: a customer uploads a design once per purchase and perhaps a
 * handful of times while they change their mind, not twenty times a minute. A
 * legitimate buyer who does hit it gets a 429 with `Retry-After` and a French
 * sentence the studio can show, never a silent failure.
 */

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface RateLimitEnv {
  /** Bound in wrangler.jsonc. Absent in `wrangler dev`, which is why the code allows. */
  DESIGN_UPLOAD_LIMIT?: RateLimiter
  AR_UPLOAD_LIMIT?: RateLimiter
}

/**
 * The address a limit is counted against.
 *
 * `CF-Connecting-IP` is set by Cloudflare on every request that reaches a Worker
 * and CANNOT be spoofed by the client: an inbound header of that name is
 * overwritten at the edge. `X-Forwarded-For` can be, which is why it is not read
 * here and must never be added as a fallback.
 */
export function callerKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

/**
 * `null` when the caller may proceed, or the 429 to send back.
 *
 * `warnFor` names the route in the log line, because a limiter that is silently
 * absent in production is the same as no limiter, and the only way anyone would
 * find out is this line.
 */
export async function rateLimited(
  limiter: RateLimiter | undefined,
  request: Request,
  warnFor: string,
): Promise<Response | null> {
  if (!limiter) {
    console.warn(`no rate limiter bound for ${warnFor}: the route is open and uncapped in volume.`)
    return null
  }
  let allowed = true
  try {
    const { success } = await limiter.limit({ key: callerKey(request) })
    allowed = success
  } catch (e) {
    /*
     * A limiter that throws must not take the route with it. The same reasoning
     * as a missing binding: the request is not less authorised because a
     * counter was unreachable, and the route's real defences did not move.
     */
    console.warn(`rate limiter for ${warnFor} threw, allowing: ${String(e)}`)
    return null
  }
  if (allowed) return null

  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      message:
        'Trop d’envois depuis cette connexion. Patientez une minute et réessayez : votre création n’est pas perdue.',
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '60',
      },
    },
  )
}
