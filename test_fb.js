import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadBytes } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBEm013utPi5Wl6yXDdCG3Lax1vUiSRpT0",
  authDomain: "tuliptech-2eebd.firebaseapp.com",
  projectId: "tuliptech-2eebd",
  storageBucket: "tuliptech-2eebd.firebasestorage.app",
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const storageRef = ref(storage, "test/test.txt");

uploadBytes(storageRef, new Uint8Array([104, 101, 108, 108, 111])).then(() => {
  console.log("Success");
}).catch(e => {
  console.log("Firebase Error:", e.message);
});
