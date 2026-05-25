# Email Verification Redirect

## Target Redirect

All Syntrix account verification and password reset emails must redirect to:

```text
https://syntrix-one.vercel.app/login
```

## Required Nhost Setting

Add the URL above to the Nhost Auth allowed redirect URLs.

If Nhost rejects the redirect URL, the backend intentionally fails account creation or resend verification instead of retrying without `redirectTo`. Retrying without `redirectTo` can make Nhost send a localhost link, for example:

```text
http://localhost:3000/?error=invalid-ticket&errorDescription=Invalid+ticket
```

## Backend Env

Set this value in Vercel backend:

```env
NHOST_EMAIL_REDIRECT_TO=https://syntrix-one.vercel.app/login
```

In production, backend also falls back to the same production URL if the variable is empty or accidentally points to localhost.
