import { notFound } from "next/navigation";
import { GalleryClient } from "@/components/gallery/GalleryClient";

export const metadata = { title: "Design system gallery · CONSTRUCTIQ" };

/**
 * Development-only: every shared component in every state, for review and screenshots.
 * Hidden (404) in a production build unless NEXT_PUBLIC_ENABLE_GALLERY=true.
 */
export default function GalleryPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_GALLERY !== "true") {
    notFound();
  }
  return <GalleryClient />;
}
