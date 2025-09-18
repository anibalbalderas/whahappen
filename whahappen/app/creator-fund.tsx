// app/top/creator-fund.tsx
import React, { useEffect, useState, useMemo } from "react";
import { View, Text, TouchableOpacity, ScrollView, StatusBar } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { auth, db } from "../lib/firebase";
import { doc, getDoc } from "firebase/firestore";
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
      const liveSnap = await getDoc(doc(db, "public", "creatorFund", "state", "current"));
      setLive((liveSnap.data() as any) || null);

      if (me) {
        const ptsSnap = await getDoc(doc(db, "metrics", "monthly", yyyymm, "creatorPoints", me));
        setMyPoints(Number((ptsSnap.data() as any)?.points || 0));

        const wSnap = await getDoc(doc(db, "wallets", me));
        setBalance(Number((wSnap.data() as any)?.balanceMXN || 0));
      }
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

        {/* Header fijo */}
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
          <TouchableOpacity
            onPress={goBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.9}
          >
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
            paddingTop: TOP + 20, // espacio para el header
            paddingBottom: (insets.bottom || 12) + 24,
            paddingHorizontal: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Tarjeta resumen mes en curso */}
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
              ${live?.poolProjected?.toFixed(2) ?? "—"} MXN
            </Text>
            <Text style={{ color: "#c6cbd2" }}>Rate estimado</Text>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 22, marginBottom: 10 }}>
              ${live?.rateMXN?.toFixed(4) ?? "0"} por punto
            </Text>
            <Text style={{ color: "#9aa0a6" }}>
              Piso: ${live?.floorMXN ?? 10000} MXN • {Math.round((live?.revenueShare ?? 0.1) * 100)}% de ingresos
              (el mayor).
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

          {/* Cómo ganar más puntos */}
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
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>
              • 1 view válido (+1 extra ≥50% retención, +2 si ≥85%)
            </Text>
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>• Like de otra persona: +5</Text>
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>
              • Comentario (máx. 2 por usuario/video): +8
            </Text>
            <Text style={{ color: "#c6cbd2", marginBottom: 6 }}>• Share medible: +12</Text>
            <Text style={{ color: "#c6cbd2" }}>• Bono por subir el reto del día: +20</Text>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}
