// functions/src/creator-fund.ts
import { onSchedule } from "firebase-functions/v2/scheduler";
import { db, FieldValue, Timestamp } from "./firebaseAdmin";

const TZ = "America/Matamoros";

/** === Helpers de fechas === */
function monthKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function monthRangeYYYYMM(yyyy_mm: string) {
  const [y, m] = yyyy_mm.split("-").map(Number);
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0); // exclusivo
  return { start, end };
}
function currentMonthRange() {
  return monthRangeYYYYMM(monthKey());
}
function previousMonthKey() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return monthKey(d);
}

/** === Config por defecto === */
const DEFAULTS = {
  monthlyFloorMXN: 10000,
  revenueShare: 0.10,  // 10%
  monthlyCapPct: 0.15, // 15% del pool por usuario
};

async function getEconomyConfig() {
  const snap = await db.collection("config").doc("economy").get();
  const cfg = snap.exists ? (snap.data() as any) : {};
  return {
    monthlyFloorMXN: Number(cfg?.monthlyFloorMXN ?? DEFAULTS.monthlyFloorMXN),
    revenueShare: Number(cfg?.revenueShare ?? DEFAULTS.revenueShare),
    monthlyCapPct: Number(cfg?.monthlyCapPct ?? DEFAULTS.monthlyCapPct),
  };
}

/** Suma ingresos en rango (primero intenta revenue/events/items, luego revenue raíz) */
async function sumRevenue(start: Date, end: Date) {
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  try {
    const qs = await db
      .collection("revenue")
      .doc("events")
      .collection("items")
      .where("occurredAt", ">=", startTs)
      .where("occurredAt", "<", endTs)
      .get();

    return qs.docs.reduce((sum: number, d: any) => sum + Number((d.data() as any).amountMXN || 0), 0);
  } catch {
    const qs = await db
      .collection("revenue")
      .where("occurredAt", ">=", startTs)
      .where("occurredAt", "<", endTs)
      .get();

    return qs.docs.reduce((sum: number, d: any) => sum + Number((d.data() as any).amountMXN || 0), 0);
  }
}

/**
 * Rollup diario -> mensual.
 * Lee puntos diarios y los vuelca en metrics_monthly/{YYYY-MM}/creatorPoints/{uid}
 * (también funciona si tienes el esquema legacy metrics/daily/{day}/creatorPoints/items).
 */
export const rollupDailyToMonthly = onSchedule(
  { schedule: "every day 23:59", timeZone: TZ, retryCount: 0 },
  async () => {
    const { start, end } = currentMonthRange();
    const today = new Date();

    const yyyymm = monthKey();
    const monthlyCol = db.collection("metrics_monthly").doc(yyyymm).collection("creatorPoints");

    // Lista todos los días del mes hasta hoy
    const days: string[] = [];
    const d = new Date(start);
    while (d < end && d <= today) {
      const dayKey = d.toISOString().slice(0, 10);
      days.push(dayKey);
      d.setDate(d.getDate() + 1);
    }

    const pointsByUser: Record<string, number> = {};

    for (const day of days) {
      // Esquema nuevo preferido: metrics_daily/{day}/creatorPoints/{uid}
      const primaryCol = db.collection("metrics_daily").doc(day).collection("creatorPoints");
      let snap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData> | null = null;

      try {
        snap = await primaryCol.get();
      } catch {
        snap = null;
      }

      // Esquema legacy: metrics/daily/{day}/creatorPoints/items/{uid}
      if (!snap || snap.empty) {
        try {
          const legacyItems = await db
            .collection("metrics")
            .doc("daily")
            .collection(day)
            .doc("creatorPoints")
            .collection("items")
            .get();

          legacyItems.forEach((docu: any) => {
            const uid = docu.id;
            const pts = Number((docu.data() as any).points || 0);
            if (!uid || !pts) return;
            pointsByUser[uid] = (pointsByUser[uid] || 0) + pts;
          });
          continue;
        } catch {
          // no-op
        }
      }

      if (snap && !snap.empty) {
        snap.forEach((docu: any) => {
          const uid = docu.id;
          const pts = Number((docu.data() as any).points || 0);
          if (!uid || !pts) return;
          pointsByUser[uid] = (pointsByUser[uid] || 0) + pts;
        });
      }
    }

    const batch = db.batch();
    // Escribimos el acumulado exacto del mes (no increment), para ser idempotentes
    for (const [uid, pts] of Object.entries(pointsByUser)) {
      const ref = monthlyCol.doc(uid);
      batch.set(ref, { points: pts }, { merge: true });
    }
    await batch.commit();

    // Snapshot "live" muy simple (opcional)
    const total = Object.values(pointsByUser).reduce((s, v) => s + v, 0);
    await db
      .collection("public")
      .doc("creatorFund")
      .collection("state")
      .doc("current")
      .set(
        {
          yyyymm,
          // solo marcamos que hubo actualización; publishCreatorFundLive calcula rate y pool
          lastRollupAt: Timestamp.now(),
          lastPointsAdded: total,
        },
        { merge: true }
      );
  }
);

