import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowDownToLine, ArrowUpFromLine, Banknote, CalendarDays, Check,
  ChevronDown, CirclePlus, Cloud, Coffee, CreditCard, IndianRupee, LayoutDashboard,
  LoaderCircle, LogOut, Menu, Pencil, Plus, ReceiptText, RefreshCw, Settings2,
  Trash2, Utensils, Wallet, X
} from "lucide-react";
import { firebaseConfigured, loadFirebaseAuth, missingFirebaseConfig } from "./firebase";
import "./styles.css";
import "./cloud.css";

const AuthScreen = lazy(() => import("./AuthScreen"));
const STORE_KEY = "messmate-data-v1";
const MIGRATION_KEY = "messmate-cloud-migration-complete";
const today = () => new Date().toISOString().slice(0, 10);
const defaultItems = [
  { id: "tea", name: "Tea", price: 10 },
  { id: "breakfast", name: "Breakfast", price: 30 },
  { id: "lunch", name: "Lunch", price: 60 },
  { id: "snacks", name: "Snacks", price: 20 },
  { id: "dinner", name: "Dinner", price: 60 }
];
const starter = { items: defaultItems, bills: [] };
const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n || 0));

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return saved && Array.isArray(saved.items) && Array.isArray(saved.bills) ? saved : starter;
  } catch { return starter; }
}
function validDocumentId(id) {
  return typeof id === "string" && id.length > 0 && !id.includes("/") && id !== "." && id !== "..";
}
function validData(value) {
  return value && Array.isArray(value.items) && Array.isArray(value.bills)
    && value.items.every(item => item && validDocumentId(item.id) && typeof item.name === "string" && Number.isFinite(Number(item.price)))
    && value.bills.every(bill => bill && validDocumentId(bill.id) && Array.isArray(bill.lines) && Number.isFinite(Number(bill.total)));
}
function loadMigrationData() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    return validData(parsed) ? parsed : null;
  } catch { return null; }
}
function equalData(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function mergeCollection(base, local, remote) {
  const baseById = new Map(base.map(item => [item.id, item]));
  const localById = new Map(local.map(item => [item.id, item]));
  const remoteById = new Map(remote.map(item => [item.id, item]));
  const ids = new Set([...remoteById.keys(), ...localById.keys()]);
  const merged = [];
  for (const id of ids) {
    const localChanged = !equalData(baseById.get(id), localById.get(id));
    const selected = localChanged ? localById : remoteById;
    if (selected.has(id)) merged.push(selected.get(id));
  }
  return merged;
}
function mergeData(base, local, remote) {
  return {
    items: mergeCollection(base.items, local.items, remote.items),
    bills: mergeCollection(base.bills, local.bills, remote.bills)
  };
}
function mergeMigrationData(local, remote) {
  const remoteItemIds = new Set(remote.items.map(item => item.id));
  const remoteBillIds = new Set(remote.bills.map(bill => bill.id));
  return {
    items: [...remote.items, ...local.items.filter(item => !remoteItemIds.has(item.id))],
    bills: [...remote.bills, ...local.bills.filter(bill => !remoteBillIds.has(bill.id))]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
  };
}
async function writeDataChanges(firestore, uid, before, after) {
  const writes = [];
  for (const name of ["items", "bills"]) {
    const previous = new Map(before[name].map(item => [item.id, item]));
    const current = new Map(after[name].map(item => [item.id, item]));
    after[name].forEach((item, index) => {
      if (!equalData(previous.get(item.id), item)) {
        const value = name === "items" ? { ...item, _order: index } : item;
        writes.push({ type: "set", ref: firestore.doc(firestore.db, "users", uid, name, item.id), value });
      }
    });
    for (const item of before[name]) {
      if (!current.has(item.id)) writes.push({ type: "delete", ref: firestore.doc(firestore.db, "users", uid, name, item.id) });
    }
  }
  for (let offset = 0; offset < writes.length; offset += 450) {
    const batch = firestore.writeBatch(firestore.db);
    for (const write of writes.slice(offset, offset + 450)) {
      if (write.type === "set") batch.set(write.ref, write.value);
      else batch.delete(write.ref);
    }
    await batch.commit();
  }
}
function readCloudItems(snapshot) {
  return snapshot.docs
    .map(item => ({ ...item.data(), id: item.id }))
    .sort((a, b) => (a._order ?? 0) - (b._order ?? 0))
    .map(({ _order, ...item }) => item);
}
function readCloudBills(snapshot) {
  return snapshot.docs
    .map(item => ({ ...item.data(), id: item.id }))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}
function SyncGate({ error, onRetry, onSignOut }) {
  return <main className="auth-page"><section className="auth-card sync-gate">
    <div className="auth-brand"><div className="auth-brand-mark"><Utensils size={21}/></div><div><b>messmate</b><small>MESS MANAGEMENT</small></div></div>
    <LoaderCircle className={error ? "gate-icon failed" : "gate-icon spinning"} size={30}/>
    <h1>{error ? "Could not load your data" : "Connecting your workspace..."}</h1>
    <p>{error || "Fetching your menu and bills from secure cloud storage."}</p>
    {error && <button className="primary-btn auth-submit" onClick={onRetry}><RefreshCw size={16}/> Try again</button>}
    {onSignOut && <button className="auth-text-button" onClick={onSignOut}>Sign out</button>}
  </section></main>;
}
function App() {
  const [data, setData] = useState(loadData);
  const dataRef = useRef(data);
  const lastSyncedDataRef = useRef(data);
  const remoteDataRef = useRef({ items: [], bills: [] });
  const remoteRevisionRef = useRef(0);
  const syncQueueRef = useRef(Promise.resolve());
  const [user, setUser] = useState(null);
  const [firebaseClient, setFirebaseClient] = useState(null);
  const [firestore, setFirestore] = useState(null);
  const [authLoading, setAuthLoading] = useState(firebaseConfigured);
  const [readyUserId, setReadyUserId] = useState(null);
  const [syncError, setSyncError] = useState("");
  const [syncRetry, setSyncRetry] = useState(0);
  const [shift, setShift] = useState("Morning");
  const [page, setPage] = useState("Overview");
  const [date, setDate] = useState(today());
  const [quantities, setQuantities] = useState({});
  const [payment, setPayment] = useState("Cash");
  const [customer, setCustomer] = useState("");
  const [editingItem, setEditingItem] = useState(null);
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  dataRef.current = data;
  const activeSyncRef = useRef({ uid: null, readyUid: null });
  activeSyncRef.current = { uid: user?.uid || null, readyUid: readyUserId };

  useEffect(() => {
    if (!firebaseConfigured) {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      const channel = new BroadcastChannel("messmate-sync");
      channel.postMessage(data);
      channel.close();
      return;
    }
    if (!user || !firestore || readyUserId !== user.uid) return;
    localStorage.setItem(`${STORE_KEY}-${user.uid}`, JSON.stringify(data));
    const uid = user.uid;
    const target = data;
    syncQueueRef.current = syncQueueRef.current.catch(() => {}).then(async () => {
      if (activeSyncRef.current.uid !== uid || activeSyncRef.current.readyUid !== uid) return;
      const previous = lastSyncedDataRef.current;
      if (equalData(previous, target)) return;
      const revision = remoteRevisionRef.current;
      await writeDataChanges(firestore, uid, previous, target);
      if (activeSyncRef.current.uid !== uid) return;
      if (remoteRevisionRef.current === revision) lastSyncedDataRef.current = target;
      setSyncError("");
    }).catch(error => {
      if (activeSyncRef.current.uid === uid) setSyncError(`Cloud sync failed: ${error.message}`);
    });
  }, [data, user, firestore, readyUserId, syncRetry]);

  useEffect(() => {
    if (firebaseConfigured) return undefined;
    const channel = new BroadcastChannel("messmate-sync");
    channel.onmessage = (event) => {
      if (event.data && Array.isArray(event.data.items) && Array.isArray(event.data.bills)) {
        setData(event.data);
      }
    };
    const onStorage = (event) => {
      if (event.key === STORE_KEY && event.newValue) {
        try { setData(JSON.parse(event.newValue)); } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => { channel.close(); window.removeEventListener("storage", onStorage); };
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) {
      setAuthLoading(false);
      return undefined;
    }
    let active = true;
    let stopAuth = () => {};
    loadFirebaseAuth().then(client => {
      if (!active) return;
      setFirebaseClient(client);
      stopAuth = client.authApi.onAuthStateChanged(client.auth, nextUser => {
        setUser(nextUser);
        setSyncError("");
        setAuthLoading(false);
      }, error => {
        setSyncError(`Authentication failed: ${error.message}`);
        setAuthLoading(false);
      });
    }).catch(error => {
      if (active) {
        setSyncError(`Firebase could not initialize: ${error.message}`);
        setAuthLoading(false);
      }
    });
    return () => { active = false; stopAuth(); };
  }, []);

  useEffect(() => {
    if (!firebaseClient || !user) {
      setFirestore(null);
      return undefined;
    }
    let active = true;
    firebaseClient.loadFirestore().then(api => {
      if (active) setFirestore(api);
    }).catch(error => {
      if (active) setSyncError(`Firestore could not initialize: ${error.message}`);
    });
    return () => { active = false; };
  }, [user?.uid, firebaseClient, syncRetry]);

  useEffect(() => {
    if (!firebaseConfigured || !firestore || !user) return undefined;
    let active = true;
    let itemsLoaded = false;
    let billsLoaded = false;
    let initialLoadStarted = false;
    let cloudReady = false;
    const loadTimeout = setTimeout(() => {
      if (active && !cloudReady) {
        setSyncError("The cloud database is taking too long to respond. Check your connection and try again.");
      }
    }, 15000);
    remoteDataRef.current = { items: [], bills: [] };
    setReadyUserId(null);
    setSyncError("");

    async function initializeData() {
      if (initialLoadStarted || !itemsLoaded || !billsLoaded) return;
      initialLoadStarted = true;
      const remote = remoteDataRef.current;
      try {
        const settingsRef = firestore.doc(firestore.db, "users", user.uid, "meta", "settings");
        const settingsSnapshot = await firestore.getDoc(settingsRef);
        if (!active) return;
        const alreadyInitialized = settingsSnapshot.exists();
        const canMigrateLocalData = !alreadyInitialized && !localStorage.getItem(MIGRATION_KEY);
        const localData = canMigrateLocalData ? loadMigrationData() : null;
        const initial = alreadyInitialized ? remote : !remote.items.length && !remote.bills.length
          ? localData || starter
          : localData ? mergeMigrationData(localData, remote) : remote;
        if (!equalData(remote, initial)) {
          await writeDataChanges(firestore, user.uid, remote, initial);
        }
        if (!active) return;
        if (!alreadyInitialized) {
          await firestore.setDoc(settingsRef, { initializedAt: new Date().toISOString() });
        }
        if (!active) return;
        localStorage.setItem(MIGRATION_KEY, "true");
        if (localData) localStorage.removeItem(STORE_KEY);
        remoteDataRef.current = initial;
        lastSyncedDataRef.current = initial;
        setData(initial);
        cloudReady = true;
        clearTimeout(loadTimeout);
        setSyncError("");
        setReadyUserId(user.uid);
      } catch (error) {
        if (active) setSyncError(`Could not load cloud data: ${error.message}`);
      }
    }

    function receiveRemoteData() {
      remoteRevisionRef.current += 1;
      if (!itemsLoaded || !billsLoaded) return;
      if (!cloudReady) {
        void initializeData();
        return;
      }
      const remote = remoteDataRef.current;
      const merged = mergeData(lastSyncedDataRef.current, dataRef.current, remote);
      lastSyncedDataRef.current = remote;
      setData(merged);
    }

    const stopItems = firestore.onSnapshot(firestore.collection(firestore.db, "users", user.uid, "items"), { includeMetadataChanges: true }, snapshot => {
      remoteDataRef.current = { ...remoteDataRef.current, items: readCloudItems(snapshot) };
      itemsLoaded = !snapshot.metadata.fromCache;
      receiveRemoteData();
    }, error => {
      if (active) setSyncError(`Could not sync menu: ${error.message}`);
    });
    const stopBills = firestore.onSnapshot(firestore.collection(firestore.db, "users", user.uid, "bills"), { includeMetadataChanges: true }, snapshot => {
      remoteDataRef.current = { ...remoteDataRef.current, bills: readCloudBills(snapshot) };
      billsLoaded = !snapshot.metadata.fromCache;
      receiveRemoteData();
    }, error => {
      if (active) setSyncError(`Could not sync bills: ${error.message}`);
    });
    return () => { active = false; clearTimeout(loadTimeout); stopItems(); stopBills(); };
  }, [user?.uid, firestore, syncRetry]);

  useEffect(() => {
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    }
  }, []);

  const dayBills = useMemo(() => data.bills.filter(b => b.date === date), [data.bills, date]);
  const totals = useMemo(() => {
    const sum = (list) => list.reduce((a, b) => a + b.total, 0);
    return {
      total: sum(dayBills),
      cash: sum(dayBills.filter(b => b.payment === "Cash")),
      online: sum(dayBills.filter(b => b.payment === "Online")),
      morning: sum(dayBills.filter(b => b.shift === "Morning")),
      evening: sum(dayBills.filter(b => b.shift === "Evening"))
    };
  }, [dayBills]);
  const shiftBills = dayBills.filter(b => b.shift === shift);
  const billTotal = data.items.reduce((sum, item) => sum + item.price * (Number(quantities[item.id]) || 0), 0);
  const selectedCount = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

  function updateQuantity(id, value) {
    setQuantities(prev => ({ ...prev, [id]: Math.max(0, Math.min(999, Number(value) || 0)) }));
  }
  function saveBill() {
    if (!billTotal) return setNotice("Add at least one item before saving.");
    const lines = data.items.filter(item => Number(quantities[item.id]) > 0).map(item => ({
      itemId: item.id, name: item.name, price: item.price, quantity: Number(quantities[item.id]), subtotal: item.price * Number(quantities[item.id])
    }));
    const bill = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), date, shift, customer: customer.trim() || "Walk-in", payment, lines, total: billTotal, createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, bills: [bill, ...prev.bills] }));
    setQuantities({}); setCustomer(""); setNotice("Bill saved successfully.");
    setTimeout(() => setNotice(""), 2600);
  }
  function saveItem() {
    const name = itemName.trim(), price = Number(itemPrice);
    if (!name || !Number.isFinite(price) || price < 0) return setNotice("Enter a valid item name and price.");
    if (editingItem) {
      setData(prev => ({ ...prev, items: prev.items.map(i => i.id === editingItem.id ? { ...i, name, price } : i) }));
    } else {
      setData(prev => ({ ...prev, items: [...prev.items, { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name, price }] }));
    }
    setItemName(""); setItemPrice(""); setEditingItem(null); setShowAddItem(false);
    setNotice("Menu updated."); setTimeout(() => setNotice(""), 2200);
  }
  function startEdit(item) { setEditingItem(item); setItemName(item.name); setItemPrice(String(item.price)); setShowAddItem(true); }
  function deleteItem(id) {
    if (!confirm("Remove this item from the menu? Existing bills will remain unchanged.")) return;
    setData(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) }));
  }
  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `messmate-backup-${today()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function importData(event) {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!validData(parsed)) throw new Error();
        if (confirm("Import this backup? It will replace the data currently on this device.")) {
          setData(parsed); setNotice("Backup imported.");
        }
      } catch { setNotice("That file is not a valid MessMate backup."); }
      event.target.value = "";
      setTimeout(() => setNotice(""), 3000);
    };
    reader.readAsText(file);
  }
  function deleteBill(id) {
    if (!confirm("Delete this bill? The dashboard totals will be updated.")) return;
    setData(prev => ({ ...prev, bills: prev.bills.filter(b => b.id !== id) }));
  }

  if (firebaseConfigured && authLoading) return <SyncGate/>;
  if (firebaseConfigured && !firebaseClient) {
    return <SyncGate error={syncError || "Firebase could not initialize."} onRetry={() => window.location.reload()}/>;
  }
  if (firebaseConfigured && !user && syncError) {
    return <SyncGate error={syncError} onRetry={() => window.location.reload()}/>;
  }
  if (firebaseConfigured && !user) {
    return <Suspense fallback={<SyncGate/>}><AuthScreen auth={firebaseClient.auth} authApi={firebaseClient.authApi}/></Suspense>;
  }
  if (firebaseConfigured && user && readyUserId !== user.uid) {
    return <SyncGate
      error={syncError}
      onRetry={() => setSyncRetry(value => value + 1)}
      onSignOut={() => firebaseClient.authApi.signOut(firebaseClient.auth).catch(error => setSyncError(`Sign out failed: ${error.message}`))}
    />;
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Utensils size={20}/></div><div><b>messmate</b><small>MESS MANAGEMENT</small></div><button className="close-nav" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
      <div className="nav-label">WORKSPACE</div>
      {[["Overview", LayoutDashboard], ["New bill", ReceiptText], ["Menu & prices", Settings2]].map(([label, Icon]) =>
        <button key={label} className={`nav-link ${page === label ? "active" : ""}`} onClick={() => { setPage(label); setMobileNav(false); }}><Icon size={18}/>{label}</button>)}
      <div className="sidebar-bottom"><div className={`sync-status ${firebaseConfigured ? "cloud-status" : "local-status"}`}><span className="status-dot"></span><div><b>{firebaseConfigured ? "Cloud sync on" : "Local mode"}</b><small>{firebaseConfigured ? user.email : "Saved on this device"}</small></div></div>{firebaseConfigured && <button className="sign-out-button" onClick={() => firebaseClient.authApi.signOut(firebaseClient.auth).catch(error => setSyncError(`Sign out failed: ${error.message}`))}><LogOut size={14}/> Sign out</button>}<p>MessMate · v1.0</p></div>
    </aside>
    {mobileNav && <div className="scrim" onClick={() => setMobileNav(false)} />}
    <main className="main">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu/></button><div><span className="eyebrow">MESS OPERATIONS</span><h1>{page}</h1></div><div className="top-actions"><label className="date-control"><CalendarDays size={16}/><input type="date" value={date} onChange={e => setDate(e.target.value)}/></label>{firebaseConfigured ? <div className="cloud-user"><Cloud size={16}/><span>{user.email}</span></div> : <div className="avatar">M</div>}</div></header>
      {notice && <div className="toast"><Check size={16}/>{notice}</div>}
      {!firebaseConfigured && <div className="sync-alert setup-alert" role="status"><Cloud size={17}/><span>{missingFirebaseConfig.length ? `Cloud sync is not configured. Add ${missingFirebaseConfig.join(", ")} to enable it.` : "Cloud sync is not configured yet. Data is saved only in this browser."}</span></div>}
      {syncError && readyUserId === user?.uid && <div className="sync-alert" role="alert"><span>{syncError}</span><button onClick={() => setSyncRetry(value => value + 1)}><RefreshCw size={14}/> Retry</button></div>}
      {page === "Overview" && <>
        <section className="welcome-row"><div><h2>Today at a glance</h2><p>Here’s how your mess is performing for the selected date.</p></div><button className="primary-btn" onClick={() => setPage("New bill")}><Plus size={17}/> Create bill</button></section>
        <section className="stats-grid">
          <Stat icon={Wallet} label="Total collection" value={money(totals.total)} hint={`${dayBills.length} bills recorded`} tone="green"/>
          <Stat icon={Banknote} label="Cash payments" value={money(totals.cash)} hint="Received in cash" tone="blue"/>
          <Stat icon={CreditCard} label="Online payments" value={money(totals.online)} hint="UPI / bank transfer" tone="purple"/>
          <Stat icon={Activity} label="Total bills" value={dayBills.length} hint={`${selectedCount} items in current bill`} tone="orange"/>
        </section>
        <section className="overview-grid">
          <div className="panel collection-panel"><div className="panel-heading"><div><h3>Shift collections</h3><p>Morning and evening breakdown</p></div><span className="live-tag"><span/> LIVE TOTALS</span></div>
            <div className="shift-collection"><div className="shift-icon morning"><Coffee size={19}/></div><div className="shift-info"><b>Morning shift</b><small>{dayBills.filter(b => b.shift === "Morning").length} bills</small></div><strong>{money(totals.morning)}</strong></div>
            <div className="progress-track"><span style={{width: `${totals.total ? totals.morning / totals.total * 100 : 0}%`}}/></div>
            <div className="shift-collection"><div className="shift-icon evening"><Utensils size={19}/></div><div className="shift-info"><b>Evening shift</b><small>{dayBills.filter(b => b.shift === "Evening").length} bills</small></div><strong>{money(totals.evening)}</strong></div>
            <div className="progress-track evening-track"><span style={{width: `${totals.total ? totals.evening / totals.total * 100 : 0}%`}}/></div>
            <div className="collection-foot"><span>Combined collection</span><b>{money(totals.total)}</b></div>
          </div>
          <div className="panel quick-panel"><div className="panel-heading"><div><h3>Quick actions</h3><p>Manage your daily operations</p></div></div>
            <button className="quick-action" onClick={() => setPage("New bill")}><div className="quick-icon"><ReceiptText/></div><span><b>Create a new bill</b><small>Record a customer order</small></span><ChevronDown className="chevron" size={17}/></button>
            <button className="quick-action" onClick={() => setPage("Menu & prices")}><div className="quick-icon price"><Settings2/></div><span><b>Manage menu & prices</b><small>Customize your item list</small></span><ChevronDown className="chevron" size={17}/></button>
            <button className="quick-action" onClick={exportData}><div className="quick-icon backup"><ArrowDownToLine/></div><span><b>Export a backup</b><small>Move data to another device</small></span><ChevronDown className="chevron" size={17}/></button>
          </div>
        </section>
        <section className="panel bills-panel"><div className="panel-heading"><div><h3>Recent transactions</h3><p>Latest bills for {date === today() ? "today" : date}</p></div><span className="count-pill">{dayBills.length} records</span></div>
          {dayBills.length ? <div className="table-wrap"><table><thead><tr><th>CUSTOMER</th><th>SHIFT</th><th>ITEMS</th><th>PAYMENT</th><th>AMOUNT</th><th></th></tr></thead><tbody>{dayBills.slice(0, 8).map(b => <tr key={b.id}><td><b>{b.customer}</b><small>{new Date(b.createdAt).toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit"})}</small></td><td><span className={`shift-pill ${b.shift.toLowerCase()}`}>{b.shift}</span></td><td>{b.lines.reduce((s,l)=>s+l.quantity,0)} items</td><td><span className="payment-label">{b.payment === "Cash" ? <Banknote size={14}/> : <CreditCard size={14}/>} {b.payment}</span></td><td className="amount-cell">{money(b.total)}</td><td><button className="icon-btn danger" title="Delete bill" onClick={() => deleteBill(b.id)}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div> : <Empty icon={ReceiptText} title="No transactions yet" text="Create your first bill to see collections here."/>}
        </section>
      </>}
      {page === "New bill" && <section className="billing-layout">
        <div className="panel bill-builder"><div className="panel-heading"><div><h3>Create a bill</h3><p>Add items and quantities to calculate the total.</p></div><span className="count-pill">NEW ENTRY</span></div>
          <div className="field-row"><label className="field-label">CUSTOMER NAME <span>OPTIONAL</span><input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="e.g. Rahul / Walk-in customer"/></label><label className="field-label">BILL DATE<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label></div>
          <div className="section-line"><span>SELECT SHIFT</span></div><div className="shift-toggle">
            <button className={shift === "Morning" ? "selected" : ""} onClick={() => setShift("Morning")}><Coffee size={18}/>Morning</button>
            <button className={shift === "Evening" ? "selected" : ""} onClick={() => setShift("Evening")}><Utensils size={18}/>Evening</button>
          </div>
          <div className="section-line"><span>ORDER ITEMS</span><small>{selectedCount} selected</small></div>
          <div className="item-list">{data.items.map(item => <div className="order-item" key={item.id}><div className="item-symbol"><Utensils size={17}/></div><div className="order-item-name"><b>{item.name}</b><small>{money(item.price)} / unit</small></div><div className="quantity-control"><button onClick={() => updateQuantity(item.id, (quantities[item.id] || 0)-1)} disabled={!quantities[item.id]}>−</button><input type="number" min="0" value={quantities[item.id] || ""} placeholder="0" onChange={e => updateQuantity(item.id, e.target.value)}/><button onClick={() => updateQuantity(item.id, (quantities[item.id] || 0)+1)}>+</button></div><strong className="line-total">{money(item.price * (quantities[item.id] || 0))}</strong></div>)}
            {!data.items.length && <Empty icon={Utensils} title="Your menu is empty" text="Add items in Menu & prices first."/>}
          </div>
          <div className="bill-total"><span>Bill total</span><strong>{money(billTotal)}</strong></div>
        </div>
        <div className="panel payment-panel"><div className="panel-heading"><div><h3>Payment details</h3><p>Choose how the customer paid.</p></div></div><div className="payment-options">
          <button className={payment === "Cash" ? "chosen" : ""} onClick={() => setPayment("Cash")}><Banknote size={20}/><b>Cash</b><small>Physical payment</small>{payment === "Cash" && <Check className="chosen-check" size={16}/>}</button>
          <button className={payment === "Online" ? "chosen" : ""} onClick={() => setPayment("Online")}><CreditCard size={20}/><b>Online</b><small>UPI / bank transfer</small>{payment === "Online" && <Check className="chosen-check" size={16}/>}</button>
        </div><div className="payment-summary"><span>Items selected</span><b>{selectedCount}</b><span>Payment method</span><b>{payment}</b><span>Amount to collect</span><strong>{money(billTotal)}</strong></div><button className="primary-btn full" onClick={saveBill} disabled={!billTotal}><Check size={17}/> Save bill</button><p className="safe-note"><Check size={14}/> Bill is saved locally on this device.</p></div>
      </section>}
      {page === "Menu & prices" && <section className="panel menu-panel"><div className="panel-heading"><div><h3>Menu & pricing</h3><p>Customize the items and prices used in your bill calculator.</p></div><button className="primary-btn" onClick={() => {setEditingItem(null);setItemName("");setItemPrice("");setShowAddItem(true);}}><CirclePlus size={17}/> Add item</button></div>
        <div className="menu-tip"><Settings2 size={18}/><span>Changes apply to new bills. Previously saved bills keep their original prices.</span></div>
        <div className="table-wrap"><table><thead><tr><th>ITEM NAME</th><th>PRICE / UNIT</th><th>EDIT</th></tr></thead><tbody>{data.items.map(item => <tr key={item.id}><td><div className="menu-item-name"><div className="item-symbol"><Utensils size={16}/></div><b>{item.name}</b></div></td><td className="amount-cell">{money(item.price)}</td><td><div className="table-actions"><button className="icon-btn" onClick={() => startEdit(item)} title="Edit item"><Pencil size={15}/></button><button className="icon-btn danger" onClick={() => deleteItem(item.id)} title="Delete item"><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>
        {!data.items.length && <Empty icon={Utensils} title="No menu items" text="Add your first item to get started."/>}
        <div className="data-tools"><div><b>Backup & restore</b><small>Export your records or import them on another device.</small></div><div className="tool-buttons"><button className="secondary-btn" onClick={exportData}><ArrowDownToLine size={16}/> Export JSON</button><label className="secondary-btn upload-btn"><ArrowUpFromLine size={16}/> Import JSON<input type="file" accept="application/json,.json" onChange={importData}/></label></div></div>
      </section>}
      <footer className="footer"><span>© {new Date().getFullYear()} MessMate</span><span>Simple billing. Clear collections.</span></footer>
    </main>
    {showAddItem && <div className="modal-backdrop" onClick={() => setShowAddItem(false)}><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><h3>{editingItem ? "Edit menu item" : "Add menu item"}</h3><p>Set the name and price for this item.</p></div><button className="icon-btn" onClick={() => setShowAddItem(false)}><X size={18}/></button></div><label className="field-label">ITEM NAME<input autoFocus value={itemName} onChange={e => setItemName(e.target.value)} placeholder="e.g. Special thali"/></label><label className="field-label">PRICE (₹)<input type="number" min="0" value={itemPrice} onChange={e => setItemPrice(e.target.value)} placeholder="Enter price"/></label><div className="modal-actions"><button className="secondary-btn" onClick={() => setShowAddItem(false)}>Cancel</button><button className="primary-btn" onClick={saveItem}><Check size={16}/> Save item</button></div></div></div>}
  </div>;
}

function Stat({ icon: Icon, label, value, hint, tone }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={19}/></div><span className="stat-label">{label}</span><strong>{value}</strong><small>{hint}</small></div>;
}
function Empty({ icon: Icon, title, text }) { return <div className="empty-state"><div><Icon size={22}/></div><b>{title}</b><p>{text}</p></div>; }

createRoot(document.getElementById("root")).render(<App/>);