// app/notifications.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import BottomNav from '../components/BottomNav';

const BackgroundDecor = () => (
  <View pointerEvents="none" style={{ position:'absolute', left:0, right:0, top:0, bottom:0 }}>
    <LinearGradient colors={['rgba(124,77,255,0.28)','rgba(124,77,255,0.0)']} start={{x:0.1,y:0}} end={{x:0.9,y:1}}
      style={{ position:'absolute', width:320, height:320, borderRadius:160, top:-80, left:-80, transform:[{rotate:'18deg'}] }} />
    <LinearGradient colors={['rgba(255,77,222,0.22)','rgba(255,77,222,0.0)']} start={{x:0,y:0}} end={{x:1,y:1}}
      style={{ position:'absolute', width:260, height:260, borderRadius:130, top: 220, right:-70, transform:[{rotate:'-12deg'}] }} />
  </View>
);

export default function Notifications() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex:1, backgroundColor:'#000' }}>
      <BackgroundDecor />
      <View style={{ paddingTop:(insets.top||12)+8, paddingHorizontal:16, paddingBottom:12 }}>
        <Text style={{ color:'#fff', fontWeight:'900', fontSize:22 }}>Buzón</Text>
        <Text style={{ color:'#9aa0a6', marginTop:6 }}>Tus notificaciones y mensajes aparecerán aquí.</Text>
      </View>
      <BottomNav />
    </View>
  );
}
