/* =========================================================================
   MULEMBE NIGHT — SHARED APP CORE
   Included on every page. Provides: Firebase config/init, small helpers,
   the events list (shared across pages), and the auth/role bootstrap used
   by the gate and admin pages.

   SECURITY MODEL (see also the Firestore rules block at the bottom of
   this file) — unchanged from the original single-file version:
   1. PAYMENT DEDUPLICATION — the M-Pesa code is the Firestore document ID
      in `payments`, so it can never claim two tickets (unique by construction).
   2. AMOUNT-MATCHES-TIER GUARDRAIL — amount parsed from the SMS is checked
      against the selected tier's price before any write happens.
   3. ATOMIC ISSUANCE — payment claim + ticket creation happen in one
      Firestore transaction (tickets/index.html).
   4. TICKET SIGNING — demo uses SHA-256(ticket_id + event_id + TICKET_SALT)
      client-side. >>> NOT PRODUCTION-SAFE <<< — TICKET_SALT is visible in
      page source. Move issuance + signing into a Cloud Function with a
      server-side secret before going live. Spots that need to move
      server-side are marked "SERVER-SIDE IN PRODUCTION".
   5. ATOMIC, RACE-SAFE SCANNING — gate/index.html reads+writes ticket
      status inside one transaction; every attempt is logged to `scanHistory`.
   6. ROLES — staff/admin sign in with email + password on admin/index.html.
      A `users/{uid}` document holds role ("staff"/"admin"), granted only
      via the Firebase console — never self-assigned.
   7. LOST-TICKET LOOKUP — reading a single payment/ticket doc by its exact
      ID is allowed for everyone; *listing* those collections is not.
   ========================================================================= */

// -----------------------------------------------------------------------
// 0. CONFIG — fill these in, and set a long random TICKET_SALT, before
//    pointing any page at a real Firebase project.
// -----------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDNFUBzxkm7uSs-bt5uuzE8PNzRdIsFg_4",
  authDomain: "mulembe-night.firebaseapp.com",
  projectId: "mulembe-night",
  storageBucket: "mulembe-night.firebasestorage.app",
  messagingSenderId: "846816215218",
  appId: "1:846816215218:web:39c0480d31eeea04e989ab"
};

const TICKET_SALT = "062969a8e151f9e71938060bd1101632e4ae0e5313384422b0d36517ee5a3607"; // move server-side in production

const isConfigured = firebaseConfig.apiKey;

let db = null;
if (isConfigured) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
}

function showConfigBannerIfNeeded() {
  const banner = document.getElementById('configBanner');
  if (banner && !isConfigured) banner.classList.add('show');
}

// -----------------------------------------------------------------------
// Global state shared by every page
// -----------------------------------------------------------------------
let EVENTS = [];          // events loaded from Firestore, newest first
let currentUser = null;   // firebase auth user (staff/admin) or null/anonymous
let currentRole = 'none'; // 'none' | 'staff' | 'admin'

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------
function extractMpesaCode(message) {
  const match = message.trim().match(/\b[A-Z0-9]{10}\b/);
  return match ? match[0] : null;
}
function extractAmount(message) {
  const match = message.match(/Ksh\s?([\d,]+(?:\.\d{1,2})?)/i);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
}
function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').replace(/^0/, '254').replace(/^254?/, '254');
}
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function setStatus(el, kind, msg) {
  el.className = "status-box show " + kind;
  el.textContent = msg;
}
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}
function fmtDate(d) {
  if (!d) return 'Date dropping soon';
  try { return new Date(d).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return String(d); }
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function eventById(id) { return EVENTS.find(e => e.id === id) || null; }

// -----------------------------------------------------------------------
// Events — shared loader. Every page that needs the events list calls
// this, then does its own page-specific rendering with the result.
// -----------------------------------------------------------------------
async function loadEventsData() {
  if (!isConfigured) { EVENTS = []; return EVENTS; }
  try {
    const snap = await db.collection('events').orderBy('createdAt', 'desc').get();
    EVENTS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Failed to load events:', e);
    EVENTS = [];
  }
  return EVENTS;
}
function liveEvents() { return EVENTS.filter(e => e.active !== false); }

// -----------------------------------------------------------------------
// Auth bootstrap — ticket buyers get an anonymous session (needed to
// write payments/tickets under the security rules). Staff/admin sign in
// with email + password on admin/index.html; that session is shared
// across every page in the browser automatically by Firebase Auth.
// Pages that care about role (gate, admin) pass a callback that fires
// every time the auth/role state is (re)resolved.
// -----------------------------------------------------------------------
function initAuthBootstrap(onReady) {
  if (!isConfigured) { if (onReady) onReady(); return; }
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    if (!user) {
      firebase.auth().signInAnonymously().catch(err => console.error("Auth error:", err));
      return;
    }
    if (user.isAnonymous) {
      currentRole = 'none';
      if (onReady) onReady();
      return;
    }
    try {
      const roleDoc = await db.collection('users').doc(user.uid).get();
      currentRole = roleDoc.exists ? (roleDoc.data().role || 'none') : 'none';
    } catch (e) {
      console.error('Role lookup failed:', e);
      currentRole = 'none';
    }
    if (onReady) onReady();
  });
}

// Renders the small "signed in as ..." bar used on gate + admin pages,
// if that page has a #roleBar element.
function renderRoleBar() {
  const who = document.getElementById('roleWho');
  const badge = document.getElementById('roleBadge');
  const signOutBtn = document.getElementById('signOutBtn');
  if (!who || !badge) return;

  if (!currentUser || currentUser.isAnonymous) {
    who.textContent = 'Not signed in';
    badge.textContent = 'no access';
    badge.className = 'role-badge none';
    if (signOutBtn) signOutBtn.style.display = 'none';
    return;
  }
  who.textContent = currentUser.email;
  badge.textContent = currentRole === 'none' ? 'awaiting role' : currentRole;
  badge.className = 'role-badge ' + (currentRole === 'admin' ? 'admin' : currentRole === 'staff' ? '' : 'none');
  if (signOutBtn) signOutBtn.style.display = 'inline-block';
}

/* =========================================================================
   FIRESTORE SECURITY RULES (set in the Firebase console) — same rules
   cover every page, since they all talk to the one Firestore project.

     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {

         function isSignedIn() { return request.auth != null; }
         function roleDoc() { return get(/databases/$(database)/documents/users/$(request.auth.uid)); }
         function myRole() { return isSignedIn() && exists(/databases/$(database)/documents/users/$(request.auth.uid)) ? roleDoc().data.role : 'none'; }
         function isStaff() { return myRole() == 'staff' || myRole() == 'admin'; }
         function isAdmin() { return myRole() == 'admin'; }

         match /users/{uid} {
           allow get: if isSignedIn() && request.auth.uid == uid;
           allow list: if false;
           allow write: if false; // grant roles manually in the console
         }
         match /events/{eventId} {
           allow read: if true;
           allow write: if isAdmin();
         }
         match /payments/{code} {
           allow get: if true;   // requires knowing the exact M-Pesa code
           allow list: if false; // never allow browsing all payments
           allow create: if isSignedIn();
           allow update, delete: if false;
         }
         match /tickets/{ticketId} {
           allow get: if true;      // requires knowing the exact ticket UUID
           allow list: if isStaff(); // dashboard listing is staff/admin only
           allow create: if isSignedIn();
           allow update: if isStaff();
           allow delete: if false;
         }
         match /scanHistory/{entryId} {
           allow read: if isStaff();
           allow create: if isStaff();
           allow update, delete: if false;
         }
       }
     }
   ========================================================================= */
