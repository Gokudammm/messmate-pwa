const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const requiredConfig = Object.entries(config);
export const firebaseConfigured = requiredConfig.every(([, value]) => Boolean(value));
export const missingFirebaseConfig = requiredConfig
  .filter(([, value]) => !value)
  .map(([key]) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`);

export async function loadFirebaseAuth() {
  const [appApi, authApi] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth")
  ]);
  const app = appApi.getApps().length ? appApi.getApp() : appApi.initializeApp(config);
  return {
    auth: authApi.getAuth(app),
    authApi,
    loadFirestore: async () => {
      const firestoreApi = await import("firebase/firestore");
      return { ...firestoreApi, db: firestoreApi.getFirestore(app) };
    }
  };
}
