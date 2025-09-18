// app/top-creators.tsx
// Ranking con estilo consistente + fondo de burbujas de color.

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import Avatar from "../components/Avatar";
import BottomNav from "../components/BottomNav";
import { LinearGradient } from "expo-linear-gradient";

// ====== Tema ======
const T = {
  bg: "#000",
  card: "#0f1116",
  cardBorder: "#1f2230",
  soft: "#101318",
  hair: "#181c24",
  text: "#fff",
  textDim: "#9aa0a6",
};

// ====== Helpers ======
function todayKeyYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}
function prevMonthKeyYYYY_MM() {
  const now = new Date();
  const m = now.getMonth(); // 0..11
  const y = now.getFullYear();
  const pm = m === 0 ? 12 : m; // mes pasado (1..12)
  const py = m === 0 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

type CreatorRow = {
  uid: string;
  posts: number;
  likes: number;
  comments: number;
  views: number;
  score: number;
};
type UsersMap = Record<string, { handle?: string; displayName?: string; photoURL?: string }>;

async function fetchUsersByUids(uids: string[]): Promise<UsersMap> {
  const uniq = Array.from(new Set(uids));
  const res: UsersMap = {};
  for (const uid of uniq) {
    try {
      const s = await getDoc(doc(db, "users", uid));
      res[uid] = (s.data() as any) || {};
    } catch {
      res[uid] = {};
    }
  }
  return res;
}

// ====== Subcomponentes ======
function BubbleBackground() {
  // Capa decorativa con burbujas/gradients. No bloquea toques.
  return (
    <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject as any }}>
      {/* capa suave de vignette */}
      <LinearGradient
        colors={["#05060a", "#000000"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ ...StyleSheet.absoluteFillObject as any }}
      />

      {/* blobs principales */}
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
      {/* brillos sutiles */}
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

function Header({
  onBack,
  tab,
  setTab,
  monthKey,
}: {
  onBack: () => void;
  tab: "day" | "month";
  setTab: (v: "day" | "month") => void;
  monthKey: string;
}) {
  const insets = useSafeAreaInsets();
  const r = useRouter();
  const TOP = (insets.top || 12) + 8;

  return (
    <>
      {/* Barra superior (back + títulos) */}
      <View
        style={{
          position: "absolute",
          top: TOP,
          left: 12,
          right: 12,
          zIndex: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={28} color={T.text} />
        </TouchableOpacity>

        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={{ color: T.text, fontWeight: "900", fontSize: 18 }}>
            Top de creadores
          </Text>
          <Text style={{ color: T.textDim, marginTop: 2, fontSize: 12 }}>
            {tab === "day"
              ? "Ranking diario · datos en vivo"
              : `Ranking mensual · ${monthKey}`}
          </Text>
        </View>

        <View style={{ width: 28 }} />
      </View>

      {/* Chips + botón Fondo en una sola fila */}
      <View
        style={{
          position: "absolute",
          top: TOP + 60,
          left: 12,
          right: 12,
          zIndex: 20,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        {/* Grupo de chips */}
        <View style={{ flexDirection: "row", gap: 8, flexShrink: 1 }}>
          <TouchableOpacity
            onPress={() => setTab("day")}
            activeOpacity={0.9}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: tab === "day" ? "#fff" : T.soft,
              borderWidth: 1,
              borderColor: tab === "day" ? "#fff" : T.cardBorder,
            }}
          >
            <Text
              style={{
                color: tab === "day" ? "#000" : "#fff",
                fontWeight: "900",
              }}
            >
              Hoy
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setTab("month")}
            activeOpacity={0.9}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: tab === "month" ? "#fff" : T.soft,
              borderWidth: 1,
              borderColor: tab === "month" ? "#fff" : T.cardBorder,
            }}
          >
            <Text
              style={{
                color: tab === "month" ? "#000" : "#fff",
                fontWeight: "900",
              }}
            >
              Mes
            </Text>
          </TouchableOpacity>
        </View>

        {/* Botón Fondo de Creadores */}
        <TouchableOpacity
          onPress={() => r.push("/creator-fund")}
          activeOpacity={0.9}
          style={{ flexShrink: 0 }}
        >
          <View
            style={{
              backgroundColor: "#fff",
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: "#000", fontWeight: "900" }}>
              Recompensas
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </>
  );
}

