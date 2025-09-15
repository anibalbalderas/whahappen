// app/top-creators.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  collection,
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

// ⬅️ Ajusta esta ruta si tu BottomNav está en otro lugar
import BottomNav from "../components/BottomNav";

// ---------- tipos ----------
type CreatorRow = {
  uid: string;
  posts: number;
  likes: number;
  reposts: number;
  views: number;
  score: number;
};

// Carga perfiles por lotes (campo uid y, si falta, por documentId)
async function fetchUsersByUids(uids: string[]) {
  const out = new Map<string, any>();
  const missing = new Set(uids);

  // 1) por campo "uid"
  for (let i = 0; i < uids.length; i += 10) {
    const chunk = uids.slice(i, i + 10);
    if (!chunk.length) break;
    const qs = await getDocs(query(collection(db, "users"), where("uid", "in", chunk)));
    qs.forEach((d) => {
      const u = d.data(); const id = u?.uid || d.id;
      out.set(id, u); missing.delete(id);
    });
  }

  // 2) por documentId (para los que falten)
  const leftovers = Array.from(missing);
  for (let i = 0; i < leftovers.length; i += 10) {
    const chunk = leftovers.slice(i, i + 10);
    if (!chunk.length) break;
    const qs = await getDocs(query(collection(db, "users"), where(documentId(), "in", chunk)));
    qs.forEach((d) => {
      const u = d.data(); const id = u?.uid || d.id;
      out.set(id, { uid: id, ...u });
    });
  }

  return out;
}

// ---------- UI helpers ----------
const shadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 6 },
});
const medalFor = (rank: number) =>
  rank === 1 ? "#FFD54F" : rank === 2 ? "#B0BEC5" : rank === 3 ? "#D7A86E" : "#2a2d34";

// Espacio inferior para que no lo tape el menú
const NAV_PADDING = 120;

export default function TopCreatorsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rows, setRows] = useState<CreatorRow[]>([]);
  const [users, setUsers] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const unsubRef = useRef<() => void>();

  // Suscripción al doc MÁS RECIENTE según updatedAt (sin calcular fechas)
  useEffect(() => {
    // query: top 1 por updatedAt desc
    const q = query(collection(db, "leaderboardDaily"), orderBy("updatedAt", "desc"), limit(1));

    unsubRef.current = onSnapshot(
      q,
      async (snap) => {
        if (snap.empty) {
          setRows([]); setUsers(new Map()); setLoading(false);
          return;
        }

        const docSnap = snap.docs[0];
        const data = docSnap.data() as any;
        const top: any[] = Array.isArray(data?.topCreators) ? data.topCreators : [];

        const normalized: CreatorRow[] = top
          .map((t) => ({
            uid: t.uid,
            posts: Number(t.posts ?? 0),
            likes: Number(t.likes ?? 0),
            reposts: Number(t.reposts ?? 0),
            views: Number(t.views ?? 0),
            score: Number(t.score ?? 0),
          }))
          .sort((a, b) => b.score - a.score);

        setRows(normalized);

        try {
          const map = await fetchUsersByUids(normalized.map((x) => x.uid));
          setUsers(map);
        } catch (e) {
          console.log("[Top] error cargando usuarios:", e);
        }

        setLoading(false);
      },
      (err) => {
        console.log("[Top] error snapshot:", err);
        setRows([]); setUsers(new Map()); setLoading(false);
      }
    );

    return () => { if (unsubRef.current) unsubRef.current(); };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const map = await fetchUsersByUids(rows.map((x) => x.uid));
      setUsers(map);
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = ({ item, index }: { item: CreatorRow; index: number }) => {
    const u = users.get(item.uid) || {};
    const avatar = u.photoURL || u.avatarUrl;
    const name = u.displayName || u.username || item.uid.slice(0, 6);
    const rank = index + 1;
    const medal = medalFor(rank);

    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => router.push(`/profile/${item.uid}`)}
        style={[
          {
            marginHorizontal: 14,
            marginBottom: 10,
            borderRadius: 16,
            backgroundColor: "rgba(255,255,255,0.03)",
            borderWidth: 1,
            borderColor: "#262a34",
            padding: 12,
          },
          shadow,
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: medal,
              marginRight: 10,
            }}
          >
            <Text style={{ color: rank <= 3 ? "#000" : "#9aa0a6", fontWeight: "900" }}>
              {rank}
            </Text>
          </View>

          <Image
            source={{ uri: avatar || "https://i.pravatar.cc/80" }}
            style={{ width: 44, height: 44, borderRadius: 22, marginRight: 10 }}
          />

          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }} numberOfLines={1}>
              {name}
            </Text>
            <Text style={{ color: "#9aa0a6", fontSize: 12 }}>
              {item.posts} posts • {item.likes} likes • {Math.round(item.views)} views
            </Text>
          </View>

          <View
            style={{
              paddingVertical: 6,
              paddingHorizontal: 10,
              backgroundColor: "rgba(255,255,255,0.04)",
              borderWidth: 1,
              borderColor: "#2a2d34",
              borderRadius: 12,
              marginLeft: 10,
              minWidth: 64,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#c5c7cb", fontWeight: "900" }}>{Math.round(item.score)}</Text>
            <Text style={{ color: "#7b8089", fontSize: 10 }}>score</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const header = useMemo(
    () => (
      <LinearGradient
        colors={["#121217", "#0b0b0d", "#000"]}
        style={{ paddingTop: insets.top + 12, paddingBottom: 10, paddingHorizontal: 16 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: "rgba(255,215,0,0.15)",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "rgba(255,215,0,0.35)",
            }}
          >
            <Ionicons name="trophy" size={20} color="#FFD54F" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#fff", fontSize: 26, fontWeight: "900" }}>
              Top de creadores
            </Text>
            <Text style={{ color: "#9aa0a6" }}>Ranking diario · auto cada 10 min</Text>
          </View>
        </View>
      </LinearGradient>
    ),
    [insets.top]
  );

  const empty = useMemo(
    () => (
      <View style={{ alignItems: "center", paddingTop: 60 }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 20,
            backgroundColor: "rgba(255,255,255,0.03)",
            borderWidth: 1,
            borderColor: "#262a34",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <Ionicons name="leaf-outline" size={36} color="#7b8089" />
        </View>
        <Text style={{ color: "#c5c7cb", fontSize: 16, fontWeight: "800" }}>
          Aún no hay Top hoy
        </Text>
        <Text style={{ color: "#8a8f98", marginTop: 6, textAlign: "center", paddingHorizontal: 24 }}>
          Sube tu video del reto del día para aparecer aquí. ¡Los primeros tienen más ojos! 👀
        </Text>
      </View>
    ),
    []
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar style="light" />
      {header}

      <FlatList
        data={rows}
        keyExtractor={(it) => it.uid}
        renderItem={renderItem}
        ListEmptyComponent={!loading ? empty : null}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#fff"
            colors={["#fff"]}
          />
        }
        contentContainerStyle={{
          paddingVertical: 10,
          paddingBottom: NAV_PADDING + insets.bottom,
        }}
      />

      <BottomNav />
    </View>
  );
}
