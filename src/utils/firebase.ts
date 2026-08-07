import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth } from 'firebase/auth';
import { getStorage, FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const isPlaceholder =
  !firebaseConfig.apiKey ||
  firebaseConfig.apiKey.startsWith('your_') ||
  firebaseConfig.apiKey === '';

let app;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

if (!isPlaceholder) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    auth = getAuth(app);
    storage = getStorage(app);
  } catch (error) {
    console.error('Error initializing Firebase client SDK:', error);
  }
}

export { auth, storage };

export function isFirebaseConfigured(): boolean {
  return !isPlaceholder && !!auth && !!storage;
}

/**
 * Signs in user anonymously using Firebase Auth.
 * If Firebase is not configured, returns a mock local user UID.
 */
export async function getAnonymousUser(): Promise<{ uid: string; isAnonymous: boolean }> {
  if (isPlaceholder || !auth) {
    // Generate a unique client-side session UID and store in localStorage
    if (typeof window !== 'undefined') {
      let localUid = localStorage.getItem('knowledgechat_mock_uid');
      if (!localUid) {
        localUid = 'mock_uid_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('knowledgechat_mock_uid', localUid);
      }
      return { uid: localUid, isAnonymous: true };
    }
    return { uid: 'mock_server_uid', isAnonymous: true };
  }

  const credential = await signInAnonymously(auth);
  return {
    uid: credential.user.uid,
    isAnonymous: credential.user.isAnonymous,
  };
}
