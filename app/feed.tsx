import { View, Text } from 'react-native';

export default function Feed() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 18 }}>Aquí verás el feed del día</Text>
    </View>
  );
}
