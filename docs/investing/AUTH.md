# Investing account access

`apps/investing-web` uses shadcn `signup-01` and `login-01` forms with LaVega styling. Public routes are `/sign-up`, `/sign-in`, `/check-email`, `/email-confirmed`, `/forgot-password`, and `/reset-password`. The app's Vite base path prefixes these routes in production.

Signup uses Better Auth email/password. It requires name, valid email, and password of 8 to 128 characters. Confirmation field must match. Successful unverified signup opens check-email screen; no session is granted until confirmation. Confirmation links expire after one hour. Better Auth verifies link, creates session, then returns to `/email-confirmed`. That page opens dashboard if session exists, otherwise offers sign-in. Invalid or expired link shows a recovery path. The check-email screen can request another verification email. Better Auth returns the same signup response for an existing address without sending another email; the check-email copy does not claim delivery in that case.

Signin uses existing `/api/auth/sign-in/email` endpoint. Password recovery uses Better Auth's `/api/auth/request-password-reset` and `/api/auth/reset-password` endpoints. Reset links expire after one hour. Password reset revokes existing sessions. Recovery request shows same success message whether an account exists or not.

`apps/server/src/authEmail.ts` sends verification and password-reset emails through Resend. Each has HTML and plain-text versions, clear expiry and ignore-this-message text, and escaped links in HTML. `RESEND_API_KEY` and `AUTH_EMAIL_FROM` must both be configured. Sender domain must be verified in Resend. Missing mail configuration fails signup mail instead of claiming delivery.
