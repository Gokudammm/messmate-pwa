# MessMate — Mess Management PWA

A front-end-only React + Vite Progressive Web App for managing a mess with Morning and Evening shifts.

## Features
- Morning and Evening billing shifts
- Itemized bill calculator with editable quantities
- Add, edit and delete menu items and prices
- Cash and Online payment tracking
- Date-based dashboard with total, cash, online and shift collections
- Transaction history and bill deletion
- Local persistence using `localStorage`
- Same-browser tab synchronization using `BroadcastChannel` and the browser storage event
- JSON export/import to move or back up data between devices
- Installable PWA with a basic service worker for offline app-shell use

## Run locally
Install Node.js (LTS), then:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

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

## Important: local-only data and multi-device sync
This app deliberately has **no backend**. Records are stored in the browser's local storage, so each device/browser has its own separate data. Tabs on the same browser can sync, but different phones or computers do not automatically sync over the internet.

To move data between devices, use **Menu & prices → Export JSON** on the source device, then **Import JSON** on the destination device. Import replaces that device's current data, so export a backup first.

For true automatic multi-device synchronization, add a cloud database and authentication (for example Firebase Firestore + Firebase Authentication or Supabase). Hosting on Firebase, Vercel or Render alone does not provide shared database sync.

## Notes
- Use HTTPS in production for PWA installation and service-worker support.
- This is a starter application, not a secured multi-user accounting system. There is no login, role management, server validation or audit log.
- Currency is set to INR. Adjust the `money()` helper in `src/main.jsx` if needed.
