import type { ReactNode } from "react";

export default function ContentFrame({
  children,
  mode = "media",
}: {
  children: ReactNode;
  mode?: "media" | "readable";
}) {
  if (mode === "readable") {
    return <div className="mx-auto w-full max-w-3xl">{children}</div>;
  }

  return <div className="w-full">{children}</div>;
}
