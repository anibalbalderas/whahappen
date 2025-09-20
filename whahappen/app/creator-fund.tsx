// app/top/creator-fund.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StatusBar } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../lib/firebase";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { useRouter } from "expo-router";

const BackgroundDecor = () => (
  <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
    <LinearGradient
      colors={["rgba(124,77,255,0.28)", "rgba(124,77,255,0.0)"]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ position: "absolute", width: 320, height: 320, borderRadius: 160, top: -80, left: -80 }}
    />
    <LinearGradient
      colors={["rgba(255,77,222,0.22)", "rgba(255,77,222,0.0)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ position: "absolute", width: 260, height: 260, borderRadius: 130, top: 220, right: -70 }}
    />
  </View>
);

type PublicCurrent = {
  yyyymm: string;
  poolProjected: number;
  rateMXN: number;
  totalPoints: number;
  floorMXN: number;
  revenueShare: number;
};

function daysInMonth(yyyymm: string) {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export default function CreatorFund() {
  const insets = useSafeAreaInsets();
  const r = useRouter();
  const me = auth.currentUser?.uid || null;

  const [live, setLive] = useState<PublicCurrent | null>(null);
  const [myPoints, setMyPoints] = useState<number>(0);
  const [balance, setBalance] = useState<number>(0);

  const yyyymm = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  useEffect(() => {
    (async () => {
      // 1) Estado público del fondo
      const curSnap = await getDoc(doc(db, "public", "creatorFund", "state", "current"));
      const base: PublicCurrent = {
        yyyymm,
        poolProjected: 10000,
        rateMXN: 0,
        totalPoints: 0,
        floorMXN: 10000,
        revenueShare: 0.10,
        ...(curSnap.data() as any),
      };
      setLive(base);

      // 2) Billetera
      if (me) {
        const w = await getDoc(doc(db, "wallets", me));
        setBalance(Number((w.data() as any)?.balanceMXN || 0));
      }

      // 3) Mis puntos mensuales (metrics_monthly)
      let myMonthly = 0;
      if (me) {
        const m = await getDoc(doc(db, "metrics_monthly", yyyymm, "creatorPoints", me));
        if (m.exists()) {
          myMonthly = Number((m.data() as any)?.points || 0);
        }
      }

      // 4) Fallback: si no hay metrics_monthly, sumar desde leaderboardDaily
      if (myMonthly === 0 && me) {
        const last = daysInMonth(yyyymm);
        let acc = 0;
        for (let i = 1; i <= last; i++) {
          const iso = `${yyyymm}-${String(i).padStart(2, "0")}`;
          const snap = await getDoc(doc(db, "leaderboardDaily", iso));
          const arr = ((snap.data() as any)?.topCreators || []) as any[];
          const mine = arr.find((r) => r?.uid === me);
          if (mine) {
            acc +=
              (Number(mine.views || 0) * 1) +
              (Number(mine.likes || 0) * 5) +
              (Number(mine.comments || 0) * 8) +
              (Number(mine.reposts || 0) * 12) +
              (Number(mine.posts || 0) * 20);
          }
        }
        myMonthly = acc;
      }
      setMyPoints(myMonthly);

      // 5) Calcular rate provisional si el público viene en 0
      let totalPts = Number(base.totalPoints || 0);
      if (!totalPts) {
        try {
          const col = collection(db, "metrics_monthly", yyyymm, "creatorPoints");
          const snaps = await getDocs(col);
          snaps.forEach((d) => (totalPts += Number((d.data() as any)?.points || 0)));
        } catch {
          totalPts = 0;
        }
      }

      const pool =
        Number(base.poolProjected || 0) > 0 ? Number(base.poolProjected) : 10000;
      const rate =
        Number(base.rateMXN || 0) > 0
          ? Number(base.rateMXN)
          : totalPts > 0
          ? Number((pool / totalPts).toFixed(6))
          : 0;

      setLive((prev) =>
        prev
          ? { ...prev, poolProjected: pool, rateMXN: rate, totalPoints: totalPts }
          : { ...base, poolProjected: pool, rateMXN: rate, totalPoints: totalPts }
      );
    })().catch(() => {});
  }, [me, yyyymm]);

  const projected = live && myPoints > 0 ? +(myPoints * (live.rateMXN || 0)).toFixed(2) : 0;

  const TOP = (insets.top || 12) + 8;
  const goBack = () => {
    if ((r as any).canGoBack?.()) r.back();
    else r.replace("/top");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }} edges={["top", "bottom"]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <LinearGradient colors={["#000", "#000"]} style={{ flex: 1 }}>
        <BackgroundDecor />

        {/* Header */}
        <View
          style={{
            position: "absolute",
            top: 8,
            left: 12,
            right: 12,
            zIndex: 30,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <TouchableOpacity onPress={goBack} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.9}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>

          <View style={{ alignItems: "center", flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>Recompensas</Text>
            <Text style={{ color: "#9aa0a6", marginTop: 2, fontSize: 12 }}>
              Gana dinero por tu impacto mensual
            </Text>
          </View>

          <View style={{ width: 28 }} />
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingTop: TOP + 20,
            paddingBottom: (insets.bottom || 12) + 24,
            paddingHorizontal: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Resumen del mes */}
          <View
            style={{
              backgroundColor: "#111319",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#202635",
              padding: 16,
              marginBottom: 12,
            }}
          >
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>
              Mes: <Text style={{ color: "#fff", fontWeight: "700" }}>{yyyymm}</Text>
            </Text>
            <Text style={{ color: "#c6cbd2" }}>Pool proyectado</Text>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 28, marginBottom: 6 }}>
              ${Number(live?.poolProjected ?? 10000).toFixed(2)} MXN
            </Text>
            <Text style={{ color: "#c6cbd2" }}>Rate estimado</Text>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22, marginBottom: 10 }}>
              ${Number(live?.rateMXN ?? 0).toFixed(6)} por punto
            </Text>
            <Text style={{ color: "#9aa0a6" }}>
              Piso: ${Number(live?.floorMXN ?? 10000).toFixed(0)} MXN •{" "}
              {Math.round((live?.revenueShare ?? 0.1) * 100)}% de ingresos (el mayor).
            </Text>
          </View>

          {/* Mis puntos y proyección */}
          <View
            style={{
              backgroundColor: "#111319",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#202635",
              padding: 16,
              marginBottom: 12,
            }}
          >
            <Text style={{ color: "#c6cbd2" }}>Mis puntos del mes</Text>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 26, marginBottom: 8 }}>{myPoints}</Text>
            <Text style={{ color: "#c6cbd2" }}>Pago estimado</Text>
            <Text style={{ color: "#00E676", fontWeight: "900", fontSize: 26, marginBottom: 8 }}>
              ${projected.toFixed(2)} MXN
            </Text>
            <Text style={{ color: "#9aa0a6" }}>
              Saldo en mi billetera: <Text style={{ color: "#fff", fontWeight: "800" }}>${balance.toFixed(2)} MXN</Text>
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => r.push("/wallet")} activeOpacity={0.9} style={{ flex: 1 }}>
                <View style={{ backgroundColor: "#fff", paddingVertical: 12, borderRadius: 10, alignItems: "center" }}>
                  <Text style={{ color: "#000", fontWeight: "900" }}>Ir a mi billetera</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Cómo se calculan los puntos */}
          <View
            style={{
              backgroundColor: "#0f1117",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#202635",
              padding: 16,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "800", marginBottom: 8 }}>Cómo se calculan los puntos</Text>
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>• 1 view válido (+1 extra ≥50% retención, +2 si ≥85%)</Text>
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>• Like de otra persona: +5</Text>
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>• Comentario (máx. 2 por usuario/video): +8</Text>
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>• Share medible: +12</Text>
            <Text style={{ color: "#c6cbd2" }}>• Bono por subir el reto del día: +20</Text>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}
