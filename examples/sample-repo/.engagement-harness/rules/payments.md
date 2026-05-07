---
glob: "src/payments/**"
---
# Payment Handler Rules

All payment handlers must be idempotent. Use idempotency keys for all payment API calls to prevent double-charging.

Every payment route handler must:
1. Read the `Idempotency-Key` header from the request
2. Pass it as the `idempotencyKey` option to the payment provider
3. Return HTTP 422 if the header is missing

Stripe integrations must use `stripe.paymentIntents.create({ idempotencyKey })`, not `charges.create`.
