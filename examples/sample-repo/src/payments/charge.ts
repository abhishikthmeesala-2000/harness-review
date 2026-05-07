import Stripe from 'stripe';

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY'] ?? '');

// Missing idempotency key — intentional for domain-policy eval case
export async function chargeCustomer(amount: number, customerId: string): Promise<string> {
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    customer: customerId,
  });
  return paymentIntent.id;
}
