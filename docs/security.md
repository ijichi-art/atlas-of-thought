# Security model

Atlas of Thought is designed for **single-user local-first use**. The
desktop app and the source-run paths are engineered so that nothing on
your local network — let alone the internet — can reach your data
without you taking deliberate steps.

## What's enforced

| Path | Bound to | Notes |
|---|---|---|
| Electron desktop app | `127.0.0.1:3892` | Hardcoded in `electron/main.js` |
| `npm run dev` | `127.0.0.1:3002` | `-H 127.0.0.1` in package.json |
| `npm run start` | `127.0.0.1:3000` | Same |
| `docker compose up` (legacy) | `127.0.0.1:3000` | `127.0.0.1:3000:3000` in compose |

If any startup binds to a non-loopback address, `src/auth.ts` throws at
module load (before any request is served) with an explanation. Solo
mode literally cannot listen on the network without an explicit
`ATLAS_ALLOW_NETWORK=1` opt-in, which exists only so operators with
their own external auth (reverse-proxy basic auth, OAuth proxy, VPN)
can bypass the guard knowing what they're doing.

## What's not enforced (and why)

- **Disk encryption.** The SQLite database stores conversation messages
  in plaintext on disk. If your laptop disk isn't encrypted (FileVault
  on macOS, BitLocker on Windows, LUKS on Linux), anyone with physical
  access to the drive can read your chat history. Disk encryption is a
  one-time OS setting and we recommend turning it on regardless of
  this app.
- **OS keychain for the encryption key.** Your `ENCRYPTION_KEY` lives
  in `.env.local` next to the ciphertext, so the encryption protects
  against casual snooping (someone glances at the SQLite file) but not
  against full filesystem access. Migrating to Keychain (macOS) /
  Credential Manager (Windows) / Secret Service (Linux) is on the
  roadmap.
- **Cloud backup exclusion.** iCloud, Time Machine, OneDrive, Dropbox
  and similar tools will back up your home directory by default,
  including the app's SQLite file. If you sync sensitive chat history,
  exclude the relevant directory:
  - macOS app: `~/Library/Application Support/Atlas of Thought/`
  - Source: the `prisma/` directory inside the repo

## What protects API keys

API keys you paste into Settings are encrypted with **AES-256-GCM**
before being persisted. The 32-byte cipher key is derived via SHA-256
from `ENCRYPTION_KEY`. We require `ENCRYPTION_KEY` to be at least 16
characters of high-entropy input — anything shorter (`"test"`,
`"secret"`, a single character) is rejected at module load to prevent
the silent generation of a guessable key.

Plaintext keys appear only in memory, only for the lifetime of the
HTTPS request to the LLM provider. They are never logged, never sent
to any third party, and never written to disk.

## Multi-user deployments

Solo mode is intentionally single-user — it has no authentication
boundary at all once you can reach the server. If you need multiple
users, either:

1. Restore the legacy NextAuth + GitHub-OAuth path from the
   `pre-solo-mode` git tag, or
2. Put external auth (reverse-proxy, OAuth proxy, VPN) in front of
   the app, set `ATLAS_ALLOW_NETWORK=1`, and accept that any user who
   reaches the app gets the same single "solo user" view of the data.

Option 1 is what we recommend for team deployments. Option 2 is
intentional shadow-IT mode for "my whole household uses one Atlas".

## Reporting a vulnerability

Please open a private security advisory on GitHub
(<https://github.com/ijichi-art/atlas-of-thought/security/advisories/new>).
Don't open a public issue for security reports.
