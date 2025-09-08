import { Link, useRouter } from 'expo-router';
import { View, Text, TouchableOpacity } from 'react-native';

export default function Home() {
  const r = useRouter();

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>WhaHappen</Text>
      <Text style={{ fontSize: 18, opacity: 0.8 }}>
        Reto global de hoy: (placeholder)
      </Text>

      <TouchableOpacity
        onPress={() => r.push({ pathname: '/record', params: { mode: 'global' } })}
        style={{ backgroundColor: 'black', padding: 14, borderRadius: 12 }}
      >
        <Text style={{ color: 'white', textAlign: 'center' }}>Grabar reto global</Text>
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {['caritativo', 'picaro', 'creativo'].map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => r.push({ pathname: '/record', params: { mode: m } })}
            style={{ backgroundColor: '#222', padding: 12, borderRadius: 12 }}
          >
            <Text style={{ color: 'white' }}>{m}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Link href="/feed" style={{ marginTop: 20, fontSize: 16 }}>
        Ver feed (placeholder)
      </Link>
    </View>
  );
}
