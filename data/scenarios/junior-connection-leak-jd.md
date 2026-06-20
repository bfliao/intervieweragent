# Job Description — Junior Backend Engineer

---

## About the Role

You'll work on the backend services that power our core product — APIs that handle
user data, background jobs, and integrations with third-party systems. The team
ships frequently and owns what it ships, which means you'll be on a rotation that
includes responding to production incidents.

This is a role for someone who wants to build intuition for how software behaves
under real load, not just in tests. You'll be writing code, reviewing code, and
occasionally debugging things that are broken in ways that weren't obvious at
design time.

---

## What You'll Do

- Build and maintain backend services and REST APIs (Node.js / TypeScript)
- Write code that handles failures explicitly — network errors, database timeouts,
  partial state — not just the happy path
- Participate in on-call rotation; respond to and document production incidents
- Review pull requests with an eye toward resource management, error handling,
  and operational correctness
- Instrument new features with logging and metrics before they ship
- Work with a MySQL database: write queries, understand indexes at a basic level,
  know when a query is doing more work than it should

---

## What We're Looking For

**You should be able to:**

- Read an error log and identify what it's literally telling you before forming
  hypotheses
- Explain what happens to a database connection if the code that opened it
  throws an exception before closing it — and why that matters at scale
- Look at a graph of slowly growing memory and connect it to a recent code change
- Distinguish between "stop the bleeding right now" and "fix the root cause" —
  and articulate the trade-offs of each under time pressure
- Write a `try/finally` block (or use a resource-management pattern) and explain
  why it exists

**You probably have:**

- 1–2 years of experience writing backend code that runs in production
- Familiarity with relational databases (MySQL or Postgres): basic queries,
  understanding of connection pools
- Some exposure to a production incident — even as an observer — and a clear
  memory of what made it stressful and what resolved it
- Opinions about what makes code easy or hard to debug six months after it's
  written

---

## Nice to Have

- Experience with a Node.js HTTP framework (Express, Fastify, or similar)
- Familiarity with connection pool libraries (`mysql2`, `pg`, `knex`)
- Has written or reviewed code that interacts with an external service
  (database, queue, third-party API) and thought carefully about what happens
  when that service is slow or unavailable
- Has added structured logging or metrics to a service and used them to
  diagnose something

---

## What We Don't Expect

You do not need to have:

- Deep database administration experience (tuning `max_connections`, replication,
  backup strategy)
- Experience with distributed systems or microservices at scale
- A computer science degree or formal algorithms background
- Prior on-call experience as the primary responder

---

## What Good Looks Like Here

The engineers who do well in this role tend to read error messages carefully
before jumping to conclusions, ask "what changed recently" early in a debug
session, and write code with an explicit model of what can go wrong — not just
what should work. They also communicate clearly when something is broken:
what they know, what they don't know, and what they're doing next.
