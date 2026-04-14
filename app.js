/* Kennari — app.js
   Shared utilities, auth guard, nav
   --------------------------------- */

import { supabase, getUser } from './supabase.js';

/* ------------------------------------------------
   Auth guard
   Call on any protected page (workout, tracking, settings).
   Redirects to index.html if no active session.
   ------------------------------------------------ */
export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    window.location.replace('index.html');
  }
  return user;
}

/* ------------------------------------------------
   Login-page redirect
   If already logged in, skip the login screen.
   Routes to onboarding if no profile yet,
   otherwise straight to the workout screen.
   Called only from index.html.
   ------------------------------------------------ */
export async function redirectIfLoggedIn() {
  const user = await getUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  window.location.replace(profile ? 'home.html' : 'onboarding.html');
}

/* ------------------------------------------------
   Auth state listener
   Handles session changes (e.g. token refresh,
   sign-out from another tab).
   ------------------------------------------------ */
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    // If we're on a protected page, kick back to login
    const publicPages = ['index.html', ''];
    const currentPage = window.location.pathname.split('/').pop();
    if (!publicPages.includes(currentPage)) {
      window.location.replace('index.html');
    }
  }
});

console.log('Kennari loaded');
