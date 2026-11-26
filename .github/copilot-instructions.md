# IQ-A Copilot Instructions

## Architecture

- Treat the current source, `README.md`, and `docs/PROJECT_ROADMAP.md` as the
  source of truth.
- The services use Express on AWS Lambda/API Gateway, DynamoDB repositories,
  and application-level validation. Do not reintroduce MongoDB/Mongoose unless
  explicitly requested.

## Required documentation updates

For every implementation change, update both `docs/PROJECT_ROADMAP.md` and
`README.md` in the same change set:

1. In the roadmap, add or update the task under the appropriate development
   version. Mark work complete only after implementation and verification;
   record any remaining work and relevant validation.
2. In the README, add a concise entry to the version history and update any
   affected user-facing behavior, setup, configuration, or operational
   instructions.
3. Keep the two documents consistent. Do not claim completion if required
   tests or verification have not passed.

Keep roadmap checklists as the detailed tracker and the README as the concise
project record; avoid copying entire implementation notes between them.
