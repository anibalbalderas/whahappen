// app/wallet.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { auth, db } from "../lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

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

type Payout = { yyyymm: string; amountMXN: number; points?: number; rateMXN?: number; createdAt?: any };
type Withdrawal = { amountMXN: number; status: "pending" | "paid" | "rejected"; createdAt?: any };

function lastMonths(n = 6): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export default function Wallet() {
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const me = auth.currentUser?.uid || null;

  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState<string>("");
  const [name, setName] = useState("");
  const [clabe, setClabe] = useState("");
  const [rfc, setRfc] = useState("");
  const [email, setEmail] = useState("");

  const TOP = (insets.top || 12) + 8;
  const goBack = () => {
    if ((r as any).canGoBack?.()) r.back();
    else r.replace("/top/creator-fund");
  };

  useEffect(() => {
    (async () => {
      try {
        if (!me) return;

        // saldo
        const w = await getDoc(doc(db, "wallets", me));
        setBalance(Number((w.data() as any)?.balanceMXN || 0));

        // pagos del fondo (últimos 6 meses)
        const months = lastMonths(6);
        const list: Payout[] = [];
        await Promise.all(
          months.map(async (key) => {
            const snap = await getDoc(doc(db, "payouts", "monthly", key, "byUser", me));
            if (snap.exists()) {
              const d = snap.data() as any;
              list.push({
                yyyymm: key,
                amountMXN: Number(d.amountMXN || 0),
                points: Number(d.points || 0),
                rateMXN: Number(d.rateMXN || 0),
                createdAt: d.createdAt,
              });
            }
          })
        );
        list.sort((a, b) => (a.yyyymm < b.yyyymm ? 1 : -1));
        setPayouts(list);

        // retiros del usuario
        const q = query(collection(db, "withdrawals"), where("uid", "==", me), orderBy("createdAt", "desc"));
        const ws = await getDocs(q);
        const wd: Withdrawal[] = ws.docs.map((d) => d.data() as any);
        setWithdrawals(wd);
      } catch (e) {
        // noop
      } finally {
        setLoading(false);
      }
    })();
  }, [me]);

  const minWithdraw = 300;

  const submitWithdrawal = async () => {
    try {
      const amt = Math.round(Number(amount) * 100) / 100;
      if (!amt || isNaN(amt)) return Alert.alert("Monto inválido", "Escribe un monto en MXN.");
      if (amt < minWithdraw) return Alert.alert("Monto mínimo", `El retiro mínimo es de $${minWithdraw} MXN.`);
      if (amt > balance) return Alert.alert("Saldo insuficiente", "No puedes retirar más que tu saldo.");

      if (!name.trim() || !email.trim() || !clabe.trim() || !rfc.trim())
        return Alert.alert("Faltan datos", "Completa nombre, correo, CLABE y RFC.");

      await addDoc(collection(db, "withdrawals"), {
        uid: me,
        amountMXN: amt,
        name: name.trim(),
        email: email.trim(),
        clabe: clabe.replace(/\s+/g, ""),
        rfc: rfc.trim().toUpperCase(),
        status: "pending",
        createdAt: serverTimestamp(),
        platform: Platform.OS,
      });

      setShowForm(false);
      setAmount("");
      Alert.alert("Solicitud enviada", "Procesaremos tu retiro en breve.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo crear la solicitud.");
    }
  };

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <Text style={{ color: "#fff", fontWeight: "800", marginBottom: 8 }}>{children}</Text>
  );

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
          <TouchableOpacity
            onPress={goBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.9}
          >
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>

          <View style={{ alignItems: "center", flex: 1 }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>Mi billetera</Text>
            <Text style={{ color: "#9aa0a6", marginTop: 2, fontSize: 12 }}>Administra tu saldo y retiros</Text>
          </View>

          <View style={{ width: 28 }} />
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingTop: TOP + 20,
            paddingBottom: (insets.bottom || 12) + 32,
            paddingHorizontal: 16,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Saldo */}
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
            <Text style={{ color: "#c6cbd2" }}>Saldo disponible</Text>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 32, marginTop: 4 }}>
              ${balance.toFixed(2)} MXN
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <TouchableOpacity onPress={() => setShowForm((v) => !v)} activeOpacity={0.9} style={{ flex: 1 }}>
                <View style={{ backgroundColor: "#fff", paddingVertical: 12, borderRadius: 10, alignItems: "center" }}>
                  <Text style={{ color: "#000", fontWeight: "900" }}>
                    {showForm ? "Ocultar formulario" : "Solicitar retiro"}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Formulario de retiro */}
            {showForm && (
              <View style={{ marginTop: 14, gap: 10 }}>
                <Text style={{ color: "#9aa0a6" }}>
                  Mínimo de retiro: ${minWithdraw} MXN. El pago se realiza por SPEI.
                </Text>

                <View style={{ gap: 8 }}>
                  <Text style={{ color: "#c6cbd2" }}>Monto (MXN)</Text>
                  <TextInput
                    keyboardType="decimal-pad"
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="Ej. 500"
                    placeholderTextColor="#7b8191"
                    style={{
                      backgroundColor: "#12141b",
                      color: "#fff",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: "#232838",
                    }}
                  />
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={{ color: "#c6cbd2" }}>Nombre completo</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Como aparece en tu cuenta"
                    placeholderTextColor="#7b8191"
                    style={{
                      backgroundColor: "#12141b",
                      color: "#fff",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: "#232838",
                    }}
                  />
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={{ color: "#c6cbd2" }}>CLABE</Text>
                  <TextInput
                    value={clabe}
                    onChangeText={setClabe}
                    placeholder="18 dígitos"
                    placeholderTextColor="#7b8191"
                    keyboardType="number-pad"
                    maxLength={18}
                    style={{
                      backgroundColor: "#12141b",
                      color: "#fff",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: "#232838",
                    }}
                  />
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={{ color: "#c6cbd2" }}>RFC</Text>
                  <TextInput
                    value={rfc}
                    onChangeText={setRfc}
                    placeholder="RFC con homoclave"
                    autoCapitalize="characters"
                    placeholderTextColor="#7b8191"
                    style={{
                      backgroundColor: "#12141b",
                      color: "#fff",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: "#232838",
                    }}
                  />
                </View>

                <View style={{ gap: 8 }}>
                  <Text style={{ color: "#c6cbd2" }}>Correo</Text>
                  <TextInput
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    placeholder="tucorreo@dominio.com"
                    placeholderTextColor="#7b8191"
                    style={{
                      backgroundColor: "#12141b",
                      color: "#fff",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: "#232838",
                    }}
                  />
                </View>

                <TouchableOpacity onPress={submitWithdrawal} activeOpacity={0.9} style={{ marginTop: 6 }}>
                  <View
                    style={{
                      backgroundColor: "#00E676",
                      paddingVertical: 12,
                      borderRadius: 10,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#003b17", fontWeight: "900" }}>Enviar solicitud</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Historial */}
          <View
            style={{
              backgroundColor: "#0f1117",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#202635",
              padding: 16,
            }}
          >
            <SectionTitle>Historial</SectionTitle>

            {loading ? (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <ActivityIndicator />
              </View>
            ) : (
              <>
                {/* Pagos del fondo */}
                <Text style={{ color: "#9aa0a6", marginBottom: 8 }}>Pagos del Fondo (últimos 6 meses)</Text>
                {payouts.length === 0 ? (
                  <Text style={{ color: "#7b8191", marginBottom: 10 }}>Sin pagos registrados.</Text>
                ) : (
                  payouts.map((p) => (
                    <View
                      key={`p-${p.yyyymm}`}
                      style={{
                        paddingVertical: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: "#1f2230",
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <View>
                        <Text style={{ color: "#fff", fontWeight: "700" }}>{p.yyyymm}</Text>
                        <Text style={{ color: "#9aa0a6" }}>
                          {p.points ?? 0} pts × ${p.rateMXN?.toFixed(4) ?? "0"} = ${p.amountMXN.toFixed(2)}
                        </Text>
                      </View>
                      <Text style={{ color: "#00E676", fontWeight: "900" }}>+${p.amountMXN.toFixed(2)}</Text>
                    </View>
                  ))
                )}

                {/* Retiros */}
                <Text style={{ color: "#9aa0a6", marginTop: 14, marginBottom: 8 }}>Retiros</Text>
                {withdrawals.length === 0 ? (
                  <Text style={{ color: "#7b8191" }}>Aún no has solicitado retiros.</Text>
                ) : (
                  withdrawals.map((w, i) => (
                    <View
                      key={`w-${i}`}
                      style={{
                        paddingVertical: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: "#1f2230",
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <View>
                        <Text style={{ color: "#fff", fontWeight: "700" }}>${Number(w.amountMXN || 0).toFixed(2)} MXN</Text>
                        <Text style={{ color: "#9aa0a6" }}>
                          {w.status === "pending" ? "Pendiente" : w.status === "paid" ? "Pagado" : "Rechazado"}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: w.status === "paid" ? "#00E676" : w.status === "rejected" ? "#ff6b6b" : "#ffd166",
                          fontWeight: "900",
                        }}
                      >
                        {w.status === "paid" ? "—" : w.status === "rejected" ? "x" : "…"}
                      </Text>
                    </View>
                  ))
                )}
              </>
            )}
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}
