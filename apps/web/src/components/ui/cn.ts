import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class names joined, the later of two that clash winning. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
