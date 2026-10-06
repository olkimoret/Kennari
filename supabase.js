/* Kennari — supabase.js
   Supabase client init + auth helpers
   ----------------------------------------
   Replace SUPABASE_URL and SUPABASE_ANON_KEY
   with your project values before testing.
   ---------------------------------------- */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL  = 'https://hbnsbxaktxolqmdohxue.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1rXnYWw8tyKWo4bJEubZAw_eDGRIOJO';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Sign up a new user with email + password.
 * Returns { data, error }
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  return { data, error };
}

/**
 * Sign in an existing user with email + password.
 * Returns { data, error }
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

/**
 * Sign out the current user.
 * Returns { error }
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

/**
 * Email a password-reset link. The link lands on reset-password.html.
 * Returns { error }
 */
export async function sendPasswordReset(email) {
  const redirectTo = new URL('reset-password.html', window.location.href).href;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return { error };
}

/**
 * Set a new password for the current (recovery) session.
 * Returns { error }
 */
export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  return { error };
}

/**
 * Get the currently authenticated user, or null.
 */
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}
