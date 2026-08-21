import { NextResponse } from "next/server";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { db } from "@/app/lib/db";
import { verifySession } from "@/app/lib/dal";
import { applyBuy, applySell, validateTrade } from "./trade-math";

// Generous relative to the relay's ~1s write throttle, tight enough to
// catch a relay that's actually down (PLAN step 32).
const STALENESS_THRESHOLD_MS = 10_000;

const bodySchema = z.object({
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number(),
});

export async function GET(request: Request) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const symbol = new URL(request.url).searchParams.get("symbol");
  const trades = await db.trade.findMany({
    where: { userId: session.userId, ...(symbol ? { symbol } : {}) },
    orderBy: { executedAt: "desc" },
  });
  return NextResponse.json(trades);
}

export async function POST(request: Request) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const { symbol, side, quantity } = parsed.data;

  const [user, holding, symbolState] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: session.userId } }),
    db.holding.findUnique({ where: { userId_symbol: { userId: session.userId, symbol } } }),
    db.symbolState.findUnique({ where: { symbol } }),
  ]);

  // Missing row is treated identically to stale (PLAN step 32) — covers the
  // race where a symbol was just subscribed to and its first write hasn't
  // landed yet, same as a relay that's genuinely down.
  const isMarketDataStale =
    !symbolState || Date.now() - symbolState.updatedAt.getTime() > STALENESS_THRESHOLD_MS;
  const price = symbolState?.lastPrice.toString() ?? "0";
  const position = holding
    ? { quantity: holding.quantity, avgCostBasis: holding.avgCostBasis.toString() }
    : null;

  const rejection = validateTrade({
    side,
    quantity,
    price,
    cashBalance: user.cashBalance.toString(),
    position,
    isHalted: symbolState?.isHalted ?? false,
    isMarketDataStale,
  });
  if (rejection) {
    return NextResponse.json({ error: rejection }, { status: 422 });
  }

  const mathResult =
    side === "BUY" ? applyBuy(position, quantity, price) : applySell(position!, quantity, price);

  const totalValue = new Decimal(price).times(quantity);
  const newCashBalance =
    side === "BUY"
      ? new Decimal(user.cashBalance.toString()).minus(totalValue)
      : new Decimal(user.cashBalance.toString()).plus(totalValue);

  const [trade, updatedUser, updatedHolding] = await db.$transaction(async (tx) => {
    const createdTrade = await tx.trade.create({
      data: { userId: session.userId, symbol, side, quantity, price },
    });

    const newUser = await tx.user.update({
      where: { id: session.userId },
      data: { cashBalance: newCashBalance.toFixed(4) },
    });

    let newHolding = null;
    if (mathResult.quantity > 0) {
      newHolding = await tx.holding.upsert({
        where: { userId_symbol: { userId: session.userId, symbol } },
        create: {
          userId: session.userId,
          symbol,
          quantity: mathResult.quantity,
          avgCostBasis: mathResult.avgCostBasis,
        },
        update: { quantity: mathResult.quantity, avgCostBasis: mathResult.avgCostBasis },
      });
    } else {
      // Fully sold out — no zero-quantity Holding rows persist.
      await tx.holding.deleteMany({ where: { userId: session.userId, symbol } });
    }

    return [createdTrade, newUser, newHolding] as const;
  });

  return NextResponse.json(
    { trade, holding: updatedHolding, cashBalance: updatedUser.cashBalance },
    { status: 201 }
  );
}
