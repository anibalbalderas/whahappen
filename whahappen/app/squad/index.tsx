// app/squad/index.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  Platform,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  collection,
  addDoc,
} from "firebase/firestore";
import { LinearGradient } from "expo-linear-gradient";
import { auth, db } from "../../lib/firebase";
import Avatar from "../../components/Avatar";
import BottomNav from "../../components/BottomNav";

const T = {
  bg: "#000",
  card: "#0f1116",
  cardBorder: "#1f2230",
  soft: "#101318",
  hair: "#181c24",
  text: "#fff",
  textDim: "#9aa0a6",
};

const S = {
  abs: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
};

function BubbleBackground() {
  return (
    <View pointerEvents="none" style={S.abs}>
      <LinearGradient
        colors={["#05060a", "#000000"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={S.abs}
      />
      <LinearGradient
        colors={["rgba(124,77,255,0.40)", "rgba(124,77,255,0.0)"]}
        start={{ x: 0.1, y: 0.1 }}
        end={{ x: 0.9, y: 0.9 }}
        style={{
          position: "absolute",
          width: 360,
          height: 360,
          borderRadius: 180,
          top: -80,
          left: -90,
          transform: [{ rotateZ: "12deg" }],
        }}
      />
      <LinearGradient
        colors={["rgba(255,77,222,0.30)", "rgba(255,77,222,0.0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          borderRadius: 150,
          top: 180,
          right: -80,
          transform: [{ rotateZ: "-8deg" }],
        }}
      />
      <LinearGradient
        colors={["rgba(0,196,255,0.25)", "rgba(0,196,255,0.0)"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={{
          position: "absolute",
          width: 240,
          height: 240,
          borderRadius: 120,
          bottom: 120,
          left: 40,
          transform: [{ rotateZ: "18deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: -50,
          right: -40,
          width: 280,
          height: 280,
          borderRadius: 140,
          backgroundColor: "rgba(255,255,255,0.03)",
        }}
      />
    </View>
  );
}

export default function SquadHub() {
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [squad, setSquad] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  const [nameDraft, setNameDraft] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const uid = auth.currentUser?.uid || null;

  useEffect(() => {
    let unsubUser: any;
    let unsubSquad: any;

    (async () => {
      if (!uid) return;
      const uRef = doc(db, "users", uid);
      unsubUser = onSnapshot(uRef, async (snap) => {
        const u = snap.data() || {};
        setMe(u);
        const sId = u.squadId || null;
        if (!sId) {
          setSquad(null);
          setMembers([]);
          setLoading(false);
          return;
        }
        const sRef = doc(db, "squads", sId);
        unsubSquad?.();
        unsubSquad = onSnapshot(sRef, async (s) => {
          const data = s.data();
          setSquad(data ? { id: s.id, ...data } : null);
          const arr: any[] = [];
          for (const m of data?.members || []) {
            try {
              const ms = await getDoc(doc(db, "users", m));
              arr.push({ uid: m, ...(ms.data() || {}) });
            } catch {}
          }
          setMembers(arr);
          setLoading(false);
        });
      });
    })();

    return () => {
      unsubUser?.();
      unsubSquad?.();
    };
  }, [uid]);

  // Crear squad (FIX permisos: NO mandamos campos de racha)
  const createSquad = async () => {
    try {
      if (!uid) throw new Error("No hay usuario.");
      const n = nameDraft.trim();
      if (!n) return Alert.alert("Nombre requerido", "Ponle un nombre a tu squad.");
      setCreating(true);

      // Solo los campos permitidos por reglas en CREATE
      const sDoc = await addDoc(collection(db, "squads"), {
        name: n,
        owner: uid,
        members: [uid],
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "users", uid), { squadId: sDoc.id });
      setNameDraft("");
      Alert.alert("Listo", `Squad creado. Código: ${sDoc.id}`);
    } catch (e: any) {
      Alert.alert("Ups", e?.message || "No se pudo crear el squad.");
    } finally {
      setCreating(false);
    }
  };

  // Unirse a squad
  const joinSquad = async () => {
    try {
      if (!uid) throw new Error("No hay usuario.");
      const code = joinCode.trim();
      if (!code) return;
      setJoining(true);
      const sRef = doc(db, "squads", code);
      const sSnap = await getDoc(sRef);
      if (!sSnap.exists()) throw new Error("Código inválido.");
      const data = sSnap.data()!;

      if ((data.members || []).includes(uid)) {
        await updateDoc(doc(db, "users", uid), { squadId: code });
      } else {
        await updateDoc(sRef, { members: arrayUnion(uid) });
        await updateDoc(doc(db, "users", uid), { squadId: code });
      }
      setJoinCode("");
      Alert.alert("¡Bien!", "Te uniste al squad.");
    } catch (e: any) {
      Alert.alert("Ups", e?.message || "No se pudo unir.");
    } finally {
      setJoining(false);
    }
  };

  const leaveSquad = async () => {
    try {
      if (!uid || !squad?.id) return;
      const sRef = doc(db, "squads", squad.id);
      const rest = (squad.members || []).filter((m: string) => m !== uid);

      // Si es owner y queda solo, reduce miembros (o podrías borrar si tus reglas lo permiten)
      if (squad.owner === uid && rest.length === 0) {
        await setDoc(sRef, { members: [] }, { merge: true });
      } else {
        await updateDoc(sRef, { members: arrayRemove(uid) });
      }
      await updateDoc(doc(db, "users", uid), { squadId: null });
    } catch (e: any) {
      Alert.alert("Ups", e?.message || "No se pudo salir.");
    }
  };

  const shareCode = async () => {
    if (!squad?.id) return;
    const msg = `Únete a mi Squad "${squad.name}" en WhaHappen. Código: ${squad.id}`;
    try {
      await Share.share({ message: msg });
    } catch {
      if (Platform.OS === "web") {
        // fallback web
        try {
          // @ts-ignore
          await navigator.clipboard?.writeText(msg);
          Alert.alert("Código copiado", msg);
        } catch {
          Alert.alert("Código", msg);
        }
      } else {
        Alert.alert("Código", msg);
      }
    }
  };

  const TOP = (insets.top || 12) + 8;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Fondo burbujas */}
      <BubbleBackground />

      {/* Topbar */}
      <View
        style={{
          position: "absolute",
          top: TOP,
          left: 12,
          right: 12,
          zIndex: 10,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <TouchableOpacity
          onPress={() => ((r as any).canGoBack?.() ? r.back() : r.replace("/feed"))}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={{ color: "#fff", fontWeight: "900" }}>Tu Squad</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingTop: TOP + 50,
          paddingBottom: 40,
          paddingHorizontal: 16,
        }}
      >
        {loading ? (
          <View style={{ alignItems: "center", marginTop: 40 }}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : squad ? (
          <>
            {/* Card del Squad */}
            <View
              style={{
                backgroundColor: T.card,
                borderWidth: 1,
                borderColor: T.cardBorder,
                borderRadius: 16,
                padding: 14,
              }}
            >
              <Text style={{ color: "#9aa0a6", fontWeight: "800" }}>SQUAD</Text>
              <Text
                style={{
                  color: "#fff",
                  fontWeight: "900",
                  fontSize: 22,
                  marginTop: 4,
                }}
              >
                {squad.name}
              </Text>
              <Text style={{ color: T.textDim, marginTop: 6 }}>
                Código: <Text style={{ color: "#fff" }}>{squad.id}</Text>
              </Text>

              {/* Stats pills */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: T.soft,
                    borderWidth: 1,
                    borderColor: T.cardBorder,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Ionicons name="flame" size={16} color="#ff784e" />
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    {squad.streak || 0} días
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: T.soft,
                    borderWidth: 1,
                    borderColor: T.cardBorder,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Ionicons name="people-outline" size={16} color={T.textDim} />
                  <Text style={{ color: "#fff", fontWeight: "800" }}>
                    {(squad.members || []).length} miembros
                  </Text>
                </View>
                {!!squad.lastActiveDateKey && (
                  <View
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: T.soft,
                      borderWidth: 1,
                      borderColor: T.cardBorder,
                    }}
                  >
                    <Text style={{ color: T.textDim }}>
                      Último: <Text style={{ color: "#fff" }}>{squad.lastActiveDateKey}</Text>
                    </Text>
                  </View>
                )}
              </View>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <TouchableOpacity
                  onPress={shareCode}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: "#fff",
                  }}
                >
                  <Text style={{ color: "#000", fontWeight: "900" }}>Compartir código</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={leaveSquad}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: "#121318",
                    borderWidth: 1,
                    borderColor: "#252a36",
                  }}
                >
                  <Text style={{ color: "#fff" }}>Salir del squad</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Miembros */}
            <View
              style={{
                marginTop: 16,
                backgroundColor: T.card,
                borderWidth: 1,
                borderColor: T.cardBorder,
                borderRadius: 16,
                padding: 14,
              }}
            >
              <Text style={{ color: "#9aa0a6", fontWeight: "800", marginBottom: 8 }}>
                MIEMBROS
              </Text>
              {members.length === 0 ? (
                <Text style={{ color: T.textDim }}>Sin miembros.</Text>
              ) : (
                members.map((m) => (
                  <View
                    key={m.uid}
                    style={{
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: "#181c24",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <Avatar uid={m.uid} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: "#fff", fontWeight: "800" }}>
                        {m.handle || m.displayName || m.uid?.slice(0, 8)}
                      </Text>
                      {!!m.bio && (
                        <Text numberOfLines={1} style={{ color: T.textDim, fontSize: 12 }}>
                          {m.bio}
                        </Text>
                      )}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          <>
            {/* Crear */}
            <View
              style={{
                backgroundColor: T.card,
                borderWidth: 1,
                borderColor: T.cardBorder,
                borderRadius: 16,
                padding: 14,
              }}
            >
              <Text style={{ color: "#9aa0a6", fontWeight: "800" }}>CREAR SQUAD</Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="Nombre del squad"
                placeholderTextColor="#8a8f98"
                style={{
                  marginTop: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#252a36",
                  color: "#fff",
                }}
              />
              <TouchableOpacity
                onPress={createSquad}
                disabled={creating}
                style={{
                  marginTop: 12,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: "#fff",
                  opacity: creating ? 0.6 : 1,
                }}
              >
                {creating ? (
                  <View style={{ alignItems: "center" }}>
                    <ActivityIndicator />
                  </View>
                ) : (
                  <Text style={{ color: "#000", fontWeight: "900", textAlign: "center" }}>
                    Crear
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Unirse */}
            <View
              style={{
                marginTop: 16,
                backgroundColor: T.card,
                borderWidth: 1,
                borderColor: T.cardBorder,
                borderRadius: 16,
                padding: 14,
              }}
            >
              <Text style={{ color: "#9aa0a6", fontWeight: "800" }}>UNIRME A UN SQUAD</Text>
              <TextInput
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder="Código del squad"
                placeholderTextColor="#8a8f98"
                autoCapitalize="none"
                style={{
                  marginTop: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#252a36",
                  color: "#fff",
                }}
              />
              <TouchableOpacity
                onPress={joinSquad}
                disabled={joining}
                style={{
                  marginTop: 12,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor: "#fff",
                  opacity: joining ? 0.6 : 1,
                }}
              >
                {joining ? (
                  <View style={{ alignItems: "center" }}>
                    <ActivityIndicator />
                  </View>
                ) : (
                  <Text style={{ color: "#000", fontWeight: "900", textAlign: "center" }}>
                    Unirme
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
      {/* Bottom nav */}
            <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
              <BottomNav />
            </View>
    </View>
  );
}
