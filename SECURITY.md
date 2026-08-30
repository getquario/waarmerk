# Security Policy

## Security considerations

Waarmerk authenticates diagnostics by identity. Each package keeps its own store, and the WeakMap behind a store never leaves this module: a caller holding a store can test membership and read an origin, and has no way to add a member. Authentication by shape — trusting an error because it carries a `code` and a `start` — is exactly what this exists to replace.

Relocation builds its copy from a class table captured at module load, never through the original's `constructor`, and reads and writes descriptors through `Object` methods captured at the same time. The `WeakMap` operations behind every store are captured the same way and always called against an explicit receiver, so a replaced `WeakMap.prototype.set` cannot stop a package authenticating what it throws. Replacing a prototype's `constructor`, an `Object` method, or a `WeakMap` method after load cannot make relocation mint an authenticated value that is not an Error.

Diagnostic fields are defined non-writable and non-configurable, so a frozen value attached at mint stays frozen through any number of relocations.

Waarmerk does not parse, and takes no untrusted text of its own. It runs in the current process and imposes no wall-clock deadline; the budgets `capped` reports belong to the package that counts them.

## Reporting a vulnerability

Do not open a public GitHub issue for a security vulnerability.

Use [GitHub's private vulnerability form](https://github.com/getquario/waarmerk/security/advisories/new).

Include the affected code, its impact, and steps that reproduce the issue. Tell us whether and how to credit you.

We do not accept AI slop reports.

Keep the report private while we investigate and prepare a fix.
