"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Up to two letters from a name: "Imran Qureshi" is "IQ". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

type Props = {
  code: string;
  name: string;
  /** The worker has a photo on file; otherwise (or if it fails to load) their initials show. */
  hasPhoto?: boolean;
  /** Changes when the photo does, so the browser fetches the new one. */
  version?: string | number;
  className?: string;
};

export function WorkerAvatar({ code, name, hasPhoto, version, className }: Props) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(hasPhoto) && !failed;
  return (
    <span
      className={cn(
        "grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-sunken text-sm font-semibold text-muted",
        className,
      )}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={api.workerPhotoUrl(code, version)}
          alt={`Photo of ${name}`}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
    </span>
  );
}
