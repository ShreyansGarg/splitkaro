import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '@/services/firebase';

interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const googleProvider = new GoogleAuthProvider();

async function ensureUserDoc(firebaseUser: FirebaseUser): Promise<AuthUser> {
  const userRef = doc(db, 'users', firebaseUser.uid);
  const userSnap = await getDoc(userRef);

  const userData: AuthUser = {
    uid: firebaseUser.uid,
    displayName: firebaseUser.displayName ?? 'Anonymous',
    email: firebaseUser.email ?? '',
    photoURL: firebaseUser.photoURL,
  };

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      ...userData,
      groupIds: [],
      createdAt: serverTimestamp(),
    });
  }

  const pendingQuery = query(
    collection(db, 'groups'),
    where('pendingEmails', 'array-contains', userData.email)
  );
  const pendingGroups = await getDocs(pendingQuery);
  for (const groupDoc of pendingGroups.docs) {
    await updateDoc(groupDoc.ref, {
      memberIds: arrayUnion(firebaseUser.uid),
      pendingEmails: arrayRemove(userData.email),
    });
    await updateDoc(userRef, {
      groupIds: arrayUnion(groupDoc.id),
    });
  }

  return userData;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const userData = await ensureUserDoc(firebaseUser);
          setUser(userData);
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Auth state error:', err);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
