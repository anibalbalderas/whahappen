// components/Avatar.tsx
import { useEffect, useMemo, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

type UserLike = {
  uid?: string;
  username?: string;
  displayName?: string;
  photoDataURL?: string | null;
  photoURL?: string | null;
};

export default function Avatar({
  uid,
  user,
  size = 36,
  onPress,
  style,
}: {
  uid?: string;
  user?: UserLike;
  size?: number;
  onPress?: () => void;
  style?: any;
}) {
  const [u, setU] = useState<UserLike | null>(user ?? null);

  // Si no nos pasan 'user', nos suscribimos a Firestore con el uid
  useEffect(() => {
    if (!user && uid) {
      const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
        setU({ uid, ...(snap.data() as any) });
      });
      return unsub;
    }
  }, [uid, user]);

  const uri =
    (u as any)?.photoDataURL ??
    (u as any)?.photoURL ??
    user?.photoDataURL ??
    user?.photoURL ??
    null;

  const name =
    (u?.username || u?.displayName || user?.username || user?.displayName || 'U') + '';

  const initial = useMemo(() => (name.trim()[0] || 'U').toUpperCase(), [name]);

  const Wrapper: any = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      onPress={onPress}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: '#2a2d34',
          borderWidth: 1,
          borderColor: '#ffffff22',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      activeOpacity={0.8}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      ) : (
        <Text style={{ color: '#ddd', fontWeight: '800', fontSize: size * 0.45 }}>
          {initial}
        </Text>
      )}
    </Wrapper>
  );
}
