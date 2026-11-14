# Contributing

1. Branch from `main`: `feat/...`, `fix/...`, `docs/...`.
2. Use Conventional Commits (`feat(hw-simulator): add reconnect backoff`).
3. Run `./scripts/run-tests.sh` before pushing. Every layer that can run on your machine must pass.
4. Keep firmware changes inside `firmware-patch/` small and generic; firmware-specific code belongs in `sim_transport.c` only.
5. Security issues in Cypherock firmware go to bounty@cypherock.com, never to a public issue.
