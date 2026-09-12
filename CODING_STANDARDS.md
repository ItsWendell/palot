# Coding Standards

## 1. Tautological tests considered harmful

Tests must provide evidence independent of the implementation under test. Prefer assertions about observable behavior, externally defined contracts, and realistic failure modes.

Avoid tests that:

- derive the expected result from the same function, constant, or data structure used to produce the actual result;
- restate static configuration without exercising the behavior that depends on it;
- only verify behavior already guaranteed by the type system, schema, or compiler;
- assert mock setup rather than the production code's interaction with it.

A test is worth keeping when it can catch a realistic regression without requiring the same mistake to be duplicated in both the implementation and the assertion. Static contract tests are acceptable when the artifact itself is authoritative or compatibility-sensitive, but the contract and reason for protecting it should be explicit.
