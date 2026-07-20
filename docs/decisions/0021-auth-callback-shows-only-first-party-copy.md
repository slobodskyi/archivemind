# 0021. The auth callback surfaces a reason code, never the provider's own message

Date: 2026-07-20

Status: Accepted

## Context

Google login shipped (#89) and made `/auth/callback` a public entry point that
strangers can now aim a victim at. Two defects in that route were fixed the same
day, and both turned on the same question: what is the callback allowed to carry
back to `/login`?

Before #91, every failure redirected to `/login?error=confirm` and nothing read
it — `login/page.tsx` took no `searchParams`, so a failed sign-in rendered a
normal, fully-populated login card with no explanation at all. The user's only
signal that anything went wrong was that they were still logged out. That is the
problem #91 set out to fix, and the obvious fix is to forward what the provider
told us: Supabase puts `error`, `error_code` and `error_description` on the
query string, and `error_description` is already a human sentence.

The first implementation did exactly that, behind a filter that rejected
anything that did not look like prose — no markup, no JWTs, no control
characters, length-capped, at least two words, no word over 30 characters. An
adversarial review pass proved the filter airtight against every payload it was
written to stop: a brute force over U+0000–U+2FFFF found zero accepted
codepoints in the Cf/Cc/Zs/Zl/Zp/M categories, so bidi overrides, zero-width
characters and combining marks are all excluded, and `<`, `>`, `&`, `/`, `@`
fall outside the character class. React escapes the value anyway — it is a JSX
text child, and `dangerouslySetInnerHTML` appears nowhere in `apps/web`. There
was no XSS.

The filter still failed, because it validated **shape** and the attack is
**provenance**. A scam written as ordinary prose *is* the accepted shape:

```
https://www.archivemind.media/login?auth_error=x&auth_error_description=
  ArchiveMind+Security:+your+archive+is+locked.+Call+1+833+214+7788+within+24+hours.
```

That renders on the real production domain, under a real certificate, in the
app's own red error line, on the credential-entry page, with no quoting and no
"the provider reported:" framing to tell the reader it is not first-party copy.
Digits and spaces are permitted, so phone numbers work; `-` and `.` are
permitted, so `archivemind-support.com` reads as a domain a user will retype.
No callback is involved — `/login` is public in `proxy.ts`, so a plain GET on the
crafted URL is enough. A login page is precisely where that payload converts.

A second, unrelated defect in the same file pointed the same way: `MESSAGES` was
a plain object literal, so `MESSAGES[code]` walked the prototype chain and
`/login?auth_error=constructor` returned `Object` itself, which then crossed the
server→client boundary as a prop and broke the page. Anything reached by a raw
query-string value needs deliberate handling, not incidental handling.

## Decision

`/auth/callback` sends a **reason code only** — `/login?auth_error=<code>` — and
`/login` maps that code to copy we wrote ourselves. The provider's
`error_description` is neither forwarded nor stored nor rendered. An unknown
code, an empty code, and a code we have no copy for all resolve to one generic
sentence.

Supporting details, each load-bearing:

- The param is set **unconditionally**, even empty. Its presence is the signal
  that a real callback failed, so a bare hit on the route still surfaces
  something rather than silently rendering a clean card.
- `MESSAGES` is built on a **null prototype**. The key is attacker-supplied.
- The failure redirect **replaces the query string wholesale** rather than
  mutating the inherited one, so the PKCE `code` does not ride along into the
  `/login` URL and its `Referer`.
- The success path's `?next=` goes through `safeNextUrl()`
  (`lib/safe-redirect.ts`, #90) — same principle applied to the other
  caller-supplied value on the same route.

## Consequences

We lose the provider's wording for codes we have not written copy for. In
practice that costs little: every code a user can actually hit — expired link,
cancelled consent, unconfirmed email, disabled provider, missing PKCE verifier —
is in the table, and Supabase's English is not better than ours. New codes
degrade to the generic sentence instead of leaking raw text, which is the right
default.

`/login` moved from `○ (Static)` to `ƒ (Dynamic)` in the build output. That is
inherent to reading `searchParams`, not a cost of this decision specifically, and
the page is trivial to render.

**Do not "improve" this by rendering `error_description` again.** It will look
like an obvious upgrade — more helpful errors, one line to add. It is the whole
vulnerability. If richer messages are ever genuinely needed, add codes to
`MESSAGES`; the table is the extension point. If provider text must appear, it
has to be unmistakably attributed and quoted, and that is a UI design problem,
not a filter problem — no character-class check can separate a support notice
from a scam.

The same rule extends to any future provider callback (Drive and Dropbox in
Phase 6): treat everything on the query string as attacker-authored, and render
only strings that originate in our own source.
