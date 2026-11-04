import { getPrice } from "../cache/prices";

export async function checkout(req: CheckoutRequest): Promise<Receipt> {
  let total = 0;
  for (const item of req.items) {
    total += (await getPrice(item.sku)) * item.qty;
  }
  return { total, currency: "EUR" };
}

interface CheckoutRequest { items: { sku: string; qty: number }[] }
interface Receipt { total: number; currency: string }
