import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyANEthf2RAzylH63yWS8dlTEBUHUSGToiE",
  authDomain: "smart-product-vision.firebaseapp.com",
  projectId: "smart-product-vision",
  storageBucket: "smart-product-vision.firebasestorage.app",
  messagingSenderId: "756778269185",
  appId: "1:756778269185:web:1ffdc18268ca57c1955e00",
  measurementId: "G-V6DPEN2DKK"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});

const hasFirebaseConfig = true;

export { auth, googleProvider, signInWithPopup, signOut, hasFirebaseConfig };