import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Golf OS",
    short_name: "Golf OS",
    description: "Tee times, live scoring, caddies and handicaps.",
    start_url: "/bookings",
    scope: "/",
    display: "standalone",
    background_color: "#F4EFE6",
    theme_color: "#0B2B1E",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Book a tee time", url: "/courses/asc-centre-bengaluru/book" },
      { name: "My bookings", url: "/bookings" },
    ],
  };
}