function RankBadge({ index }: { index: number }) {
  const isGold = index === 0;
  const isSilver = index === 1;
  const isBronze = index === 2;
  const bg = isGold ? "#f9d64e" : isSilver ? "#c8cdd8" : isBronze ? "#d7a86e" : "#2a2e36";
  const fg = isGold || isSilver || isBronze ? "#111" : "#ddd";
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 10,
      }}
    >
      <Text style={{ color: fg, fontWeight: "800" }}>{index + 1}</Text>
    </View>
  );
}

function Row({
  item,
  index,
  users,
}: {
  item: CreatorRow;
  index: number;
  users: UsersMap;
}) {
  const u = users[item.uid] || {};
  const display = u?.handle ? `@${u.handle}` : u?.displayName ?? `user-${item.uid.slice(0, 6)}`;

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 25,
        backgroundColor: T.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: T.cardBorder,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <RankBadge index={index} />

      <View style={{ marginRight: 12 }}>
        <Avatar uid={item.uid} size={38} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: T.text, fontWeight: "900", marginBottom: 4 }}>{display}</Text>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="film-outline" size={14} color={T.textDim} />
            <Text style={{ color: T.textDim, fontSize: 12 }}>{item.posts} posts</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="heart-outline" size={14} color={T.textDim} />
            <Text style={{ color: T.textDim, fontSize: 12 }}>{item.likes} likes</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={T.textDim} />
            <Text style={{ color: T.textDim, fontSize: 12 }}>{item.comments} comments</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="eye-outline" size={14} color={T.textDim} />
            <Text style={{ color: T.textDim, fontSize: 12 }}>{Math.round(item.views)} views</Text>
          </View>
        </View>
      </View>

      <View
        style={{
          minWidth: 58,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: T.soft,
          borderWidth: 1,
          borderColor: T.cardBorder,
          borderRadius: 10,
          alignItems: "center",
        }}
      >
        <Text style={{ color: T.textDim, fontSize: 10, marginBottom: 2 }}>score</Text>
        <Text style={{ color: T.text, fontWeight: "900" }}>{Math.round(item.score)}</Text>
      </View>
    </View>
  );
}

