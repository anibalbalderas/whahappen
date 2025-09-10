// components/BottomNav.tsx
import React, { memo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { auth } from '../lib/firebase';

type Props = { };

export default memo(function BottomNav({}: Props) {
  const pathname = usePathname();
  const r = useRouter();
  const insets = useSafeAreaInsets();
  const uid = auth.currentUser?.uid;

  const go = (to: string) => r.replace(to);

  const isHome = pathname?.startsWith('/feed');
  const isProfile = pathname?.startsWith('/profile') && !pathname?.includes('/edit');
  const isNotif = pathname?.startsWith('/notifications');

  const Item = ({
    icon, label, active, onPress,
  }: { icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; onPress: ()=>void }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={{ alignItems:'center', flex:1 }}>
      <Ionicons name={icon} size={24} color={active ? 'white' : '#c9c9c9'} />
      <Text style={{ color: active ? 'white' : '#c9c9c9', fontSize: 12, marginTop: 4 }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{
      position:'absolute', left:12, right:12, bottom:(insets.bottom || 12),
      backgroundColor:'#0f1116cc', borderRadius: 20, borderWidth:1, borderColor:'#1f232c',
      flexDirection:'row', paddingVertical:10, paddingHorizontal: 8, gap: 8,
    }}>
      <Item icon={isHome ? 'home' : 'home-outline'} label="Inicio" active={isHome} onPress={()=>go('/feed')} />
      <Item icon={isProfile ? 'person' : 'person-outline'} label="Perfil" active={isProfile} onPress={()=>go(`/profile/${uid ?? ''}`)} />
      <Item icon={isNotif ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} label="Buzón" active={isNotif} onPress={()=>go('/notifications')} />
    </View>
  );
});
