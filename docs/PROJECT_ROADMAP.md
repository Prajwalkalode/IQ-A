# IQ-A Project Roadmap

This document tracks completed milestones and planned work by development
version. Update the checkboxes as work is implemented and verified. It records
the current plan, not a promise that every future item will ship in a specific
release.

## Version history

The summaries below are based on the merged history of `developing/1.0` and
`developing/1.1`:

- `developing/1.0` snapshot: `c65f220` (2026-10-24)
- `developing/1.1` snapshot: `74799f6` (2026-11-26)

## 1.0 - Local services with MongoDB

**Status: Complete**

- [x] Set up the project and separate identity, question, quiz, and submission
  services.
- [x] Implement the core identity, question, quiz, and submission APIs using
  MongoDB/Mongoose for local development.
- [x] Add authentication and role-based access for student, teacher, and admin
  operations.
- [x] Add service tests and automated validation for pushes and pull requests.

## 1.1 - Serverless cloud deployment

**Status: Core implementation complete; lifecycle verification remains**

- [x] Migrate persistence from MongoDB/Mongoose to DynamoDB repositories and
  application-level validation.
- [x] Package all four services for AWS Lambda and expose them through API
  Gateway HTTP APIs provisioned with Terraform.
- [x] Configure service-to-service URL discovery through SSM.
- [x] Add manual deploy and confirmed destroy workflows.
- [x] Add data-preservation and reseed workflows for the five DynamoDB tables.
- [x] Add service linting, tests, and the OpenAPI specification in
  [openapi.yaml](./openapi.yaml).
- [x] Add repository Copilot guidance to keep the README and roadmap updated
  together for future changes.
- [x] Manually verify the live student flow: create and read a question, create
  a quiz, start it, submit an answer, and retrieve results.
- [x] Verify a preserve -> destroy -> redeploy -> restore cycle, including
  representative read checks after restore.
- [x] Verify destroy removes the intended application resources while
  preserving Terraform state and external backups.
- [x] Repeat deploy/destroy using only committed workflows and remote state.

See the detailed infrastructure checklist in
[DEPLOYMENT_PIPELINES_PLAN.md](./DEPLOYMENT_PIPELINES_PLAN.md).

## 1.2 - Student quiz discovery and account recovery

**Status: Planned; `developing/1.2` branch not yet created**

### Student quiz discovery

- [ ] Add a student-authenticated API to list available active quizzes. Students
  currently need a quiz ID to start a quiz.
- [ ] Return only safe quiz metadata; do not expose questions or answer keys
  before a student starts.
- [ ] Define filtering and pagination behavior for the available-quiz list.
- [ ] Test that students can list and start available quizzes, while inactive
  quizzes and manager-only data remain inaccessible.

### Account recovery

- [ ] Add an authenticated password-change flow.
- [ ] Add a forgot/reset-password flow using a single-use, expiring reset
  mechanism.
- [ ] Choose and configure a delivery channel for reset instructions.
- [ ] Avoid revealing whether an email address has an account, and test expired,
  reused, and invalid reset requests.

## Future versions - Administration and release automation

**Status: Backlog; version to be decided**

### Secure initial admin setup

- [ ] Provide a documented, controlled way to create the first admin account.
  Public signup must continue to create students only.
- [ ] Ensure the bootstrap mechanism cannot be reused after initial setup and
  does not expose role assignment to unauthenticated callers.
- [ ] Document the supported admin and teacher account lifecycle.

### Automated live integration checks

- [ ] Extend deployment checks beyond `/health` to cover representative
  authenticated API reads and service-to-service connectivity.
- [ ] Run post-restore read checks against restored records.
- [ ] Use a dedicated test environment or clearly isolated test data so
  automated checks do not modify real quizzes or submissions.
- [ ] Report failures with enough context to identify the failing service
  without logging credentials or sensitive records.

## Progress conventions

- `[x]` Implemented and verified.
- `[ ]` Not complete.
- Keep completed work checked only when it has been tested; note whether
  verification was manual or automated when that distinction matters.
- Move deferred work to a later version only after agreeing on its scope.
- For every implementation change, update this roadmap and the README in the
  same change set. Keep the README's version summary synchronized with this
  tracker and document affected user-facing behavior or setup there.
