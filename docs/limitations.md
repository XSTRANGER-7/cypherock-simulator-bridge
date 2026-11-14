# Limitations and safety

## What the simulator cannot do

| Feature | Why | Workaround |
| --- | --- | --- |
| X1 card taps (NFC) | Cards are separate JavaCard secure elements; the simulator has no NFC hardware | Check whether the simulator stubs card responses; if so, document the stub. Otherwise card-dependent flows stop at the tap step |
| Device authentication | Needs keys provisioned in the ATECC608A at the factory and Cypherock's server | Skip or stub auth in simulator builds; never fake a "genuine" result for production |
| Secure element operations | No ATECC608A in the simulator | Firmware may fall back to software paths in simulator builds |
| Firmware update / bootloader | Bootloader is hardware-specific | Out of scope |
| Wallet creation and signing | Both need card shards | Depends on how the simulator stubs cards; see above |
| Timing and side-channel behaviour | Different CPU | Never use the simulator for security testing of timing |

Expect Milestone 1 (device info) and Milestone 2 (wallet list, public keys) to work first. Signing depends entirely on how the simulator handles cards.

## Safety rules

- The simulator is for development only. Never use it with real funds.
- Never import a real seed phrase into a simulator. Use test mnemonics only.
- Keep the socket on 127.0.0.1. Do not change the bind address.
- Use testnets (Sepolia, Bitcoin testnet) for every example that touches a chain.
- Simulator builds must never be signed with release keys or shipped.

## Reporting security issues

If you find a firmware vulnerability while working on this (for example a buffer overflow in a parser), do not open a public issue or PR. Email bounty@cypherock.com as described in Cypherock's bug bounty policy.
