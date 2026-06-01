# Severity Rubric

Use this rubric when assigning severity to a finding. Each level has a definition, concrete triggers, and calibration examples pulled from the engagement-harness domain.

---

## Critical

**Definition:** Exploitable or data-destroying defect that can cause immediate, irreversible harm in production — security breach, data loss, or outage — with no additional conditions required beyond the change itself.

**Triggers:**
- User-controlled input flows unsanitized into a SQL string or shell command
- A migration adds a NOT NULL column with no DEFAULT on a table that already has rows

### Example 1 — SQL injection

```typescript
// BAD — critical
app.get('/users', async (req, res) => {
  const rows = await db.query(
    `SELECT * FROM users WHERE id = ${req.query.id}`  // ← attacker controls this
  );
  res.json(rows);
});
```

```typescript
// FIXED
app.get('/users', async (req, res) => {
  const rows = await db.query(
    'SELECT * FROM users WHERE id = ?',
    [req.query.id]   // parameterized — safe
  );
  res.json(rows);
});
```

**Why it matters:** An attacker needs only a browser and a URL to dump or delete any table.

---

### Example 2 — NOT NULL column without DEFAULT

```sql
-- BAD — critical
ALTER TABLE orders ADD COLUMN tier VARCHAR(20) NOT NULL;
-- Fails immediately on any table with existing rows
```

```sql
-- FIXED
ALTER TABLE orders ADD COLUMN tier VARCHAR(20) NOT NULL DEFAULT 'standard';
```

**Why it matters:** The migration will throw on deploy, taking the database offline mid-rollout.

---

## High

**Definition:** Defect that causes incorrect behavior, data corruption, or a compliance violation, but requires a specific condition (edge case, code path, or request) to trigger. Typically caught in QA or monitoring, not exploited instantly.

**Triggers:**
- Off-by-one error in a loop or index expression that corrupts data or causes a runtime crash
- A payment or audit-required mutation that omits the mandatory `auditLogger.record()` call

### Example 1 — Off-by-one

```typescript
// BAD — high
function processItems(items: Item[]) {
  for (let i = 0; i <= items.length; i++) {   // ← should be <
    processItem(items[i]);                     // items[items.length] is undefined → TypeError
  }
}
```

```typescript
// FIXED
function processItems(items: Item[]) {
  for (let i = 0; i < items.length; i++) {
    processItem(items[i]);
  }
}
```

**Why it matters:** Crashes the process on every non-empty input; data after the last item is skipped.

---

### Example 2 — Missing audit log on payment mutation

```typescript
// BAD — high  (violates SOC 2 audit trail requirement)
async function refundOrder(orderId: string, amount: number) {
  await db.transaction(async (trx) => {
    await trx('orders').where({ id: orderId }).update({ status: 'refunded' });
    await trx('ledger').insert({ orderId, delta: -amount });
    // auditLogger.record() call missing
  });
}
```

```typescript
// FIXED
async function refundOrder(orderId: string, amount: number) {
  await db.transaction(async (trx) => {
    await trx('orders').where({ id: orderId }).update({ status: 'refunded' });
    await trx('ledger').insert({ orderId, delta: -amount });
    await auditLogger.record({ type: 'REFUND', orderId, amount }, trx);
  });
}
```

**Why it matters:** Missing audit records fail SOC 2 audits and leave no trail for dispute resolution.

---

## Medium

**Definition:** Defect or design issue that degrades quality, maintainability, or reliability over time but does not cause immediate incorrect behavior. Usually safe to ship but should be addressed within the sprint.

**Triggers:**
- A new exported function with business logic has no unit tests
- A class or function handles two unrelated concerns, violating SRP

### Example 1 — Missing tests on exported logic

```typescript
// BAD — medium (new export, no accompanying test file)
export function calculateDiscount(price: number, code: string): number {
  if (code === 'HALF') return price * 0.5;
  if (code === 'FREE') return 0;
  return price;
}
```

**Why it matters:** Rounding edge cases (fractional cents, 0-price input) are invisible until a customer reports a billing error.

---

### Example 2 — SRP violation

```typescript
// BAD — medium
class UserService {
  async handle(req: Request, res: Response) {  // ← HTTP parsing here
    const { email, password } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await this.db.insert('users', { email, hash });   // ← and persistence here
    res.status(201).json({ email });
  }
}
```

```typescript
// BETTER — split concerns
class UserController {
  async create(req: Request, res: Response) {
    const user = await this.userService.register(req.body.email, req.body.password);
    res.status(201).json(user);
  }
}
class UserService {
  async register(email: string, password: string) {
    const hash = await bcrypt.hash(password, 10);
    return this.db.insert('users', { email, hash });
  }
}
```

**Why it matters:** The combined class cannot be unit-tested without spinning up an HTTP context.

---

## Low

**Definition:** Style, naming, or minor clarity issue. No risk to correctness or security. Fine to defer or batch into a cleanup PR.

**Triggers:**
- A variable or function name is ambiguous or uses a non-standard abbreviation
- An error is logged at the wrong level (e.g., `logger.warn` for a fatal condition) without hiding it

### Example 1 — Misleading name

```typescript
// BAD — low
async function proc(u: User, d: Date) {   // proc? u? d? — reader must guess
  await sendRenewalEmail(u, d);
}
```

```typescript
// BETTER
async function scheduleRenewalEmail(user: User, renewalDate: Date) {
  await sendRenewalEmail(user, renewalDate);
}
```

**Why it matters:** Ambiguous names slow down every future reader; rename cost is minimal.

---

### Example 2 — Wrong log level (not a silent swallow — contrast with High)

```typescript
// LOW — error is logged, just at the wrong level
try {
  await notificationService.send(event);
} catch (err) {
  logger.warn({ err }, 'notification send failed');  // should be .error, but not silent
}
```

```typescript
// Compare with HIGH (silent swallow — no log at all)
try {
  await notificationService.send(event);
} catch (_err) {
  // nothing — this would be High severity
}
```

**Why it matters:** Wrong level causes alert-routing misses in on-call tools; does not hide the failure entirely.

---

## Calibration Quick-Reference

| Severity | Immediate harm? | Specific trigger needed? | Safe to defer? |
|---|---|---|---|
| Critical | Yes | No | Never |
| High | Yes (on trigger) | Yes | No — fix before merge |
| Medium | No | N/A | Yes — same sprint |
| Low | No | N/A | Yes — cleanup PR |