/** Publica proyección del mes en curso (pool provisional y rate estimado) */
export const publishCreatorFundLive = onSchedule(
  { schedule: "every 4 hours", timeZone: TZ, retryCount: 0 },
  async () => {
    const cfg = await getEconomyConfig();
    const yyyymm = monthKey();
    const { start } = currentMonthRange();

    // puntos MTD (metrics_monthly)
    const pointsSnap = await db
      .collection("metrics_monthly")
      .doc(yyyymm)
      .collection("creatorPoints")
      .get()
      .catch(() => null as any);

    const totalPoints =
      pointsSnap && !pointsSnap.empty
        ? pointsSnap.docs.reduce((sum: number, d: any) => sum + Number((d.data() as any).points || 0), 0)
        : 0;

    // ingresos MTD
    const revenueMTD = await sumRevenue(start, new Date());
    const poolProjected = Math.max(cfg.monthlyFloorMXN, revenueMTD * cfg.revenueShare);
    const rate = totalPoints > 0 ? poolProjected / totalPoints : 0;

    await db
      .collection("public")
      .doc("creatorFund")
      .collection("state")
      .doc("current")
      .set(
        {
          yyyymm,
          poolProjected,
          totalPoints,
          rateMXN: rate,
          floorMXN: cfg.monthlyFloorMXN,
          revenueShare: cfg.revenueShare,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
  }
);

/** Liquida el mes anterior: reparte pool y deposita en wallets */
export const settleCreatorFundMonthly = onSchedule(
  { schedule: "1 of month 00:15", timeZone: TZ, retryCount: 0 },
  async () => {
    const cfg = await getEconomyConfig();
    const prev = previousMonthKey();
    const { start, end } = monthRangeYYYYMM(prev);

    // Total puntos del mes anterior
    const pointsSnap = await db
      .collection("metrics_monthly")
      .doc(prev)
      .collection("creatorPoints")
      .get();

    const rows = pointsSnap.docs
      .map((d: any) => ({ uid: d.id, points: Number((d.data() as any).points || 0) }))
      .filter((r: any) => r.points > 0);

    const totalPoints = rows.reduce((s: number, r: any) => s + r.points, 0);
    if (totalPoints === 0) {
      await db
        .collection("public")
        .doc("creatorFund")
        .collection("history")
        .doc(prev)
        .set(
          { yyyymm: prev, poolMXN: 0, totalPoints: 0, rateMXN: 0, closedAt: Timestamp.now() },
          { merge: true }
        );
      return;
    }

    // Pool = max(piso, 10% ingresos)
    const revenue = await sumRevenue(start, end);
    const pool = Math.max(cfg.monthlyFloorMXN, revenue * cfg.revenueShare);
    const cap = pool * cfg.monthlyCapPct; // tope por usuario
    const rate = pool / totalPoints;

    const batch = db.batch();
    const payoutsRef = db.collection("payouts").doc("monthly").collection(prev);

    for (const r of rows) {
      let amount = +(r.points * rate).toFixed(2);
      if (amount > cap) amount = +cap.toFixed(2);

      batch.set(payoutsRef.doc(r.uid), {
        points: r.points,
        rateMXN: rate,
        amountMXN: amount,
        createdAt: Timestamp.now(),
      });

      const wRef = db.collection("wallets").doc(r.uid);
      batch.set(wRef, { balanceMXN: 0 }, { merge: true });
      batch.update(wRef, { balanceMXN: FieldValue.increment(amount) });
    }

    // Snapshot histórico público
    batch.set(
      db.collection("public").doc("creatorFund").collection("history").doc(prev),
      {
        yyyymm: prev,
        poolMXN: pool,
        revenueMXN: revenue,
        floorMXN: cfg.monthlyFloorMXN,
        share: cfg.revenueShare,
        capPct: cfg.monthlyCapPct,
        totalPoints,
        rateMXN: rate,
        closedAt: Timestamp.now(),
      },
      { merge: true }
    );

    await batch.commit();
  }
);
