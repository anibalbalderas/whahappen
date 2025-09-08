import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, TouchableOpacity } from 'react-native';

export default function Record() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const r = useRouter();

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: '600' }}>
        Grabación (modo: {mode})
      </Text>
      <Text>Luego aquí irá la cámara.</Text>
      <TouchableOpacity
        onPress={() => r.push('/feed')}
        style={{ backgroundColor: 'black', padding: 14, borderRadius: 12 }}
      >
        <Text style={{ color: 'white', textAlign: 'center' }}>
          Simular subida y ver feed
        </Text>
      </TouchableOpacity>
    </View>
  );
}
