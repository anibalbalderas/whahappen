// app/shared/[submissionId].tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Modal,
  StatusBar,
  FlatList,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Video } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

const LIMIT_FREE = 3;

export default function SharedLanding() {
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [blocked, setBlocked] = useState(false);

  const w = Dimensions.get("window").width;
  const h = Dimensions.get("window").height;

  // carga principal + otros 2
  useEffect(() => {
    (async () => {
      try {
        if (!submissionId || typeof submissionId !== "string") return;
        const d = await getDoc(doc(db, "submissions", submissionId));
        if (!d.exists()) {
          Alert.alert("Ups", "Este video ya no está disponible.");
          r.replace("/login");
          return;
        }
        const first = { id: d.id, ...d.data() };
        // toma otros 2 recientes públicos
        const qs = await getDocs(
          query(
            collection(db, "submissions"),
            where("status", "==", "public"),
            orderBy("createdAt", "desc"),
            limit(20)
          )
        );
        const pool = qs.docs
          .filter((x) => x.id !== first.id)
          .slice(0, 2)
          .map((x) => ({ id: x.id, ...x.data() }));
        setItems([first, ...pool]);
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId]);

  const checkGate = async () => {
    const cur = Number((await AsyncStorage.getItem("guest_views_count")) || "0");
    if (cur >= LIMIT_FREE) setBlocked(true);
  };
  const markViewed = async () => {
    const cur = Number((await AsyncStorage.getItem("guest_views_count")) || "0");
    await AsyncStorage.setItem("guest_views_count", String(cur + 1));
    await checkGate();
  };

  useEffect(() => {
    checkGate();
  }, []);

  const renderItem = ({ item }: { item: any }) => {
    return <SharedCard item={item} w={w} h={h} onWatched={markViewed} />;
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Topbar */}
      <View style={{ position: "absolute", top: (insets.top || 12) + 8, left: 12, right: 12, zIndex: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <TouchableOpacity onPress={() => r.replace("/login")}>
          <Ionicons name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => r.push("/login")} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fff" }}>
          <Text style={{ color: "#000", fontWeight: "900" }}>Entrar</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        renderItem={renderItem}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={checkGate}
      />

      {/* Paywall suave */}
      <Modal visible={blocked} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: "#000c", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <View style={{ width: "100%", borderRadius: 16, backgroundColor: "#0f1116", borderWidth: 1, borderColor: "#1f2230", padding: 16 }}>
            <Text style={{ color: "#fff", fontWeight: "900", fontSize: 18 }}>Sigue viendo</Text>
            <Text style={{ color: "#9aa0a6", marginTop: 8 }}>
              Crea tu cuenta para ver todos los videos y unirte a los retos.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <TouchableOpacity onPress={() => r.push("/register")} style={{ flex: 1, backgroundColor: "#fff", paddingVertical: 12, borderRadius: 10 }}>
                <Text style={{ color: "#000", fontWeight: "900", textAlign: "center" }}>Registrarme</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => r.push("/login")} style={{ flex: 1, backgroundColor: "#121318", borderWidth: 1, borderColor: "#252a36", paddingVertical: 12, borderRadius: 10 }}>
                <Text style={{ color: "#fff", fontWeight: "900", textAlign: "center" }}>Entrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SharedCard({ item, w, h, onWatched }: { item: any; w: number; h: number; onWatched: () => void }) {
  const videoRef = useRef<Video>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await videoRef.current?.setIsLoopingAsync(true);
        await videoRef.current?.playAsync();
      } catch {}
    })();
  }, []);

  return (
    <View style={{ width: w, height: h }}>
      <Video
        ref={videoRef}
        source={{ uri: item.videoURL }}
        style={{ width: w, height: h }}
        resizeMode="cover"
        onPlaybackStatusUpdate={(st: any) => {
          if (st?.isLoaded && !ready) {
            setReady(true);
            onWatched();
          }
        }}
        shouldPlay
        isLooping
      />
      {/* Overlay mínimo: título o handle si lo tienes */}
    </View>
  );
}
