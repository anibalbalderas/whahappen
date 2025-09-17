// components/BottomNav.tsx
import React, { memo } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "../lib/firebase";

type Props = {};

const shadow = Platform.select({
  ios: {
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 10 },
});

export default memo(function BottomNav({}: Props) {
  const pathname = usePathname();
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const uid = auth.currentUser?.uid;

  const go = (to: string) => r.replace(to);

  const isHome = pathname?.startsWith("/feed");
  const isProfile = pathname?.startsWith("/profile") && !pathname?.includes("/edit");
  const isNotif = pathname?.startsWith("/notifications");
  const isTop = pathname?.startsWith("/top-creators");
  const isSquad = pathname?.startsWith("/squad");

  const Item = ({
    icon,
    label,
    active,
    onPress,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    active?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: "rgba(255,255,255,0.08)", borderless: false }}
      style={{ alignItems: "center", flex: 1, paddingVertical: 6 }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={24} color={active ? "white" : "#c9c9c9"} />
      <Text
        style={{
          color: active ? "white" : "#c9c9c9",
          fontSize: 12,
          marginTop: 4,
          includeFontPadding: false,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    // pointerEvents evita bloquear toques en contenido detrás
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
      <SafeAreaView
        edges={["bottom"]}
        pointerEvents="box-none"
        style={{ backgroundColor: "transparent" }}
      >
        <View
          style={[
            {
              marginHorizontal: 12,
              marginBottom: Math.max(insets.bottom, 8) ? 8 : 8,
              backgroundColor: "#0f1116cc",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "#1f232c",
              flexDirection: "row",
              paddingVertical: 10,
              paddingHorizontal: 8,
            },
            shadow,
          ]}
        >
          <Item
            icon={isSquad ? "flame" : "flame-outline"}  // también puedes usar "people"/"people-outline"
            label="Squad"
            active={isSquad}
            onPress={() => go("/squad")}
          />

          <Item
            icon={isTop ? "trophy" : "trophy-outline"}
            label="Top"
            active={isTop}
            onPress={() => go("/top-creators")}
          />
          <Item
            icon={isHome ? "home" : "home-outline"}
            label="Inicio"
            active={isHome}
            onPress={() => go("/feed")}
          />
          <Item
            icon={isProfile ? "person" : "person-outline"}
            label="Perfil"
            active={isProfile}
            onPress={() => go(`/profile/${uid ?? ""}`)}
          />
          <Item
            icon={isNotif ? "chatbubble-ellipses" : "chatbubble-ellipses-outline"}
            label="Buzón"
            active={isNotif}
            onPress={() => go("/notifications")}
          />
        </View>
      </SafeAreaView>
    </View>
  );
});
