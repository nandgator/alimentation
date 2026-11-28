"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import "sonner/dist/styles.css";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTheme } from "@/theme";

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme] = useTheme();
  const phone = !useMediaQuery("(min-width: 1024px)");

  return (
    <Sonner
      theme={theme === "auto" ? "system" : theme}
      className="toaster group"
      // Top-centre on a phone, under the top bar, so a toast never covers the bottom bar or a sheet that rises from
      // it; bottom-right on a wide screen.
      position={phone ? "top-center" : "bottom-right"}
      offset={phone ? { top: "4rem" } : undefined}
      mobileOffset={{ top: "calc(3.5rem + env(safe-area-inset-top) + 0.5rem)" }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
