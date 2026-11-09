# MessMate — Mess Management PWA

A React + Vite Progressive Web App for managing a mess with Morning and Evening shifts, with optional Firebase cloud sync.

## Features
- Morning and Evening billing shifts
- Itemized bill calculator with editable quantities
- Add, edit and delete menu items and prices
- Cash and Online payment tracking
- Date-based dashboard with total, cash, online and shift collections
- Transaction history and bill deletion
- Firebase email/password sign-in with private Firestore records per account
- Real-time menu and bill synchronization across devices signed into the same account
- Local persistence and same-browser tab synchronization when cloud sync is not configured
- JSON export/import to move or back up data between devices
- Installable PWA with a basic service worker for offline app-shell use

## Run locally
Install Node.js (LTS), then:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Enable cross-device sync

The app uses Firebase Authentication and Cloud Firestore. Each account can read and write only its own menu and bills.

1. Create a Firebase project and register a **Web app** in the Firebase console.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. In **Firestore Database**, create a database and publish the rules from [`firestore.rules`](./firestore.rules). The root `firebase.json` also points Firebase CLI deployments at this rules file.
4. Add the Firebase web-app values to a local `.env.local` file (copy `.env.example`) and to Vercel's **Project Settings → Environment Variables**:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
5. Add `messmate-pwa.vercel.app` to Firebase Authentication's authorized domains, then redeploy on Vercel.
6. Create an account in MessMate. The first sign-in on the browser containing your existing records adds them to that account without replacing existing cloud records. Sign in with the same account on your other devices.

Until Firebase is configured, the app clearly stays in local-only mode. Do not remove the only copy of your local data until the first cloud sign-in completes.

## Build
```bash
npm run build
npm run preview
```
The production build is created in `dist/`.

## Deploy

### Vercel
1. Import the GitHub repository in Vercel (or select **Add New → Project**).
2. Keep the project root at the repository root. `vercel.json` configures the build command (`npm run build`), output directory (`dist`) and SPA fallback.
3. Deploy. Vercel will build and deploy subsequent pushes automatically.

The app's web manifest and service worker are included in `public/`; production PWA installation and offline support require the deployed site to use HTTPS.

### Firebase Hosting
1. Install Firebase CLI: `npm install -g firebase-tools`.
2. Run `firebase login` and `firebase init hosting`.
3. Set public directory to `dist` and configure as a single-page app: **Yes**.
4. Build with `npm run build`, then run `firebase deploy`.

### Render
1. Create a **Static Site** connected to your GitHub repository.
2. Build command: `npm install && npm run build`.
3. Publish directory: `dist`.
4. Add a rewrite rule `/*` → `/index.html` with status `200` if needed.

## Data and backups
With Firebase configured, data belongs to the signed-in account and updates stream to its other signed-in devices. Without Firebase configuration, each browser keeps its own local data. Use **Menu & prices → Export JSON** for a backup or manual transfer; importing replaces the current account's data.

## Notes
- Use HTTPS in production for PWA installation and service-worker support.
- This is a starter application, not a full accounting system. Authentication protects account data, but there is no role management or audit log.
- Currency is set to INR. Adjust the `money()` helper in `src/main.jsx` if needed.
