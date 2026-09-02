# Project principles

## Product contract

- Treat implementation, interface copy, tests, documentation, and release notes as views of one user-visible contract. When behaviour changes, reconcile every affected view.
- Make an operation's object, scope, effect, and recovery path understandable. Keep global preferences, one-off actions, persisted data, and the current capture semantically distinct.
- Write each language as native product copy. Prefer the user's goal and outcome over internal terminology, and claim only behaviour the implementation guarantees.

## Design and architecture

- Give each domain behaviour one authoritative implementation. Share rules, state transitions, and side effects across surfaces while allowing each surface to own its presentation.
- Organize modules and screens around stable responsibilities. Before adding a feature, decide whether it deepens an existing boundary, requires a new boundary, or reveals duplication to remove.
- Keep interaction geometry stable across hover, focus, progress, success, and failure. Transient presentation must preserve more important business state and must not create accidental movement or layout shift.
- Make capabilities discoverable through visible affordances and keyboard feedback. Match prominence, confirmation, and recovery to an action's frequency, consequence, and reversibility.
- Use progressive disclosure: keep frequent, low-risk choices close to the task; explain and contain infrequent, costly, or risky choices at the point of decision.

## Privacy and platform boundaries

- Minimize stored data, external access, and permissions. Request additional capability only in response to a user action, make it understandable and reversible, and surface degradation instead of implying success.
- Treat browser security, coordinate systems, rendering technologies, and third-party resources as explicit boundaries. Design a general fallback or honest limitation instead of accumulating site-specific exceptions.

## Verification and delivery

- Test stable contracts: user outcomes, state transitions, data integrity, and safety boundaries. Match assertion precision to contract strength, reproduce regressions with the same observable signal, and control rendering or timing uncertainty explicitly.
- Declare completion from evidence. Distinguish checks that ran, checks that were blocked, and areas outside the verified scope.
- Keep changes traceable by aligning code, tests, documentation, assets, commits, and release records around the same intent. Preserve one authoritative source for each behaviour or asset and derive secondary forms from it.

## Context pointers

- For test design, browser-test structure, regression coverage, or assertion strictness, read `test/README.md` before changing tests.
- For user-visible changes, changelog fragments, or release preparation, read `.changes/README.md` and the release section of `README.md` before preparing the change.
- For naming, attribution, product copy, colours, icons, or other visual assets, read `docs/brand-guidelines.md` before changing the interface or assets.
- For setup, supported settings, privacy claims, permissions, and documented limitations, consult `README.md` and keep `README_CN.md` semantically aligned.
