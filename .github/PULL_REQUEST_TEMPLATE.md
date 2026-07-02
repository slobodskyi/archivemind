## What & why
(one or two sentences)

## How to verify
(steps to check it works)

## AI-assisted review checklist
- [ ] Diff does exactly what's described — no unrelated scope creep
- [ ] All imports/APIs actually exist in installed package versions (no hallucinated APIs)
- [ ] Tests (if any) would actually fail if the bug reappeared
- [ ] No tests deleted/skipped, no CI check weakened, to make this pass
- [ ] `npm run lint`, `npx tsc --noEmit`, and `npm run build` all pass locally
- [ ] Any new dependency exists on npm and is actively maintained
- [ ] No secrets/API keys committed
