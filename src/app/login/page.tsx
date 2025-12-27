"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push("/home"); // redirect to home after login
      } else {
        const data = await res.json();
        alert("Login failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = (provider: "Google" | "Apple") => {
    alert(`Social login with ${provider} clicked. Implement OAuth redirect.`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-tr from-blue-50 to-purple-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 space-y-6">
        <h1 className="text-4xl font-extrabold text-gray-800 text-center">
          Welcome Back
        </h1>
        <p className="text-center text-gray-500">
          Sign in to access your family photo gallery
        </p>

        <div className="space-y-4">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username or Email"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </div>

        <div className="flex justify-between text-sm text-blue-600">
          <button
            onClick={() => alert("Forgot password flow")}
            className="hover:underline"
          >
            Forgot password?
          </button>
        </div>

        <div className="mt-6 text-center text-gray-400">or sign in with</div>

        <div className="flex justify-center gap-4 mt-3">
          <button
            onClick={() => handleSocialLogin("Google")}
            className="flex items-center gap-2 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition"
          >
            <img src="/icons/google.svg" alt="Google" className="w-5 h-5" />
            Google
          </button>
          <button
            onClick={() => handleSocialLogin("Apple")}
            className="flex items-center gap-2 border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-100 transition"
          >
            <img src="/icons/apple.svg" alt="Apple" className="w-5 h-5" />
            Apple
          </button>
        </div>
      </div>
    </div>
  );
}
