---
name: observability
description: Logging, monitoring, alerting, backups and incident response for Teeshoop. Use when adding anything whose silent failure would cost money or stall an order, when setting up or changing monitoring, when writing a runbook, and before any deploy or launch that needs to be watched.
---

# Knowing when it breaks

A small shop does not have someone watching dashboards. So the bar is different from a large
system: **the only alerts worth having are the ones that mean a human must act now**, and
everything else is a log you consult when something has already gone wrong.

## The failures that actually cost us

Ranked by what they cost, which is not the same as how often they happen.

1. **A payment that fails silently** and leaves an order in limbo. The customer thinks they
   paid; we think they did not.
2. **A BAT email that never arrives.** The order stalls forever and nobody knows, because
   nothing is broken from either side's point of view. This is the classic WordPress failure
   and it is invisible by default.
3. **A supplier call failing** during a purchase basket, so blanks are never ordered while
   film is already printed.
4. **A Worker deploy that breaks design upload.** Add-to-cart fails for everyone, and the
   site looks perfectly healthy to any uptime check pointed at the homepage.
5. **A checkout that 500s** for one payment method or one country.

Notice that four of the five are invisible to ordinary uptime monitoring. Monitor the
**buying path**, synthetically, not the homepage.

## Logging

- Log every money event, every outbound email, every supplier call, every design upload and
  every state transition, with enough identity to reconstruct one order's history.
- **No personal data in logs.** No email addresses, no addresses, no card fragments, no
  design content. An order id is enough, and logs are subject to RGPD retention too.
- Structured, so it can be searched. A wall of `error_log` prose is not observability.
- WordPress: `WP_DEBUG` on with `WP_DEBUG_DISPLAY` **off**, which is what the local mirror
  already does, because a notice printed in the middle of a JSON response corrupts it.
- Worker: `wrangler tail` for live traffic. `worker/auth.ts` already warns there when
  `ADMIN_TOKEN` is unset or too short, which is the sort of misconfiguration that must be
  loud rather than merely denied.

## Alerts

An alert nobody trusts is worse than no alert, because it trains everyone to ignore the
one that matters. So:

- Alert on **symptoms a human must act on**: payment failure rate, email send failures,
  checkout errors, Worker 5xx, supplier API failure, disk or database pressure on shared
  hosting.
- Do not alert on CPU, on a single slow request, or on anything self-healing.
- Every alert names the runbook that answers it. An alert without a next step is a
  notification.
- **Prove each one fires.** Trigger it deliberately once, in the transcript, then reset. A
  monitor that has never fired is a monitor that has never been tested.

## Runbooks

Short, in French, written for the associate rather than for a developer. One per plausible
incident: payment provider down, email provider rejecting, supplier API failing, a bad
deploy, the site down, an order printed wrong. Each says how to recognise it, what to do
first, what not to do, and who to tell.

## Backups and restore

"Backups exist" is not a state you can rely on. **A restore you have performed and timed**
is. Do it on staging, from the production dataset, and write down how long it took, because
that number is what determines whether you restore or debug during an incident.

Cover all four stores: the WordPress database, `wp-content/uploads`, the R2 bucket holding
customer artwork, and the repository itself.

## Deploys

The rollback path from session 14 is part of observability, not a separate concern: the
question during an incident is always "restore, roll back, or fix forward", and you can only
answer it if you know how long each takes.

Watch a deploy rather than announcing it. The first real order after a change will do
something none of the rehearsals did.

## Retention

Logs and metrics are personal-data-adjacent and cost money. Set a retention, document it in
the RGPD register (see the `france` skill), and delete on schedule.
