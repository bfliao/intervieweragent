# Technical Assessment

**Role:** Backend / Software Engineer — Junior
**Difficulty:** Junior

---

## Situation

It's Thursday at 2:15pm. A Slack alert fires: `user-api` error rate is at 11% and climbing.
Your team's service handles user profile reads and writes for about 8,000 requests/minute.

A new feature — "Export my data as CSV" — was deployed this morning at 9:40am.
No other changes went out today.

**What you're seeing:**

- `user-api` error rate: 0% → 11%, climbing steadily since ~10:30am
- `user-api` p99 latency: 85ms → 1,900ms
- Error log sample: `ER_CON_COUNT_ERROR: Too many connections` (repeating every few seconds)
- MySQL connection pool: 98 / 100 connections in use
- Service memory: 280MB → 510MB, growing ~5MB per minute since 10:30am
- CPU on the service: 18% (normal range 15–22%)
- The `/export` endpoint receives about 40–60 requests per hour

---

## Your Tasks

**01** — The `/export` endpoint only gets ~50 requests per hour, but MySQL is at 98/100
connections. How can so few requests cause this? Walk through your exact reasoning.

**02** — You pull up the code for the new `/export` handler and see it opens a database
connection at the top of the function. What specific thing would you look for to confirm
your hypothesis, and what does a bug there look like in code?

**03** — You've confirmed the bug. You need to stop the bleeding right now, before a fix
is deployed. What are your options, and which one do you pick?

**04** — Once service is stable, walk through what you'd add so this class of bug —
a resource not closed on the error path — gets caught before it ships next time.

---

## Scope

**Focus on**
- Reading error messages literally and tracing them to a cause
- Understanding connection lifecycle: open → use → close
- Distinguishing immediate mitigation from a proper fix
- What process or tooling prevents this class of bug from shipping

**You can skip**
- Database configuration (max_connections tuning)
- CSV formatting or export logic
- Load testing or performance benchmarking
