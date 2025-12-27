"use client";

// Dynamic import to avoid Turbopack issues
async function loadAuth() {
  if (typeof window === "undefined") throw new Error("Auth is browser-only");
  const AmplifyModule = await import("aws-amplify");
  const { Auth } = AmplifyModule;
  if (!Auth) throw new Error("Auth not loaded");
  return Auth;
}

export async function signIn(username: string, password: string) {
  const Auth = await loadAuth();
  return Auth.signIn(username, password);
}

export async function signOut() {
  const Auth = await loadAuth();
  return Auth.signOut();
}

export async function getCurrentUser() {
  try {
    const Auth = await loadAuth();
    return await Auth.currentAuthenticatedUser();
  } catch {
    return null;
  }
}
