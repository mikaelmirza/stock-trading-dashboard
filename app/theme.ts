"use client";

import { createTheme } from "@mui/material/styles";

// Reuses the Geist fonts already loaded via next/font in app/layout.tsx
// (same var()-based integration pattern MUI's Next.js guide documents for
// next/font, just pointed at this repo's existing font choice instead of
// Roboto).
const theme = createTheme({
  typography: {
    fontFamily: "var(--font-geist-sans)",
  },
});

export default theme;
