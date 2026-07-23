# Security Policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch.
Older unsigned desktop builds should be replaced with the newest release.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** button in the repository's
Security tab. Do not open a public issue for an undisclosed vulnerability.

Include the affected version, reproduction steps, impact, and any suggested
mitigation. Please avoid accessing data that is not your own.

## Deployment boundary

Atlas of Thought Solo mode has no multi-user authentication. It is designed
for the Electron app or a source server bound to loopback. Do not expose the
server to a network unless you deliberately set `ATLAS_ALLOW_NETWORK=1` and
place an independently configured authentication layer in front of it.
