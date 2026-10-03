# 07: Traceable call failures

**What to build:** A user can inspect a recent call in the portal and understand which integration and downstream tool it reached, how long it took, and whether it succeeded, was denied, failed inside the tool, timed out, or could not reach the server.

**Blocked by:** 04: Per-user tool opt-in.

**Status:** ready-for-agent

- [ ] Successful, denied, and failed calls produce audit records with caller, exposed and downstream tool names, destination integration, duration, outcome, and correlation ID.
- [ ] The test client can distinguish a downstream tool result marked as an error from a gateway timeout, unavailable server, and protocol failure.
- [ ] Downstream calls have a bounded timeout, and the portal shows an actionable failure outcome instead of an indefinitely pending call.
- [ ] The portal shows recent call records and lets the user correlate a client failure with its record.
- [ ] Default records and portal responses do not contain credential values or tool arguments; public-surface checks cover representative success and failure cases.