// ====== Componente principal ======
export default function TopCreators() {
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const TOPPAD = (insets.top || 12) + 8;

  const [tab, setTab] = useState<"day" | "month">("day");

  // HOY
  const [rows, setRows] = useState<CreatorRow[]>([]);
  const [users, setUsers] = useState<UsersMap>({});
  const [loadingDay, setLoadingDay] = useState(true);
  const unsubRef = useRef<() => void>();

  // MES
  const [monthKey] = useState(prevMonthKeyYYYY_MM());
  const [rowsMonth, setRowsMonth] = useState<any[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(true);

  // ====== HOY (live) ======
  useEffect(() => {
    const dateKey = todayKeyYYYYMMDD();
    const q = query(
      collection(db, "submissions"),
      where("dateKey", "==", dateKey),
      orderBy("createdAt", "desc"),
      limit(500)
    );

    unsubRef.current = onSnapshot(q, async (snap) => {
      try {
        const posts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

        const perPost = await Promise.all(
          posts.map(async (p: any) => {
            const id: string = p.id;
            const authorUid: string = String(p.uid || "unknown");

            const likes = Number(p.likesFromOthersCount ?? p.likesCount ?? 0);

            let comments = 0;
            try {
              const comColl = collection(db, "submissions", id, "comments");
              const totalSnap = await getCountFromServer(comColl);
              comments = Number(totalSnap.data().count || 0);
            } catch {
              comments = Number(p.commentsFromOthersCount ?? p.commentsCount ?? 0);
            }

            let views = 0;
            try {
              const vCnt = await getCountFromServer(collection(db, "submissions", id, "views"));
              views = Number(vCnt.data().count || 0);
            } catch {
              views = Number(p.viewsFromOthersCount ?? p.viewsCount ?? 0);
            }

            return { id, uid: authorUid, likes, comments, views };
          })
        );

        const agg = new Map<string, CreatorRow>();
        perPost.forEach(({ uid, likes, comments, views }) => {
          const row =
            agg.get(uid) || { uid, posts: 0, likes: 0, comments: 0, views: 0, score: 0 };
          row.posts += 1;
          row.likes += likes;
          row.comments += comments;
          row.views += views;
          row.score += likes * 5 + comments * 8 + views * 0.2;
          agg.set(uid, row);
        });

        const list = Array.from(agg.values()).sort((a, b) => b.score - a.score);
        setRows(list);
        setUsers(await fetchUsersByUids(list.map((x) => x.uid)));
        setLoadingDay(false);
      } catch (e) {
        console.log("[TopCreators day] error", e);
        setLoadingDay(false);
      }
    });

    return () => {
      unsubRef.current?.();
    };
  }, []);

  // ====== MES (doc) ======
  useEffect(() => {
    (async () => {
      setLoadingMonth(true);
      try {
        const d = await getDoc(doc(db, "leaderboards_month", monthKey));
        if (d.exists()) setRowsMonth((d.data()?.top10 as any[]) || []);
        else setRowsMonth([]);
      } catch (e) {
        console.log("[TopCreators month] error", e);
        setRowsMonth([]);
      } finally {
        setLoadingMonth(false);
      }
    })();
  }, [monthKey]);

  const renderDay = ({ item, index }: { item: CreatorRow; index: number }) => (
    <Row item={item} index={index} users={users} />
  );

  const renderMonth = ({ item, index }: { item: any; index: number }) => {
    const display = item.handle ? `@${item.handle}` : item.uid?.slice(0, 8) ?? "user";
    return (
      <View
        style={{
          marginHorizontal: 16,
          marginBottom: 12,
          backgroundColor: T.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: T.cardBorder,
          padding: 12,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <RankBadge index={index} />
        <View style={{ marginRight: 12 }}>
          <Avatar uid={item.uid} size={38} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: T.text, fontWeight: "900", marginBottom: 4 }}>{display}</Text>
          <Text style={{ color: T.textDim, fontSize: 12 }}>
            ♥ {item.likes ?? 0} · 💬 {item.comments ?? 0} · 👁 {Math.round(item.views ?? 0)}
          </Text>
        </View>
        <View
          style={{
            minWidth: 58,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: T.soft,
            borderWidth: 1,
            borderColor: T.cardBorder,
            borderRadius: 10,
            alignItems: "center",
          }}
        >
          <Text style={{ color: T.textDim, fontSize: 10, marginBottom: 2 }}>score</Text>
          <Text style={{ color: T.text, fontWeight: "900" }}>{Math.round(item.score ?? 0)}</Text>
        </View>
      </View>
    );
  };

  const onBack = () => {
    try {
      (r as any).canGoBack?.() ? r.back() : r.replace("/feed");
    } catch {
      r.replace("/feed");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Fondo de burbujas */}
      <BubbleBackground />

      {/* Header + chips */}
      <Header onBack={onBack} tab={tab} setTab={setTab} monthKey={monthKey} />

      {/* Contenido */}
      <View style={{ flex: 1, paddingTop: TOPPAD + 46 + 44 /* topbar + chips aprox */ }}>
        {tab === "day" ? (
          loadingDay ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : rows.length === 0 ? (
            <View
              style={{
                margin: 16,
                backgroundColor: T.card,
                borderWidth: 1,
                borderColor: T.cardBorder,
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Text style={{ color: T.text, fontWeight: "900", marginBottom: 6 }}>
                Aún no hay actividad hoy
              </Text>
              <Text style={{ color: T.textDim }}>
                Sube tu video del día para aparecer en el ranking en vivo.
              </Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(x) => x.uid}
              renderItem={renderDay}
              contentContainerStyle={{ paddingBottom: (insets.bottom || 12) + 90 }}
            />
          )
        ) : loadingMonth ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : rowsMonth.length === 0 ? (
          <View
            style={{
              margin: 16,
              backgroundColor: T.card,
              borderWidth: 1,
              borderColor: T.cardBorder,
              borderRadius: 16,
              padding: 16,
            }}
          >
            <Text style={{ color: T.text, fontWeight: "900", marginBottom: 6 }}>
              Sin ranking del mes {monthKey}
            </Text>
            <Text style={{ color: T.textDim }}>
              Aún no hay datos publicados para el mes anterior.
            </Text>
          </View>
        ) : (
          <FlatList
            data={rowsMonth}
            keyExtractor={(x) => x.uid}
            renderItem={renderMonth}
            contentContainerStyle={{ paddingBottom: (insets.bottom || 12) + 90 }}
          />
        )}
      </View>

      {/* Bottom nav */}
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <BottomNav />
      </View>
    </View>
  );
}

// pequeño polyfill local
const StyleSheet = {
  absoluteFillObject: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
};
